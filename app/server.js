import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(__dirname, "public");
const localDir = path.join(rootDir, ".local");
const exportsDir = path.join(rootDir, "exports");
const settingsPath = path.join(localDir, "settings.json");
const port = Number(process.env.PORT || 5177);

const defaultSettings = {
  enginePath: "",
  engineOptions: {},
  skillPreset: "3",
  customSearch: { mode: "movetime", depth: 7, movetime: 800, multipv: 3 },
  autoPlayDelaySeconds: 2,
  analysis: { enabled: true, mode: "movetime", depth: 7, movetime: 300, multipv: 3 },
  ui: { showCoords: true, showLastMove: true, showLegalTips: true, notation: "both", logLevel: "standard" }
};

class UciClient {
  constructor() {
    this.process = null;
    this.readerBuffer = "";
    this.waiters = [];
    this.info = { name: "", author: "", options: [] };
    this.status = "未启动";
    this.lastError = "";
    this.search = null;
  }

  async start(enginePath, configuredOptions = {}) {
    if (!enginePath) throw new Error("请先配置 Pikafish 可执行文件路径。");
    await this.stopProcess();
    this.info = { name: "", author: "", options: [] };
    this.status = "启动中";
    this.lastError = "";

    this.process = spawn(enginePath, [], { cwd: path.dirname(enginePath), stdio: ["pipe", "pipe", "pipe"] });
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", data => this.onData(data));
    this.process.stderr.on("data", data => {
      this.lastError = String(data).trim();
    });
    this.process.on("exit", code => {
      this.status = code === 0 ? "已退出" : "错误";
      this.rejectSearch(new Error(`引擎进程已退出，代码 ${code ?? "unknown"}`));
    });
    this.process.on("error", err => {
      this.status = "错误";
      this.lastError = err.message;
      this.rejectSearch(err);
    });

    this.send("uci");
    await this.waitFor(line => line === "uciok", 5000);
    this.send("isready");
    await this.waitFor(line => line === "readyok", 5000);

    for (const [name, value] of Object.entries(configuredOptions || {})) {
      if (value !== undefined && value !== null && value !== "") {
        this.setOption(name, value);
      }
    }
    this.status = "可用";
    return this.getStatus();
  }

  onData(data) {
    this.readerBuffer += data;
    const lines = this.readerBuffer.split(/\r?\n/);
    this.readerBuffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      this.captureHandshakeLine(line);
      this.resolveWaiters(line);
      if (this.search) this.consumeSearchLine(line);
    }
  }

  captureHandshakeLine(line) {
    if (line.startsWith("id name ")) this.info.name = line.slice(8).trim();
    if (line.startsWith("id author ")) this.info.author = line.slice(10).trim();
    if (line.startsWith("option ")) this.info.options.push(parseEngineOption(line));
  }

  resolveWaiters(line) {
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(line)) {
        clearTimeout(waiter.timer);
        this.waiters = this.waiters.filter(item => item !== waiter);
        waiter.resolve(line);
      }
    }
  }

  waitFor(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(item => item.timer !== timer);
        reject(new Error("等待引擎响应超时。"));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  send(command) {
    if (!this.process || !this.process.stdin.writable) throw new Error("引擎未启动。");
    this.process.stdin.write(`${command}\n`);
  }

  setOption(name, value) {
    this.send(`setoption name ${name} value ${value}`);
  }

  async searchPosition({ fen, mode = "movetime", value = 800, multipv = 1, options = {} }) {
    if (this.status !== "可用") throw new Error("引擎当前不可用。");
    if (this.search) {
      this.send("stop");
      await this.search.promise.catch(() => null);
    }

    if (multipv) this.setOption("MultiPV", multipv);
    for (const [name, optionValue] of Object.entries(options || {})) {
      if (optionValue !== undefined && optionValue !== null && optionValue !== "") {
        this.setOption(name, optionValue);
      }
    }
    this.send("isready");
    await this.waitFor(line => line === "readyok", 3000);

    this.send(`position fen ${fen}`);
    const rawInfoLines = [];
    const result = {
      bestMove: "",
      ponderMove: "",
      depth: null,
      selectiveDepth: null,
      timeMs: null,
      nodes: null,
      nps: null,
      scoreType: "UNKNOWN",
      scoreValue: null,
      scorePerspective: "SIDE_TO_MOVE",
      scoreRedPerspective: null,
      principalVariation: [],
      candidateMoves: [],
      rawInfoLines,
      rawBestMoveLine: ""
    };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.send("stop");
        reject(new Error("本次搜索超时，已发送 stop。"));
      }, Math.max(5000, Number(value) + 10000));
      this.search = { resolve, reject, timer, result, sideToMove: fen.includes(" b ") ? "BLACK" : "RED" };
    });
    this.search.promise = promise;
    const safeValue = Math.max(1, Number(value) || 1);
    if (mode === "depth") this.send(`go depth ${safeValue}`);
    else if (mode === "nodes") this.send(`go nodes ${safeValue}`);
    else this.send(`go movetime ${safeValue}`);
    return promise;
  }

  consumeSearchLine(line) {
    const search = this.search;
    if (!search) return;
    if (line.startsWith("info ")) {
      search.result.rawInfoLines.push(line);
      mergeInfo(search.result, parseInfoLine(line), search.sideToMove);
    }
    if (line.startsWith("bestmove")) {
      clearTimeout(search.timer);
      search.result.rawBestMoveLine = line;
      const parts = line.split(/\s+/);
      search.result.bestMove = parts[1] || "";
      const ponderIndex = parts.indexOf("ponder");
      if (ponderIndex >= 0) search.result.ponderMove = parts[ponderIndex + 1] || "";
      const finalResult = search.result;
      this.search = null;
      search.resolve(finalResult);
    }
  }

  rejectSearch(err) {
    if (!this.search) return;
    clearTimeout(this.search.timer);
    this.search.reject(err);
    this.search = null;
  }

  async stopSearch() {
    if (this.process) this.send("stop");
    return { ok: true };
  }

  async stopProcess() {
    if (this.process) {
      try { this.process.stdin.write("quit\n"); } catch {}
      this.process.kill();
      this.process = null;
    }
    this.status = "未启动";
  }

  getStatus() {
    return { status: this.status, error: this.lastError, ...this.info };
  }
}

