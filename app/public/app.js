const Side = { RED: "RED", BLACK: "BLACK" };
const Mode = {
  FREE_PLAY: "FREE_PLAY",
  AI_ASSIST: "AI_ASSIST",
  AUTO_PLAY: "AUTO_PLAY",
  CUSTOM_SETUP: "CUSTOM_SETUP",
  PAUSED_FREE_PLAY: "PAUSED_FREE_PLAY",
  GAME_OVER: "GAME_OVER"
};
const Actor = { HUMAN: "HUMAN", AI: "AI" };

const pieceNames = {
  r: "车", n: "马", b: "象", a: "士", k: "将", c: "炮", p: "卒",
  R: "车", N: "马", B: "相", A: "仕", K: "帅", C: "炮", P: "兵"
};
const files = "abcdefghi";
const setupPieceOrder = ["K", "A", "B", "N", "R", "C", "P", "k", "a", "b", "n", "r", "c", "p"];
const maxPieceCounts = {
  K: 1, A: 2, B: 2, N: 2, R: 2, C: 2, P: 5,
  k: 1, a: 2, b: 2, n: 2, r: 2, c: 2, p: 5
};
const presetMap = {
  "1": { mode: "movetime", depth: 3, movetime: 100, text: "入门陪练：反应很快，容易犯错，适合刚学规则或随便玩。" },
  "2": { mode: "movetime", depth: 5, movetime: 300, text: "普通业余：能看到简单战术，但不会太强。" },
  "3": { mode: "movetime", depth: 7, movetime: 800, text: "业余高手：能发现多数直接战术，适合日常对练。" },
  "4": { mode: "movetime", depth: 9, movetime: 1500, text: "强业余 / 复盘分析：明显强于普通业余玩家，适合认真复盘。" },
  "5": { mode: "movetime", depth: 12, movetime: 3000, text: "深度分析：计算更充分，但等待更久。" }
};

const state = {
  board: createInitialBoard(),
  sideToMove: Side.RED,
  mode: Mode.FREE_PLAY,
  aiSide: null,
  humanSide: null,
  locked: false,
  boardFlipped: false,
  selected: null,
  legalTips: [],
  lastMove: null,
  selectedMoveId: null,
  setup: { active: false, dirty: false, selectedBoard: null, selectedPiece: null },
  moveHistory: [],
  logEntries: [],
  trend: [],
  settings: null,
  engineStatus: null,
  currentResult: null,
  isCalculating: false,
  gameStartedAt: null,
  gameEndedAt: null,
  endReason: "",
  exportStatus: "",
  analysisInFlight: false,
  auto: { active: false, token: 0, countdown: 0, timer: null },
  toastTimer: null
};

const $ = selector => document.querySelector(selector);
const boardEl = $("#board");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "请求失败");
  return data;
}

function createInitialBoard() {
  return [
    [..."rnbakabnr"],
    [..."         "],
    [..." c     c "],
    [..."p p p p p"],
    [..."         "],
    [..."         "],
    [..."P P P P P"],
    [..." C     C "],
    [..."         "],
    [..."RNBAKABNR"]
  ];
}

function cloneBoard(board) {
  return board.map(row => [...row]);
}

function sideOf(piece) {
  if (!piece || piece === " ") return null;
  return piece === piece.toUpperCase() ? Side.RED : Side.BLACK;
}

function opposite(side) {
  return side === Side.RED ? Side.BLACK : Side.RED;
}

function sideText(side) {
  return side === Side.RED ? "红方" : "黑方";
}

function actorText(actor) {
  return actor === Actor.AI ? "AI" : "用户";
}

function modeText(mode) {
  return {
    [Mode.FREE_PLAY]: "自由走棋",
    [Mode.AI_ASSIST]: "AI 接管中",
    [Mode.AUTO_PLAY]: "AI 自战",
    [Mode.CUSTOM_SETUP]: "自定义摆盘",
    [Mode.PAUSED_FREE_PLAY]: "暂停自由模式",
    [Mode.GAME_OVER]: "对局结束"
  }[mode];
}

function inBoard(row, col) {
  return row >= 0 && row < 10 && col >= 0 && col < 9;
}

function fenFromBoard(board, sideToMove) {
  const rows = board.map(row => {
    let out = "";
    let empty = 0;
    for (const piece of row) {
      if (piece === " ") empty++;
      else {
        if (empty) out += empty;
        empty = 0;
        out += piece;
      }
    }
    if (empty) out += empty;
    return out;
  });
  return `${rows.join("/")} ${sideToMove === Side.RED ? "w" : "b"} - - 0 1`;
}

function coordFromPoint(row, col) {
  return `${files[col]}${9 - row}`;
}

function pointFromCoord(coord) {
  return { col: files.indexOf(coord[0]), row: 9 - Number(coord[1]) };
}

function moveToUci(move) {
  return `${coordFromPoint(move.from.row, move.from.col)}${coordFromPoint(move.to.row, move.to.col)}`;
}

function uciToMove(uci) {
  return { from: pointFromCoord(uci.slice(0, 2)), to: pointFromCoord(uci.slice(2, 4)) };
}

function isPseudoLegal(board, from, to) {
  if (!inBoard(from.row, from.col) || !inBoard(to.row, to.col)) return false;
  const piece = board[from.row][from.col];
  const target = board[to.row][to.col];
  if (piece === " " || sideOf(piece) === sideOf(target)) return false;
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const absR = Math.abs(dr);
  const absC = Math.abs(dc);
  const red = sideOf(piece) === Side.RED;

  if (piece.toLowerCase() === "r") {
    if (from.row !== to.row && from.col !== to.col) return false;
    return countBetween(board, from, to) === 0;
  }
  if (piece.toLowerCase() === "n") {
    if (!((absR === 2 && absC === 1) || (absR === 1 && absC === 2))) return false;
    const leg = absR === 2 ? { row: from.row + Math.sign(dr), col: from.col } : { row: from.row, col: from.col + Math.sign(dc) };
    return board[leg.row][leg.col] === " ";
  }
  if (piece.toLowerCase() === "b") {
    if (absR !== 2 || absC !== 2) return false;
    if (red && to.row < 5) return false;
    if (!red && to.row > 4) return false;
    return board[(from.row + to.row) / 2][(from.col + to.col) / 2] === " ";
  }
  if (piece.toLowerCase() === "a") {
    if (absR !== 1 || absC !== 1) return false;
    return inPalace(to, red);
  }
  if (piece.toLowerCase() === "k") {
    if (absR + absC !== 1) return false;
    return inPalace(to, red);
  }
  if (piece.toLowerCase() === "c") {
    if (from.row !== to.row && from.col !== to.col) return false;
    const between = countBetween(board, from, to);
    return target === " " ? between === 0 : between === 1;
  }
  if (piece === "P") {
    if (from.row >= 5) return dr === -1 && dc === 0;
    return (dr === -1 && dc === 0) || (dr === 0 && absC === 1);
  }
  if (piece === "p") {
    if (from.row <= 4) return dr === 1 && dc === 0;
    return (dr === 1 && dc === 0) || (dr === 0 && absC === 1);
  }
  return false;
}

function inPalace(point, red) {
  if (point.col < 3 || point.col > 5) return false;
  return red ? point.row >= 7 && point.row <= 9 : point.row >= 0 && point.row <= 2;
}

