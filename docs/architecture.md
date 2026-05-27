# 架构说明

本项目当前采用轻量本地 Web wrapper，而不是直接修改 TCHESS。原因是 TCHESS 需要 JDK 21 与 JavaFX 23，当前机器没有 Java Runtime；同时 P0 的核心能力可以通过 Node 本地服务更快落地。

上游项目仍保留在 `vendor/`：

- `vendor/Pikafish`：GPLv3，UCI 中国象棋引擎，无 GUI，Unix-like 系统可在 `src/` 下用 Makefile 构建。
- `vendor/public-Xiangqi`：TCHESS，GPLv3，Java 21 + JavaFX 23，已有 UCI/UCCI 引擎接入、棋盘、FEN、棋谱、分析功能。本项目的 FEN、UCI 坐标和规则判断参考了其 `ChessBoard` 与 `XiangqiUtils` 设计。

## 模块

- `app/server.js`
  - 启动 Pikafish 子进程。
  - 发送 `uci`、`isready`、`position fen`、`go depth/movetime/nodes`、`stop`。
  - 解析 `id name`、`id author`、`option`、`info`、`bestmove`。
  - 提供本地 HTTP API 和静态页面。

- `app/public/app.js`
  - 管理棋盘、走法、FEN、合法性判断、状态机、日志、历史、趋势图、自动模式和导出触发。
  - 浏览器端不直接操作引擎进程，只调用本地 API。

- `app/public/index.html` / `style.css`
  - 中文 UI。
  - 左侧棋盘，中上控制栏，右侧计算结果/趋势/历史，底部日志。

## 状态机

`GameMode`：

- `FREE_PLAY`：默认模式，红黑双方都可由用户手动走。
- `AI_ASSIST`：点击“开始计算”后，AI 接管当前 `sideToMove`；AI 走完后用户执另一方，双方固定轮流。
- `AUTO_PLAY`：点击“AI 自战”后，AI 控制红黑双方。每步之间延迟 2 秒；暂停或停止会使当前循环 token 失效，避免多个自动循环叠加。
- `PAUSED_FREE_PLAY`：点击“暂停”后停止自动接管，恢复自由走棋；再次开始计算会按当前轮到方重新确定 AI 方。
- `GAME_OVER`：将帅被移除、无合法走法或用户手动结束后进入。

## 数据结构

核心结构在浏览器端维护：

- `MoveRecord`：走法 id、回合号、执棋方、UCI 坐标、简化中文记法、走前/走后 FEN、actor、时间戳、关联日志 id、走后评分。
- `LogEntry`：日志 id、时间戳、类型、标题、消息、关联 move id、FEN、原始引擎输出和结构化结果。
- `EngineSearchResult`：bestmove、ponder、depth、seldepth、time、nodes、nps、score、pv、multipv 候选、原始输出。
- `WinTrendPoint`：每步后的红方优势倾向、raw score、actor 和关联 move id。

## 导出

前端在进入 `GAME_OVER` 时调用 `POST /api/export`，Node 后端写入 `exports/xiangqi-*.json` 和 `exports/xiangqi-*.txt`。这样不依赖浏览器下载权限，也更适合后续导入和复盘。

JSON 包含完整 `moveHistory`、`logEntries`、FEN、吃子、将军、评分和 AI 计算信息。TXT 是人类可读棋谱摘要。

## 日志与历史

走法历史用于复盘的简明列表；日志用于记录完整事件。`MoveRecord.relatedLogEntryIds` 关联详细日志，后续可以把“点击走法后滚动到日志”做成完整联动。

## 解释器接口

当前 UI 预留了解释区域，但不会让大模型直接下棋。未来 `ExplanationService.explainMove(context)` 只解释 Pikafish 给出的最佳招法、评分变化和主要变化，不替代引擎决策。