function parseEngineOption(line) {
  const tokens = line.split(/\s+/);
  const option = { raw: line, name: "", type: "", default: "", min: "", max: "", vars: [] };
  let key = "";
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (["name", "type", "default", "min", "max", "var"].includes(token)) {
      key = token;
      if (key === "var") option.vars.push("");
      continue;
    }
    if (!key) continue;
    if (key === "var") option.vars[option.vars.length - 1] += `${option.vars.at(-1) ? " " : ""}${token}`;
    else option[key] += `${option[key] ? " " : ""}${token}`;
  }
  return option;
}

function parseInfoLine(line) {
  const tokens = line.split(/\s+/);
  const info = { candidate: null, pv: [] };
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "depth") info.depth = Number(tokens[++i]);
    else if (token === "seldepth") info.selectiveDepth = Number(tokens[++i]);
    else if (token === "time") info.timeMs = Number(tokens[++i]);
    else if (token === "nodes") info.nodes = Number(tokens[++i]);
    else if (token === "nps") info.nps = Number(tokens[++i]);
    else if (token === "multipv") info.multipv = Number(tokens[++i]);
    else if (token === "score") {
      const type = tokens[++i];
      const value = Number(tokens[++i]);
      info.scoreType = type === "cp" ? "CP" : type === "mate" ? "MATE" : "UNKNOWN";
      info.scoreValue = value;
    } else if (token === "pv") {
      info.pv = tokens.slice(i + 1);
      break;
    }
  }
  return info;
}

function mergeInfo(result, info, sideToMove) {
  for (const key of ["depth", "selectiveDepth", "timeMs", "nodes", "nps", "scoreType", "scoreValue"]) {
    if (info[key] !== undefined && info[key] !== null) result[key] = info[key];
  }
  if (info.pv?.length) result.principalVariation = info.pv;
  if (info.scoreType && info.scoreValue !== undefined) {
    const sign = sideToMove === "RED" ? 1 : -1;
    result.scoreRedPerspective = info.scoreType === "CP" ? info.scoreValue * sign : info.scoreValue * sign;
  }
  if (info.multipv || info.pv?.length) {
    const index = Math.max(1, info.multipv || 1);
    result.candidateMoves[index - 1] = {
      rank: index,
      move: info.pv?.[0] || "",
      scoreType: info.scoreType || "UNKNOWN",
      scoreValue: info.scoreValue ?? null,
      scoreRedPerspective: result.scoreRedPerspective,
      principalVariation: info.pv || []
    };
    result.candidateMoves = result.candidateMoves.filter(Boolean);
  }
}

const engine = new UciClient();

async function loadSettings() {
  try {
    const text = await fs.readFile(settingsPath, "utf8");
    return { ...defaultSettings, ...JSON.parse(text) };
  } catch {
    return defaultSettings;
  }
}

async function saveSettings(settings) {
  await fs.mkdir(localDir, { recursive: true });
  const merged = { ...defaultSettings, ...settings };
  await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2));
  return merged;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function exportTimestamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function sideCn(side) {
  return side === "RED" ? "红方" : side === "BLACK" ? "黑方" : "未知";
}