function countBetween(board, from, to) {
  let count = 0;
  const stepR = Math.sign(to.row - from.row);
  const stepC = Math.sign(to.col - from.col);
  let row = from.row + stepR;
  let col = from.col + stepC;
  while (row !== to.row || col !== to.col) {
    if (board[row][col] !== " ") count++;
    row += stepR;
    col += stepC;
  }
  return count;
}

function applyMoveOn(board, move) {
  const next = cloneBoard(board);
  next[move.to.row][move.to.col] = next[move.from.row][move.from.col];
  next[move.from.row][move.from.col] = " ";
  return next;
}

function isLegalMove(board, move, side) {
  const piece = board[move.from.row]?.[move.from.col];
  if (sideOf(piece) !== side) return false;
  if (!isPseudoLegal(board, move.from, move.to)) return false;
  return !isInCheck(applyMoveOn(board, move), side);
}

function legalMovesFrom(board, from, side) {
  const moves = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const move = { from, to: { row, col } };
      if (isLegalMove(board, move, side)) moves.push(move);
    }
  }
  return moves;
}

function hasLegalMove(board, side) {
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      if (sideOf(board[row][col]) === side && legalMovesFrom(board, { row, col }, side).length) return true;
    }
  }
  return false;
}

function findKing(board, side) {
  const target = side === Side.RED ? "K" : "k";
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      if (board[row][col] === target) return { row, col };
    }
  }
  return null;
}

function isInCheck(board, side) {
  if (kingsFacing(board)) return true;
  const king = findKing(board, side);
  if (!king) return false;
  const enemy = opposite(side);
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      if (sideOf(board[row][col]) === enemy && isPseudoLegal(board, { row, col }, king)) return true;
    }
  }
  return false;
}

function kingsFacing(board) {
  const redKing = findKing(board, Side.RED);
  const blackKing = findKing(board, Side.BLACK);
  if (!redKing || !blackKing || redKing.col !== blackKing.col) return false;
  for (let row = Math.min(redKing.row, blackKing.row) + 1; row < Math.max(redKing.row, blackKing.row); row++) {
    if (board[row][redKing.col] !== " ") return false;
  }
  return true;
}

function ensureNoKingsFacing(reason = "王见王，局面非法，对局结束。") {
  if (!kingsFacing(state.board)) return true;
  endGame(reason);
  showToast(reason);
  return false;
}

function notationCn(boardBefore, move) {
  const piece = boardBefore[move.from.row][move.from.col];
  const side = sideOf(piece);
  const name = `${sideText(side)}${pieceNames[piece] || piece}`;
  return `${name} ${coordFromPoint(move.from.row, move.from.col)}→${coordFromPoint(move.to.row, move.to.col)}`;
}

function capturedText(piece) {
  if (!piece || piece === " ") return "";
  return `${sideText(sideOf(piece))}${pieceNames[piece] || piece}`;
}

function pieceCounts(board = state.board) {
  const counts = {};
  for (const row of board) {
    for (const piece of row) {
      if (piece !== " ") counts[piece] = (counts[piece] || 0) + 1;
    }
  }
  return counts;
}

function canAddPiece(piece) {
  const counts = pieceCounts();
  return (counts[piece] || 0) < (maxPieceCounts[piece] || 0);
}

