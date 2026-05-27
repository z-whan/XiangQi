# UCI 接入说明

Pikafish 是 UCI 中国象棋引擎。本项目使用的命令：

- `uci`：进入 UCI 模式，读取 `id` 和 `option`，等待 `uciok`。
- `isready`：检查引擎是否准备好，等待 `readyok`。
- `setoption name <Name> value <Value>`：设置动态读取到的引擎参数。
- `position fen <fen>`：设置当前局面。
- `go depth N`：按固定深度搜索。
- `go movetime MS`：按固定毫秒数搜索。
- `go nodes N`：按节点数搜索，若引擎支持可用。
- `stop`：停止当前搜索。

## 输出字段

- `id name`：引擎名称。
- `id author`：作者。
- `option`：可配置参数，例如 `Threads`、`Hash`、`MultiPV`。
- `info depth`：搜索深度，引擎向后推演的层数。
- `info seldepth`：选择性深度，在关键变化线上实际深入搜索的最大层数。
- `info time`：本步计算耗时，单位毫秒。
- `info nodes`：已评估局面数量。
- `info nps`：每秒评估局面数。
- `info score cp`：以 100 分约等于一兵/一卒的局面评分。
- `info score mate`：杀棋距离。
- `info pv`：主要变化。
- `info multipv`：候选招法排序。
- `bestmove`：最佳走法。
- `ponder`：引擎预计对方可能应对。

## 红方视角评分

UCI `score` 通常按 side-to-move 视角给出。本项目内部保存红方视角：

- 当前红方走：`scoreRedPerspective = score`
- 当前黑方走：`scoreRedPerspective = -score`

mate 分数同样按符号转为红方视角；UI 显示为“杀棋距离”，不把它伪装成精确胜率。

## 优势倾向

折线图显示“红方优势倾向”，不是严格真实胜率：

```text
winProbRed = 1 / (1 + exp(-cp / 400))
```

`mate` 分数会被压到接近 0% 或 100%。UI 注明“根据引擎评分换算，仅供参考，不代表真实胜率”。