function actorCn(actor) {
  return actor === "AI" ? "AI" : "用户";
}

function formatMoveLine(move) {
  const markers = [];
  if (move.isCapture) markers.push(`吃${move.capturedText || "子"}`);
  if (move.isCheckmate) markers.push("将死");
  else if (move.isCheck) markers.push("将军");
  const score = move.engineEvaluationAfterMove
    ? `；评分 ${move.engineEvaluationAfterMove.scoreRedPerspective ?? move.engineEvaluationAfterMove.scoreValue ?? "未知"}`
    : "";
  return `${sideCn(move.side)} ${actorCn(move.actor)}：${move.notationCn}（${move.notationUci}）${markers.length ? ` [${markers.join("、")}]` : ""}${score}`;
}

function buildTxtRecord(record) {
  const lines = [];
  lines.push("本地象棋 AI 分析助手棋谱");
  lines.push(`开始时间：${record.startedAt || "未知"}`);
  lines.push(`结束时间：${record.endedAt || "未知"}`);
  lines.push(`结束原因：${record.endReason || "未知"}`);
  lines.push("");
  lines.push("走法：");
  const grouped = [];
  for (const move of record.moveHistory || []) {
    const index = Math.max(0, (move.moveNumber || 1) - 1);
    grouped[index] ||= { number: move.moveNumber || index + 1, red: null, black: null };
    grouped[index][move.side === "RED" ? "red" : "black"] = move;
  }
  for (const row of grouped) {
    lines.push(`${row.number}. 红：${row.red ? formatMoveLine(row.red) : ""}`);
    if (row.black) lines.push(`   黑：${formatMoveLine(row.black)}`);
  }
  lines.push("");
  lines.push("评分走势：");
  for (const point of record.trend || []) {
    lines.push(`第 ${point.ply} 手：红方优势倾向 ${point.redWinPercent}%；raw score ${point.rawScore}`);
  }
  lines.push("");
  lines.push("日志摘要：");
  for (const log of record.logEntries || []) {
    lines.push(`${log.timestamp || ""} ${log.title || ""}：${log.message || ""}`);
  }
  return `${lines.join("\n")}\n`;
}

async function exportGameRecord(record) {
  await fs.mkdir(exportsDir, { recursive: true });
  const stamp = exportTimestamp();
  const baseName = `xiangqi-${stamp}`;
  const jsonPath = path.join(exportsDir, `${baseName}.json`);
  const txtPath = path.join(exportsDir, `${baseName}.txt`);
  const normalized = {
    exportedAt: new Date().toISOString(),
    ...record
  };
  await fs.writeFile(jsonPath, JSON.stringify(normalized, null, 2));
  await fs.writeFile(txtPath, buildTxtRecord(normalized));
  return {
    json: path.relative(rootDir, jsonPath),
    txt: path.relative(rootDir, txtPath)
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function routeApi(req, res, url) {
  try {
    if (url.pathname === "/api/settings" && req.method === "GET") return sendJson(res, 200, await loadSettings());
    if (url.pathname === "/api/settings" && req.method === "POST") return sendJson(res, 200, await saveSettings(await readJson(req)));
    if (url.pathname === "/api/engine/status") return sendJson(res, 200, engine.getStatus());
    if (url.pathname === "/api/engine/start" && req.method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, await engine.start(body.enginePath, body.options));
    }
    if (url.pathname === "/api/engine/test" && req.method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, await engine.start(body.enginePath, body.options));
    }
    if (url.pathname === "/api/engine/stop" && req.method === "POST") return sendJson(res, 200, await engine.stopSearch());
    if (url.pathname === "/api/search" && req.method === "POST") return sendJson(res, 200, await engine.searchPosition(await readJson(req)));
    if (url.pathname === "/api/export" && req.method === "POST") return sendJson(res, 200, await exportGameRecord(await readJson(req)));
    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    sendJson(res, 500, { error: err.message || String(err) });
  }
}

async function serveStatic(req, res, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(publicDir, requestPath));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type = ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : ext === ".html" ? "text/html; charset=utf-8" : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return routeApi(req, res, url);
  return serveStatic(req, res, url);
});

process.on("SIGINT", async () => {
  await engine.stopProcess();
  process.exit(0);
});

if (process.argv[1] === fileURLToPath(import.meta.url) && fsSync.existsSync(publicDir)) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`本地象棋 AI 分析助手已启动：http://127.0.0.1:${port}`);
  });
}

export { parseEngineOption, parseInfoLine, mergeInfo };