function renderSetupTray() {
  const tray = $("#setupTray");
  if (!tray) return;
  const active = state.mode === Mode.CUSTOM_SETUP;
  tray.hidden = !active;
  if (!active) {
    tray.innerHTML = "";
    return;
  }
  const counts = pieceCounts();
  tray.innerHTML = `
    <div class="setup-help">左键选择/移动棋子，右键删除棋子；从下方选择待增补棋子后，左键放到空格。数量不能超过标准配置。</div>
    <div class="setup-pieces">
      ${setupPieceOrder.map(piece => {
        const used = counts[piece] || 0;
        const max = maxPieceCounts[piece];
        const disabled = used >= max;
        const selected = state.setup.selectedPiece === piece;
        return `
          <button class="setup-piece ${sideOf(piece) === Side.RED ? "red-setup" : "black-setup"} ${selected ? "selected-setup-piece" : ""}" data-setup-piece="${piece}" ${disabled ? "disabled" : ""}>
            <span class="setup-piece-mark">${pieceNames[piece]}</span>
            <span class="setup-piece-count">${used}/${max}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function scoreToRedWinPercent(result) {
  if (!result || result.scoreValue === null || result.scoreValue === undefined) return null;
  const cp = Number(result.scoreRedPerspective ?? result.scoreValue);
  if (result.scoreType === "MATE") return cp > 0 ? 99 : 1;
  return Math.round((1 / (1 + Math.exp(-cp / 400))) * 1000) / 10;
}

function scoreText(result) {
  if (!result || result.scoreValue === null || result.scoreValue === undefined) return "暂无评分";
  const redScore = result.scoreRedPerspective ?? result.scoreValue;
  if (result.scoreType === "MATE") return `杀棋距离：${redScore > 0 ? "红方" : "黑方"}约 ${Math.abs(redScore)} 步`;
  const sign = redScore > 0 ? "+" : "";
  const desc = Math.abs(redScore) < 60 ? "接近平衡" : redScore > 0 ? "红方较优" : "黑方较优";
  return `局面评分：红方约 ${sign}${redScore}，${desc}`;
}

function boardMarkingsMarkup() {
  const xs = Array.from({ length: 9 }, (_, index) => index + 0.5);
  const topYs = Array.from({ length: 5 }, (_, index) => index + 0.5);
  const bottomYs = Array.from({ length: 5 }, (_, index) => index + 6.15);
  const allYs = [...topYs, ...bottomYs];
  const horizontals = allYs
    .map(y => `<line class="board-line" x1="0.5" y1="${y}" x2="8.5" y2="${y}"></line>`)
    .join("");
  const verticals = xs.map(x => {
    if (x === 0.5 || x === 8.5) {
      return `<line class="board-line board-border-line" x1="${x}" y1="0.5" x2="${x}" y2="10.15"></line>`;
    }
    return `
      <line class="board-line" x1="${x}" y1="0.5" x2="${x}" y2="4.5"></line>
      <line class="board-line" x1="${x}" y1="6.15" x2="${x}" y2="10.15"></line>
    `;
  }).join("");
  return `
    ${horizontals}
    ${verticals}
    <rect class="palace-line palace-bold" x="3.5" y="0.5" width="2" height="2" fill="none"></rect>
    <line class="palace-line palace-bold" x1="3.5" y1="0.5" x2="5.5" y2="2.5"></line>
    <line class="palace-line palace-bold" x1="5.5" y1="0.5" x2="3.5" y2="2.5"></line>
    <rect class="palace-line palace-bold" x="3.5" y="8.15" width="2" height="2" fill="none"></rect>
    <line class="palace-line palace-bold" x1="3.5" y1="8.15" x2="5.5" y2="10.15"></line>
    <line class="palace-line palace-bold" x1="5.5" y1="8.15" x2="3.5" y2="10.15"></line>
  `;
}

function render() {
  renderBoard();
  $("#modeBadge").textContent = modeText(state.mode);
  $("#turnBtn").textContent = `当前轮到：${sideText(state.sideToMove)}${state.locked ? "（棋盘锁定）" : ""}${state.mode === Mode.CUSTOM_SETUP ? "（摆盘中）" : ""}`;
  $("#engineStatus").textContent = `引擎：${state.engineStatus?.status || "未启动"}`;
  $("#autoStatus").textContent = state.mode === Mode.AUTO_PLAY
    ? (state.auto.countdown > 0 ? `自动模式：${state.auto.countdown} 秒后继续` : "自动模式：正在计算")
    : "自动模式：未启动";
  $("#fenText").textContent = fenFromBoard(state.board, state.sideToMove);
  $("#exportStatus").textContent = state.exportStatus;
  renderButtons();
  renderHistory();
  renderLogs();
  renderResult();
  renderTrend();
  renderSetupTray();
}

function renderButtons() {
  const isSetup = state.mode === Mode.CUSTOM_SETUP;
  $("#startBtn").disabled = state.mode === Mode.GAME_OVER || state.mode === Mode.AUTO_PLAY || state.locked || isSetup;
  $("#autoBtn").disabled = state.mode === Mode.GAME_OVER || state.mode === Mode.AUTO_PLAY || state.locked || isSetup;
  $("#stopAutoBtn").disabled = state.mode !== Mode.AUTO_PLAY;
  $("#pauseBtn").disabled = state.mode === Mode.GAME_OVER || state.mode === Mode.FREE_PLAY || state.mode === Mode.PAUSED_FREE_PLAY || isSetup;
  $("#stopBtn").disabled = (!state.locked && state.mode !== Mode.AUTO_PLAY) || isSetup;
  $("#undoBtn").disabled = state.locked || !state.moveHistory.length || isSetup;
  $("#undoRoundBtn").disabled = state.locked || !state.moveHistory.length || isSetup;
  $("#setupBtn").textContent = isSetup ? "完成摆盘" : "自定义摆盘";
  $("#setupBtn").classList.toggle("btn-primary", isSetup);
  $("#flipBoardBtn").textContent = state.boardFlipped ? "恢复方向" : "反转棋盘";
  $("#flipBoardBtn").classList.toggle("btn-primary", state.boardFlipped);
  $("#finishBtn").disabled = state.mode === Mode.GAME_OVER || isSetup;
  $("#turnBtn").disabled = state.locked || state.mode === Mode.AI_ASSIST || state.mode === Mode.AUTO_PLAY || state.mode === Mode.GAME_OVER;
}

function renderBoard() {
  boardEl.innerHTML = "";
  const markings = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  markings.setAttribute("class", "board-markings");
  markings.setAttribute("viewBox", "0 0 9 10.65");
  markings.setAttribute("preserveAspectRatio", "none");
  markings.innerHTML = boardMarkingsMarkup();
  boardEl.append(markings);
  const river = document.createElement("div");
  river.className = "river-label";
  river.innerHTML = "<span>楚河</span><span>汉界</span>";
  boardEl.append(river);
  const showCoords = state.settings?.ui?.showCoords ?? true;
  const showLastMove = state.settings?.ui?.showLastMove ?? true;
  const showLegalTips = state.settings?.ui?.showLegalTips ?? true;
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const visualRow = state.boardFlipped ? 9 - row : row;
      const visualCol = state.boardFlipped ? 8 - col : col;
      const square = document.createElement("button");
      square.className = "square";
      square.type = "button";
      square.dataset.row = row;
      square.dataset.col = col;
      square.style.gridColumn = `${visualCol + 1}`;
      square.style.gridRow = `${visualRow < 5 ? visualRow + 1 : visualRow + 2}`;
      if (visualCol === 8) square.classList.add("edge-right");
      if (visualRow === 9) square.classList.add("edge-bottom");
      if (state.setup.selectedBoard && pointEq(state.setup.selectedBoard, { row, col })) square.classList.add("setup-selected");
      if (showLastMove && state.lastMove && (pointEq(state.lastMove.from, { row, col }) || pointEq(state.lastMove.to, { row, col }))) {
        square.classList.add("last");
      }
      if (showLegalTips && state.legalTips.some(move => pointEq(move.to, { row, col }))) square.classList.add("legal");
      const piece = state.board[row][col];
      if (piece !== " ") {
        const pieceEl = document.createElement("span");
        pieceEl.className = `piece ${sideOf(piece) === Side.RED ? "red" : "black"}`;
        if (state.selected && state.selected.row === row && state.selected.col === col) pieceEl.classList.add("selected");
        pieceEl.textContent = pieceNames[piece] || piece;
        square.append(pieceEl);
      }
      if (showCoords) {
        const coord = document.createElement("span");
        coord.className = "coord";
        coord.textContent = coordFromPoint(row, col);
        square.append(coord);
      }
      square.addEventListener("click", () => handleSquareClick(row, col));
      square.addEventListener("contextmenu", event => {
        event.preventDefault();
        handleSquareRightClick(row, col);
      });
      boardEl.append(square);
    }
  }
}

function pointEq(a, b) {
  return a?.row === b?.row && a?.col === b?.col;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("success");
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function showSuccessToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show", "success");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show", "success"), 3600);
}

function toggleSideToMove() {
  if (state.locked || state.mode === Mode.AI_ASSIST || state.mode === Mode.AUTO_PLAY || state.mode === Mode.GAME_OVER) {
    return notify("计算或对局锁定时不能切换当前先手。", "error", true);
  }
  state.sideToMove = opposite(state.sideToMove);
  state.selected = null;
  state.legalTips = [];
  state.currentResult = null;
  const fen = fenFromBoard(state.board, state.sideToMove);
  addLog("warn", "切换当前先手", `已切换为${sideText(state.sideToMove)}走。当前 FEN：${fen}`, null, fen);
  render();
  if (state.mode !== Mode.CUSTOM_SETUP) runShortAnalysis();
}

function toggleBoardFlip() {
  state.boardFlipped = !state.boardFlipped;
  state.selected = null;
  state.legalTips = [];
  render();
}

function handleSquareClick(row, col) {
  if (state.mode === Mode.CUSTOM_SETUP) return handleSetupLeftClick(row, col);
  if (state.mode === Mode.GAME_OVER || state.locked || state.mode === Mode.AUTO_PLAY) {
    return notify("当前棋盘锁定，不能走棋。", "error", true);
  }
  const piece = state.board[row][col];
  if (!state.selected) {
    if (piece === " ") return;
    const side = sideOf(piece);
    if (side !== state.sideToMove) return notify(`当前轮到${sideText(state.sideToMove)}。`, "error", true);
    if (state.mode === Mode.AI_ASSIST && side !== state.humanSide) return notify("AI 接管模式中不能操作 AI 方。", "error", true);
    state.selected = { row, col };
    state.legalTips = legalMovesFrom(state.board, state.selected, state.sideToMove);
    render();
    return;
  }
  const move = { from: state.selected, to: { row, col } };
  const selectedPiece = state.board[state.selected.row][state.selected.col];
  if (piece !== " " && sideOf(piece) === sideOf(selectedPiece)) {
    state.selected = { row, col };
    state.legalTips = legalMovesFrom(state.board, state.selected, state.sideToMove);
    render();
    return;
  }
  if (!isLegalMove(state.board, move, state.sideToMove)) {
    state.selected = null;
    state.legalTips = [];
    render();
    return notify("这步棋不合法，已拦截。", "error", true);
  }
  state.selected = null;
  state.legalTips = [];
  commitMove(move, Actor.HUMAN);
  if (state.mode === Mode.AI_ASSIST) {
    state.locked = true;
    render();
    runShortAnalysis().finally(() => performAssistAiMove());
  } else {
    runShortAnalysis();
  }
}

