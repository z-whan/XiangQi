import test from "node:test";
import assert from "node:assert/strict";
import { parseEngineOption, parseInfoLine, mergeInfo } from "../server.js";

test("解析 UCI option 行", () => {
  const option = parseEngineOption("option name Hash type spin default 16 min 1 max 33554432");
  assert.equal(option.name, "Hash");
  assert.equal(option.type, "spin");
  assert.equal(option.default, "16");
  assert.equal(option.min, "1");
  assert.equal(option.max, "33554432");
});

test("解析 info 行中的深度、分数、速度和 pv", () => {
  const info = parseInfoLine("info depth 7 seldepth 12 multipv 2 score cp 120 nodes 245300 nps 310000 time 820 pv h2e2 h9g7");
  assert.equal(info.depth, 7);
  assert.equal(info.selectiveDepth, 12);
  assert.equal(info.multipv, 2);
  assert.equal(info.scoreType, "CP");
  assert.equal(info.scoreValue, 120);
  assert.equal(info.nodes, 245300);
  assert.equal(info.nps, 310000);
  assert.deepEqual(info.pv, ["h2e2", "h9g7"]);
});

test("side-to-move 视角分数转换为红方视角", () => {
  const result = { candidateMoves: [], rawInfoLines: [] };
  mergeInfo(result, parseInfoLine("info depth 5 score cp 80 pv a0a1"), "BLACK");
  assert.equal(result.scoreRedPerspective, -80);
  assert.equal(result.candidateMoves[0].scoreValue, 80);
});