function handleSquareRightClick(row, col) {
  if (state.mode !== Mode.CUSTOM_SETUP) return;
  if (state.board[row][col] === " ") return;
  const removed = state.board[row][col];
  state.board[row][col] = " ";
  state.setup.selectedBoard = null;
  state.setup.dirty = true;
  addLog("warn", "摆盘删除棋子", `已从 ${coordFromPoint(row, col)} 删除${capturedText(removed)}。`, null, fenFromBoard(state.board, state.sideToMove));
  render();
}

function handleSetupLeftClick(row, col) {
  const piece = state.board[row][col];
  if (state.setup.selectedPiece) {
    if (piece !== " ") return notify("目标位置已有棋子，请先右键删除或选择其它空格。", "error", true);
    if (!canAddPiece(state.setup.selectedPiece)) return notify(`${capturedText(state.setup.selectedPiece)}数量已达到上限。`, "error", true);
    state.board[row][col] = state.setup.selectedPiece;
    state.setup.dirty = true;
    addLog("warn", "摆盘添加棋子", `已在 ${coordFromPoint(row, col)} 添加${capturedText(state.setup.selectedPiece)}。`, null, fenFromBoard(state.board, state.sideToMove));
    state.setup.selectedPiece = null;
    render();
    return;
  }
  if (state.setup.selectedBoard) {
    if (pointEq(state.setup.selectedBoard, { row, col })) {
      state.setup.selectedBoard = null;
      render();
      return;
    }
    if (piece !== " ") return notify("目标位置已有棋子，请先右键删除或选择空格移动。", "error", true);
    const from = state.setup.selectedBoard;
    const moving = state.board[from.row][from.col];
    if (moving === " ") {
      state.setup.selectedBoard = null;
      render();
      return;
    }
    state.board[row][col] = moving;
    state.board[from.row][from.col] = " ";
    state.setup.selectedBoard = null;
    state.setup.dirty = true;
    addLog("warn", "摆盘移动棋子", `已将${capturedText(moving)}从 ${coordFromPoint(from.row, from.col)} 移到 ${coordFromPoint(row, col)}。`, null, fenFromBoard(state.board, state.sideToMove));
    render();
    return;
  }
  if (piece !== " ") {
    state.setup.selectedBoard = { row, col };
    state.setup.selectedPiece = null;
    render();
  }
}

function buildMoveMessage(moveRecord) {
  const parts = [
    `${sideText(moveRecord.side)}由${actorText(moveRecord.actor)}走：${moveRecord.notationCn}（${moveRecord.notationUci}）`,
    `起点 ${coordFromPoint(moveRecord.move.from.row, moveRecord.move.from.col)}，终点 ${coordFromPoint(moveRecord.move.to.row, moveRecord.move.to.col)}`
  ];
  if (moveRecord.isCapture) parts.push(`吃掉${moveRecord.capturedText}`);
  if (moveRecord.isKingsFacing) parts.push("王见王");
  if (moveRecord.isCheckmate) parts.push("将死");
  else if (moveRecord.isCheck) parts.push("将军");
  if (moveRecord.engineEvaluationAfterMove) {
    parts.push(scoreText(moveRecord.engineEvaluationAfterMove));
    const win = scoreToRedWinPercent(moveRecord.engineEvaluationAfterMove);
    if (win !== null) parts.push(`优势倾向：红方 ${win}%`);
  }
  if (moveRecord.actor === Actor.AI && moveRecord.engineEvaluationAfterMove) {
    const result = moveRecord.engineEvaluationAfterMove;
    parts.push(`AI 耗时 ${formatMs(result.timeMs)}，深度 ${result.depth ?? "未知"}，节点 ${formatNumber(result.nodes)}`);
    if (result.principalVariation?.length) parts.push(`主要变化：${result.principalVariation.slice(0, 6).join(" ")}`);
  }
  parts.push(`当前 FEN：${moveRecord.fenAfter}`);
  return parts.join("；");
}

function commitMove(move, actor, engineResult = null) {
  const before = cloneBoard(state.board);
  const movingSide = state.sideToMove;
  const captured = before[move.to.row][move.to.col];
  const fenBefore = fenFromBoard(state.board, state.sideToMove);
  const uci = moveToUci(move);
  const cn = notationCn(before, move);
  state.board = applyMoveOn(state.board, move);
  state.sideToMove = opposite(state.sideToMove);
  const fenAfter = fenFromBoard(state.board, state.sideToMove);
  const isCapture = captured !== " ";
  const isKingsFacing = kingsFacing(state.board);
  const isCheck = isInCheck(state.board, state.sideToMove);
  const noLegalReply = !hasLegalMove(state.board, state.sideToMove);
  const isCheckmate = isCheck && noLegalReply;
  const id = `m${Date.now()}${state.moveHistory.length}`;
  const moveRecord = {
    id,
    moveNumber: Math.floor(state.moveHistory.length / 2) + 1,
    side: movingSide,
    move,
    notationCn: cn,
    notationUci: uci,
    fenBefore,
    fenAfter,
    actor,
    timestamp: new Date().toISOString(),
    isCapture,
    capturedPiece: isCapture ? captured : null,
    capturedSide: isCapture ? sideOf(captured) : null,
    capturedText: isCapture ? capturedText(captured) : "",
    isCheck,
    isCheckmate,
    isKingsFacing,
    isNoLegalReply: noLegalReply,
    engineEvaluationAfterMove: engineResult,
    relatedLogEntryIds: []
  };
  state.moveHistory.push(moveRecord);
  state.lastMove = move;
  state.selectedMoveId = id;
  const logType = isKingsFacing || isCheckmate ? "gameover" : isCheck ? "check" : isCapture ? "capture" : "move";
  const title = isKingsFacing ? "王见王" : isCheckmate ? "将死" : isCheck ? "将军" : isCapture ? "吃子" : `${actorText(actor)}走棋`;
  addLog(logType, title, buildMoveMessage(moveRecord), id, fenAfter, engineResult?.rawInfoLines?.join("\n"), engineResult);

  if (!findKing(state.board, Side.RED) || !findKing(state.board, Side.BLACK)) {
    endGame("一方将帅已被吃掉。");
  } else if (isKingsFacing) {
    endGame("王见王，局面非法，对局结束。");
  } else if (noLegalReply) {
    endGame(isCheckmate ? `${sideText(state.sideToMove)}被将死。` : `${sideText(state.sideToMove)}无合法走法。`);
  }
  render();
  return moveRecord;
}

function endGame(reason) {
  if (state.mode === Mode.GAME_OVER && state.endReason) return;
  deactivateAuto();
  state.mode = Mode.GAME_OVER;
  state.locked = false;
  state.gameEndedAt = new Date().toISOString();
  state.endReason = reason;
  addLog("gameover", "对局结束", reason, null, fenFromBoard(state.board, state.sideToMove));
  autoExportGame().catch(err => {
    addLog("error", "自动导出失败", err.message, null, fenFromBoard(state.board, state.sideToMove));
    render();
  });
}

async function ensureEngineReady() {
  const status = await api("/api/engine/status");
  state.engineStatus = status;
  if (status.status === "可用") return true;
  if (state.settings?.enginePath) {
    state.engineStatus = await api("/api/engine/start", {
      method: "POST",
      body: { enginePath: state.settings.enginePath, options: state.settings.engineOptions }
    });
    return true;
  }
  $("#settingsDialog").showModal();
  notify("引擎未配置或不可用，请在设置页填写 Pikafish 可执行文件路径并测试。", "error", true);
  return false;
}

async function startAiAssist() {
  if (state.mode === Mode.GAME_OVER) return notify("对局已经结束，请重新开始。", "error", true);
  if (!ensureNoKingsFacing()) return;
  if (!(await ensureEngineReady())) return;
  deactivateAuto();
  state.aiSide = state.sideToMove;
  state.humanSide = opposite(state.aiSide);
  state.mode = Mode.AI_ASSIST;
  state.locked = true;
  addLog("engine", "开始计算", `AI 接管${sideText(state.aiSide)}，用户执${sideText(state.humanSide)}。`, null, fenFromBoard(state.board, state.sideToMove));
  render();
  await performAssistAiMove();
}

async function performAssistAiMove() {
  if (state.mode !== Mode.AI_ASSIST || state.sideToMove !== state.aiSide) {
    state.locked = false;
    render();
    return;
  }
  const record = await performEngineMove();
  if (record && state.mode !== Mode.GAME_OVER) state.locked = false;
  render();
}

async function performEngineMove(token = null) {
  if (!ensureNoKingsFacing()) return null;
  state.locked = true;
  state.isCalculating = true;
  render();
  try {
    const search = currentSearchSettings();
    const fen = fenFromBoard(state.board, state.sideToMove);
    const result = await api("/api/search", {
      method: "POST",
      body: { fen, mode: search.mode, value: search.value, multipv: search.multipv, options: selectedEngineOptions() }
    });
    if (token !== null && (!state.auto.active || state.auto.token !== token)) {
      state.isCalculating = false;
      return null;
    }
    const move = uciToMove(result.bestMove);
    if (!isLegalMove(state.board, move, state.sideToMove)) throw new Error(`引擎返回了当前规则检查未接受的走法：${result.bestMove}`);
    result.bestMoveDisplay = notationCn(state.board, move);
    for (const candidate of result.candidateMoves || []) {
      if (candidate.move?.length >= 4) candidate.display = notationCn(state.board, uciToMove(candidate.move));
    }
    state.currentResult = result;
    state.isCalculating = false;
    const record = commitMove(move, Actor.AI, result);
    pushTrend(result, record);
    return record;
  } catch (err) {
    state.locked = false;
    state.isCalculating = false;
    addLog("error", "AI 计算失败", err.message, null, fenFromBoard(state.board, state.sideToMove));
    if (state.mode === Mode.AUTO_PLAY) stopAutoMode("引擎报错，自动模式已停止。");
    return null;
  }
}

async function startAutoMode() {
  if (state.mode === Mode.GAME_OVER) return notify("对局已经结束，请重新开始。", "error", true);
  if (state.auto.active) return notify("自动模式已经在运行。", "error", true);
  if (!ensureNoKingsFacing()) return;
  if (!(await ensureEngineReady())) return;
  state.auto.active = true;
  state.auto.token += 1;
  state.auto.countdown = 0;
  state.mode = Mode.AUTO_PLAY;
  state.aiSide = null;
  state.humanSide = null;
  state.locked = true;
  addLog("engine", "AI 自战启动", `AI 将同时控制红黑双方，每步之间延迟 ${autoDelaySeconds()} 秒。`, null, fenFromBoard(state.board, state.sideToMove));
  render();
  runAutoLoop(state.auto.token);
}

async function runAutoLoop(token) {
  while (state.auto.active && state.auto.token === token && state.mode === Mode.AUTO_PLAY) {
    if (!hasLegalMove(state.board, state.sideToMove)) {
      endGame(`${sideText(state.sideToMove)}无合法走法。`);
      break;
    }
    const record = await performEngineMove(token);
    if (!record || state.mode === Mode.GAME_OVER || !state.auto.active || state.auto.token !== token) break;
    await waitAutoDelay(token, autoDelaySeconds());
  }
  if (state.mode === Mode.AUTO_PLAY && (!state.auto.active || state.auto.token !== token)) {
    state.locked = false;
    render();
  }
}

function waitAutoDelay(token, seconds) {
  return new Promise(resolve => {
    state.auto.countdown = seconds;
    render();
    const tick = () => {
      if (!state.auto.active || state.auto.token !== token || state.mode !== Mode.AUTO_PLAY) {
        state.auto.countdown = 0;
        render();
        resolve();
        return;
      }
      state.auto.countdown -= 1;
      render();
      if (state.auto.countdown <= 0) {
        resolve();
      } else {
        state.auto.timer = setTimeout(tick, 1000);
      }
    };
    state.auto.timer = setTimeout(tick, 1000);
  });
}

function autoDelaySeconds() {
  const value = Number(state.settings?.autoPlayDelaySeconds ?? 2);
  return Math.max(0, Math.min(30, Number.isFinite(value) ? value : 2));
}

function deactivateAuto() {
  state.auto.active = false;
  state.auto.token += 1;
  state.auto.countdown = 0;
  clearTimeout(state.auto.timer);
  state.auto.timer = null;
}

async function stopAutoMode(message = "自动模式已停止，当前局面保留。") {
  deactivateAuto();
  await api("/api/engine/stop", { method: "POST" }).catch(() => null);
  if (state.mode === Mode.AUTO_PLAY) state.mode = Mode.PAUSED_FREE_PLAY;
  state.locked = false;
  addLog("engine", "停止自动模式", message, null, fenFromBoard(state.board, state.sideToMove));
  render();
}

async function pauseGame() {
  deactivateAuto();
  await api("/api/engine/stop", { method: "POST" }).catch(() => null);
  if (state.mode !== Mode.GAME_OVER) {
    state.mode = Mode.PAUSED_FREE_PLAY;
    state.locked = false;
    state.aiSide = null;
    state.humanSide = null;
  }
  addLog("engine", "暂停", "已暂停，当前可自由操作红黑双方；再次开始计算后将重新确定 AI 执棋方。", null, fenFromBoard(state.board, state.sideToMove));
  render();
}

async function runShortAnalysis() {
  if (state.analysisInFlight || !state.settings?.analysis?.enabled || state.engineStatus?.status !== "可用" || state.mode === Mode.GAME_OVER) return;
  if (!ensureNoKingsFacing()) return;
  state.analysisInFlight = true;
  try {
    const analysis = state.settings.analysis;
    const value = analysis.mode === "depth" ? analysis.depth : analysis.movetime;
    const result = await api("/api/search", {
      method: "POST",
      body: { fen: fenFromBoard(state.board, state.sideToMove), mode: analysis.mode || "movetime", value, multipv: analysis.multipv || 3, options: selectedEngineOptions() }
    });
    state.currentResult = result;
    const last = state.moveHistory[state.moveHistory.length - 1];
    if (last) last.engineEvaluationAfterMove = result;
    pushTrend(result, last);
    addLog("engine", "局面评分", `${scoreText(result)}，优势倾向：红方 ${scoreToRedWinPercent(result)}%。`, last?.id, fenFromBoard(state.board, state.sideToMove), result.rawInfoLines?.join("\n"), result);
    render();
  } catch (err) {
    addLog("error", "短分析失败", err.message, null, fenFromBoard(state.board, state.sideToMove));
  } finally {
    state.analysisInFlight = false;
  }
}

function currentSearchSettings() {
  const preset = state.settings.skillPreset === "custom" ? state.settings.customSearch : presetMap[state.settings.skillPreset] || presetMap["3"];
  return {
    mode: preset.mode || "movetime",
    value: (preset.mode || "movetime") === "depth" ? preset.depth : preset.movetime,
    multipv: Number(state.settings.customSearch?.multipv || 3)
  };
}

function selectedEngineOptions() {
  const values = {};
  document.querySelectorAll("[data-engine-option]").forEach(input => {
    values[input.dataset.engineOption] = input.type === "checkbox" ? (input.checked ? "true" : "false") : input.value;
  });
  return { ...state.settings?.engineOptions, ...values };
}

function pushTrend(result, moveRecord) {
  const percent = scoreToRedWinPercent(result);
  if (percent === null) return;
  state.trend.push({
    id: `t${Date.now()}${state.trend.length}`,
    moveId: moveRecord?.id || null,
    ply: state.moveHistory.length,
    move: moveRecord?.notationCn || "当前局面",
    actor: moveRecord?.actor || "ANALYSIS",
    redWinPercent: percent,
    rawScore: result.scoreRedPerspective ?? result.scoreValue,
    scoreType: result.scoreType
  });
}

function addLog(type, title, message, moveRecordId = null, fen = null, rawEngineOutput = null, structuredEngineResult = null) {
  const entry = {
    id: `l${Date.now()}${state.logEntries.length}`,
    timestamp: new Date().toISOString(),
    type,
    title,
    message,
    moveRecordId,
    fen,
    rawEngineOutput,
    structuredEngineResult
  };
  state.logEntries.push(entry);
  if (moveRecordId) {
    const move = state.moveHistory.find(item => item.id === moveRecordId);
    if (move) move.relatedLogEntryIds.push(entry.id);
  }
}

function notify(message, type = "warn", banner = false) {
  if (banner || type === "error") showToast(message);
  addLog(type, "提示", message, null, fenFromBoard(state.board, state.sideToMove));
  render();
}

function renderResult() {
  const panel = $("#resultPanel");
  if (state.isCalculating && !state.currentResult) {
    panel.innerHTML = "<div>正在计算，请稍候...</div>";
    return;
  }
  const result = state.currentResult;
  if (!result) {
    panel.textContent = "尚未计算。可在自由模式短分析，或点击“开始计算”让 AI 接管当前方。";
    return;
  }
  const win = scoreToRedWinPercent(result);
  const candidates = (result.candidateMoves || []).map(item => `<li>${item.rank}. ${formatMove(item.move, item.display)}，评分 ${formatCandidateScore(item)}</li>`).join("");
  const pv = (result.principalVariation || []).slice(0, 8).map((move, index) => `<li>${index + 1}. ${formatMove(move)}</li>`).join("");
  panel.innerHTML = `
    ${state.isCalculating ? "<div class=\"calc-badge\">正在计算下一步，当前结果保持显示。</div>" : ""}
    <div><strong>推荐走法：</strong>${formatMove(result.bestMove, result.bestMoveDisplay)}</div>
    <div><strong>坐标表示：</strong>${result.bestMove || "无"}</div>
    <div><strong>本步计算耗时：</strong>${formatMs(result.timeMs)}</div>
    <div><strong>搜索深度：</strong>${result.depth ?? "未知"} 层</div>
    <div><strong>选择性深度：</strong>${result.selectiveDepth ?? "未知"} 层</div>
    <div><strong>${scoreText(result)}</strong></div>
    <div><strong>优势倾向：</strong>${win === null ? "未知" : `红方 ${win}%`}</div>
    <div><strong>已评估局面：</strong>${formatNumber(result.nodes)} 个</div>
    <div><strong>计算速度：</strong>${formatNumber(result.nps)} 局面/秒</div>
    <div><strong>主要变化：</strong><ol>${pv || "<li>暂无</li>"}</ol></div>
    <div><strong>候选招法：</strong><ol>${candidates || "<li>暂无</li>"}</ol></div>
  `;
}

function formatMove(uci, display = "") {
  if (display) return display;
  if (!uci || uci.length < 4) return "暂无";
  const move = uciToMove(uci);
  const piece = state.board[move.from.row]?.[move.from.col];
  const name = piece && piece !== " " ? pieceNames[piece] : "棋子";
  return `${name} ${uci.slice(0, 2)}→${uci.slice(2, 4)}`;
}

function formatCandidateScore(item) {
  if (item.scoreValue === null || item.scoreValue === undefined) return "未知";
  return item.scoreType === "MATE" ? `杀 ${item.scoreValue}` : `${item.scoreValue > 0 ? "+" : ""}${item.scoreValue}`;
}

function formatMs(ms) {
  if (ms === null || ms === undefined) return "未知";
  return `${(ms / 1000).toFixed(2)} 秒`;
}

function formatNumber(value) {
  if (value === null || value === undefined) return "未知";
  return Number(value).toLocaleString("zh-CN");
}

function historyButton(move, colorClass) {
  if (!move) return `<button disabled></button>`;
  const tags = [
    `<span class="tag ${move.actor === Actor.AI ? "tag-ai" : "tag-human"}">${actorText(move.actor)}</span>`,
    move.isCapture ? `<span class="tag tag-capture">吃${move.capturedText}</span>` : "",
    move.isKingsFacing ? `<span class="tag tag-face">王见王</span>` : "",
    move.isCheckmate ? `<span class="tag tag-mate">将死</span>` : move.isCheck ? `<span class="tag tag-check">将军</span>` : ""
  ].filter(Boolean).join("");
  return `
    <button data-move-id="${move.id}" class="${colorClass} ${state.selectedMoveId === move.id ? "active-history" : ""}">
      <span class="move-card">
        <span class="move-main">${move.notationCn} / ${move.notationUci}</span>
        <span class="move-tags">${tags}</span>
      </span>
    </button>
  `;
}

function renderHistory() {
  const grouped = [];
  for (const move of state.moveHistory) {
    const index = move.moveNumber - 1;
    grouped[index] ||= { number: move.moveNumber, red: null, black: null };
    grouped[index][move.side === Side.RED ? "red" : "black"] = move;
  }
  $("#moveHistory").innerHTML = grouped.reverse().map(row => `
    <div class="history-row">
      <div>${row.number}.</div>
      ${historyButton(row.red, "red-move")}
      ${historyButton(row.black, "black-move")}
    </div>
  `).join("") || "<div class='muted'>暂无走法。</div>";
}

function renderLogs() {
  $("#logEntries").innerHTML = state.logEntries.slice().reverse().map(entry => `
    <article class="log-entry ${entry.type} ${entry.moveRecordId === state.selectedMoveId ? "highlight-log" : ""}" id="${entry.id}">
      <div class="log-title">${new Date(entry.timestamp).toLocaleTimeString("zh-CN")} · ${entry.title}</div>
      <div class="log-message">${entry.message}</div>
    </article>
  `).join("") || "<div class='muted'>暂无日志。</div>";
}

function renderTrend() {
  const svg = $("#trendChart");
  const width = 520;
  const height = 180;
  const pad = 24;
  const points = state.trend;
  let body = `
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#b9c3ca"/>
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#b9c3ca"/>
    <line x1="${pad}" y1="${height / 2}" x2="${width - pad}" y2="${height / 2}" stroke="#c28b21" stroke-dasharray="5 5"/>
    <text x="${pad + 4}" y="${height / 2 - 6}" fill="#8b6a3e" font-size="12">50%</text>
  `;
  if (points.length) {
    const maxX = Math.max(1, points.length - 1);
    const coords = points.map((point, index) => {
      const x = pad + (index / maxX) * (width - pad * 2);
      const y = height - pad - (point.redWinPercent / 100) * (height - pad * 2);
      return { x, y, point };
    });
    body += `<polyline points="${coords.map(p => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="#1d64a7" stroke-width="2"/>`;
    body += coords.map(({ x, y, point }) => `<circle cx="${x}" cy="${y}" r="4" fill="#1d64a7"><title>第 ${point.ply} 手：${point.move}\n红方优势倾向 ${point.redWinPercent}%\nraw score ${point.rawScore}\n${point.actor === Actor.AI ? "AI 走" : point.actor === Actor.HUMAN ? "用户走" : "局面分析"}</title></circle>`).join("");
  }
  svg.innerHTML = body;
}

async function loadSettings() {
  state.settings = await api("/api/settings");
  $("#enginePathInput").value = state.settings.enginePath || "";
  $("#presetSelect").value = state.settings.skillPreset || "3";
  $("#searchModeSelect").value = state.settings.customSearch?.mode || "movetime";
  $("#depthInput").value = state.settings.customSearch?.depth || 7;
  $("#movetimeInput").value = state.settings.customSearch?.movetime || 800;
  $("#multipvInput").value = state.settings.customSearch?.multipv || 3;
  $("#autoDelayInput").value = state.settings.autoPlayDelaySeconds ?? 2;
  $("#autoAnalysisInput").checked = state.settings.analysis?.enabled ?? true;
  $("#analysisMovetimeInput").value = state.settings.analysis?.movetime || 300;
  $("#analysisDepthInput").value = state.settings.analysis?.depth || 7;
  $("#showCoordsInput").checked = state.settings.ui?.showCoords ?? true;
  $("#showLastMoveInput").checked = state.settings.ui?.showLastMove ?? true;
  $("#showLegalTipsInput").checked = state.settings.ui?.showLegalTips ?? true;
  updateSettingsControls();
}

function collectSettings() {
  return {
    ...state.settings,
    enginePath: $("#enginePathInput").value.trim(),
    skillPreset: $("#presetSelect").value,
    customSearch: {
      mode: $("#searchModeSelect").value,
      depth: Number($("#depthInput").value),
      movetime: Number($("#movetimeInput").value),
      multipv: Number($("#multipvInput").value)
    },
    autoPlayDelaySeconds: Number($("#autoDelayInput").value),
    analysis: {
      enabled: $("#autoAnalysisInput").checked,
      mode: "movetime",
      depth: Number($("#analysisDepthInput").value),
      movetime: Number($("#analysisMovetimeInput").value),
      multipv: Number($("#multipvInput").value)
    },
    ui: {
      showCoords: $("#showCoordsInput").checked,
      showLastMove: $("#showLastMoveInput").checked,
      showLegalTips: $("#showLegalTipsInput").checked,
      notation: "both",
      logLevel: "standard"
    },
    engineOptions: selectedEngineOptions()
  };
}

async function saveSettings() {
  state.settings = await api("/api/settings", { method: "POST", body: collectSettings() });
  updateSettingsControls();
  $("#settingsFeedback").textContent = "设置已保存并生效。";
  showSuccessToast("设置已保存并生效。");
  addLog("engine", "保存设置", "设置已持久化并生效。");
  render();
}

function updateSettingsControls() {
  const customEnabled = $("#presetSelect").value === "custom";
  const customFields = $("#customSearchFields");
  customFields.classList.toggle("is-disabled-setting", !customEnabled);
  for (const input of customFields.querySelectorAll("input, select")) {
    if (input.id === "autoDelayInput") {
      input.disabled = false;
    } else {
      input.disabled = !customEnabled;
    }
  }
}

async function testEngine() {
  await saveSettings();
  const status = await api("/api/engine/test", { method: "POST", body: { enginePath: state.settings.enginePath, options: state.settings.engineOptions } });
  state.engineStatus = status;
  renderEngineOptions(status.options || []);
  $("#engineInfo").textContent = `引擎状态：${status.status}；名称：${status.name || "未知"}；作者：${status.author || "未知"}`;
  addLog("engine", "引擎测试成功", `已连接 ${status.name || "Pikafish"}。`);
  render();
}

function renderEngineOptions(options) {
  const commonHelp = {
    Threads: "计算线程数，越高通常越快，但更占 CPU。",
    Hash: "哈希表大小，越高越吃内存，通常能提高深度搜索效率。",
    MultiPV: "候选招法数量，1 表示只显示最佳招；大于 1 可显示多个候选方案。",
    "Move Overhead": "每步预留时间，防止超时用；本应用不强制限时，可作为高级项。",
    UCI_AnalyseMode: "分析模式开关。"
  };
  $("#engineOptions").innerHTML = options.map(option => {
    const saved = state.settings.engineOptions?.[option.name] ?? option.default ?? "";
    if (option.type === "button") {
      return `<label>${option.name}<span class="note">${commonHelp[option.name] || option.type}</span><input data-engine-option="${option.name}" value="${saved}" disabled></label>`;
    }
    if (option.type === "check") {
      return `<label>${option.name}<span class="note">${commonHelp[option.name] || option.type}</span><input data-engine-option="${option.name}" type="checkbox" ${String(saved) === "true" ? "checked" : ""}></label>`;
    }
    return `<label>${option.name}<span class="note">${commonHelp[option.name] || option.type}</span><input data-engine-option="${option.name}" value="${saved}"></label>`;
  }).join("");
}

function undoOne() {
  if (!state.moveHistory.length) return;
  if (state.locked) api("/api/engine/stop", { method: "POST" }).catch(() => null);
  state.moveHistory.pop();
  rebuildFromHistory();
  addLog("warn", "悔棋", "已撤销一步，并同步棋盘、FEN、历史和走势图。", null, fenFromBoard(state.board, state.sideToMove));
  render();
}

function undoRound() {
  if (state.moveHistory.length) state.moveHistory.pop();
  if (state.moveHistory.length) state.moveHistory.pop();
  rebuildFromHistory();
  addLog("warn", "悔一轮", "已撤销最近一轮。", null, fenFromBoard(state.board, state.sideToMove));
  render();
}

function rebuildFromHistory() {
  const records = [...state.moveHistory];
  state.board = createInitialBoard();
  state.sideToMove = Side.RED;
  state.moveHistory = [];
  state.trend = [];
  state.lastMove = null;
  state.selectedMoveId = null;
  state.mode = state.mode === Mode.GAME_OVER ? Mode.FREE_PLAY : state.mode;
  state.locked = false;
  state.endReason = "";
  state.gameEndedAt = null;
  for (const record of records) {
    state.board = applyMoveOn(state.board, record.move);
    state.lastMove = record.move;
    state.sideToMove = opposite(state.sideToMove);
    state.moveHistory.push(record);
    state.selectedMoveId = record.id;
    if (record.engineEvaluationAfterMove) pushTrend(record.engineEvaluationAfterMove, record);
  }
}

function resetGame() {
  deactivateAuto();
  state.board = createInitialBoard();
  state.sideToMove = Side.RED;
  state.mode = Mode.FREE_PLAY;
  state.aiSide = null;
  state.humanSide = null;
  state.locked = false;
  state.selected = null;
  state.legalTips = [];
  state.setup = { active: false, dirty: false, selectedBoard: null, selectedPiece: null };
  state.lastMove = null;
  state.selectedMoveId = null;
  state.moveHistory = [];
  state.logEntries = [];
  state.trend = [];
  state.currentResult = null;
  state.gameStartedAt = new Date().toISOString();
  state.gameEndedAt = null;
  state.endReason = "";
  state.exportStatus = "";
  addLog("engine", "对局开始", "已初始化为标准开局，默认自由走棋模式。", null, fenFromBoard(state.board, state.sideToMove));
  render();
}

async function toggleCustomSetup() {
  if (state.mode === Mode.CUSTOM_SETUP) {
    finishCustomSetup();
    return;
  }
  if (state.locked || state.mode === Mode.AUTO_PLAY) {
    await api("/api/engine/stop", { method: "POST" }).catch(() => null);
  }
  deactivateAuto();
  state.mode = Mode.CUSTOM_SETUP;
  state.locked = false;
  state.selected = null;
  state.legalTips = [];
  state.setup = { active: true, dirty: false, selectedBoard: null, selectedPiece: null };
  addLog("warn", "进入自定义摆盘", "可以左键移动棋子、右键删除棋子，并从棋盘下方补充标准数量内的棋子。", null, fenFromBoard(state.board, state.sideToMove));
  render();
}

function validateCustomBoard() {
  const counts = pieceCounts();
  for (const [piece, count] of Object.entries(counts)) {
    if (count > maxPieceCounts[piece]) return `${capturedText(piece)}数量超过上限。`;
  }
  if ((counts.K || 0) !== 1 || (counts.k || 0) !== 1) return "局面必须保留红帅和黑将各一个。";
  if (kingsFacing(state.board)) return "王见王，不能结束摆盘。";
  return "";
}

function finishCustomSetup() {
  const error = validateCustomBoard();
  if (error) return notify(error, "error", true);
  const wasDirty = state.setup.dirty;
  state.mode = Mode.PAUSED_FREE_PLAY;
  state.setup = { active: false, dirty: false, selectedBoard: null, selectedPiece: null };
  state.selected = null;
  state.legalTips = [];
  state.lastMove = null;
  state.selectedMoveId = null;
  if (wasDirty) {
    state.moveHistory = [];
    state.trend = [];
    state.currentResult = null;
    state.exportStatus = "";
    addLog("warn", "完成自定义摆盘", `局面已改为：${fenFromBoard(state.board, state.sideToMove)}。历史和优势走势已重置。`, null, fenFromBoard(state.board, state.sideToMove));
    runShortAnalysis();
  } else {
    addLog("warn", "退出自定义摆盘", "局面未修改。", null, fenFromBoard(state.board, state.sideToMove));
  }
  render();
}

function buildGameRecord(reason = state.endReason || "手动导出") {
  return {
    appName: "本地象棋 AI 分析助手",
    startedAt: state.gameStartedAt,
    endedAt: state.gameEndedAt || new Date().toISOString(),
    endReason: reason,
    finalFen: fenFromBoard(state.board, state.sideToMove),
    sideToMove: state.sideToMove,
    mode: state.mode,
    moveHistory: state.moveHistory,
    trend: state.trend,
    logEntries: state.logEntries
  };
}

async function autoExportGame(reason = state.endReason) {
  const paths = await api("/api/export", { method: "POST", body: buildGameRecord(reason) });
  state.exportStatus = `棋谱已导出：${paths.json} / ${paths.txt}`;
  showSuccessToast(state.exportStatus);
  addLog("engine", "棋谱已导出", state.exportStatus, null, fenFromBoard(state.board, state.sideToMove));
  render();
  return paths;
}

function exportText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function wireEvents() {
  $("#settingsBtn").addEventListener("click", () => $("#settingsDialog").showModal());
  $("#startBtn").addEventListener("click", startAiAssist);
  $("#autoBtn").addEventListener("click", startAutoMode);
  $("#stopAutoBtn").addEventListener("click", () => stopAutoMode());
  $("#pauseBtn").addEventListener("click", pauseGame);
  $("#turnBtn").addEventListener("click", toggleSideToMove);
  $("#stopBtn").addEventListener("click", async () => {
    await api("/api/engine/stop", { method: "POST" });
    if (state.mode === Mode.AUTO_PLAY) deactivateAuto();
    state.locked = false;
    addLog("engine", "停止计算", "已向引擎发送 stop。", null, fenFromBoard(state.board, state.sideToMove));
    render();
  });
  $("#undoBtn").addEventListener("click", undoOne);
  $("#undoRoundBtn").addEventListener("click", undoRound);
  $("#resetBtn").addEventListener("click", resetGame);
  $("#setupBtn").addEventListener("click", toggleCustomSetup);
  $("#flipBoardBtn").addEventListener("click", toggleBoardFlip);
  $("#finishBtn").addEventListener("click", () => endGame("用户手动结束对局。"));
  $("#exportLogBtn").addEventListener("click", () => exportText("xiangqi-log.json", JSON.stringify(state.logEntries, null, 2)));
  $("#exportMovesBtn").addEventListener("click", () => autoExportGame("用户手动导出棋谱").catch(err => notify(err.message, "error", true)));
  $("#saveSettingsBtn").addEventListener("click", saveSettings);
  $("#saveDifficultyBtn").addEventListener("click", saveSettings);
  $("#presetSelect").addEventListener("change", () => {
    updateSettingsControls();
    $("#settingsFeedback").textContent = $("#presetSelect").value === "custom"
      ? "自定义档位已启用，请保存后生效。"
      : "已选择默认档位，自定义深度/时间已置灰；请保存后生效。";
  });
  $("#testEngineBtn").addEventListener("click", () => testEngine().catch(err => notify(err.message, "error", true)));
  $("#restartEngineBtn").addEventListener("click", () => testEngine().catch(err => notify(err.message, "error", true)));
  $("#moveHistory").addEventListener("click", event => {
    const button = event.target.closest("button[data-move-id]");
    const moveId = button?.dataset.moveId;
    if (!moveId) return;
    state.selectedMoveId = moveId;
    const firstLogId = state.moveHistory.find(move => move.id === moveId)?.relatedLogEntryIds?.[0];
    render();
    if (firstLogId) document.getElementById(firstLogId)?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  $("#setupTray").addEventListener("click", event => {
    const button = event.target.closest("button[data-setup-piece]");
    if (!button || button.disabled) return;
    state.setup.selectedPiece = state.setup.selectedPiece === button.dataset.setupPiece ? null : button.dataset.setupPiece;
    state.setup.selectedBoard = null;
    render();
  });
}

async function initializeEngineFromSettings() {
  state.engineStatus = await api("/api/engine/status");
  if (state.engineStatus.status !== "可用" && state.settings?.enginePath) {
    try {
      state.engineStatus = await api("/api/engine/start", {
        method: "POST",
        body: { enginePath: state.settings.enginePath, options: state.settings.engineOptions }
      });
      addLog("engine", "引擎自动启动", `已连接 ${state.engineStatus.name || "Pikafish"}。`);
    } catch (err) {
      addLog("error", "引擎自动启动失败", err.message);
    }
  }
}

async function init() {
  wireEvents();
  await loadSettings();
  resetGame();
  await initializeEngineFromSettings();
  renderEngineOptions(state.engineStatus?.options || []);
  render();
}

init().catch(err => {
  addLog("error", "启动失败", err.message);
  render();
});
