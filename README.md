# 本地象棋 AI 分析助手

一个本地运行的中文中国象棋 AI 分析/接管工具。它用于训练、复盘、研究或双方明确同意的 AI 辅助对局，不做线上平台外挂、屏幕识别、自动点击第三方网页/客户端或绕过反作弊功能。

## 当前形态

项目依赖两个上游项目；它们不直接提交到本仓库，请用 `scripts/clone-deps` 拉取到本地 `vendor/`：

- `vendor/Pikafish`：Pikafish UCI 中国象棋引擎，GPLv3。
- `vendor/public-Xiangqi`：TCHESS / public-Xiangqi，GPLv3，Java 21 + JavaFX 23，支持 UCI/UCCI、棋盘、分析、棋谱等。本项目当前用它作为棋盘/FEN/UCI 接入参考。

当前第一版采用 Node 本地 Web wrapper：`app/server.js` 管理 Pikafish 进程，浏览器页面负责中文 UI、棋盘、状态机、日志、历史和趋势图。TCHESS / JavaFX 保留为参考方向，暂不迁移。

## 环境

- 当前系统：macOS arm64。
- Node.js：已可用。
- Java：当前可用 Java 21；若未来直接运行 TCHESS，还需要匹配 JavaFX 23。

## 拉取依赖

```bash
scripts/clone-deps
```

## 构建 Pikafish

macOS Apple Silicon 默认：

```bash
scripts/build-pikafish
```

脚本实际执行：

```bash
cd vendor/Pikafish/src
make -j build ARCH=apple-silicon
```

如果构建失败，也可以从 Pikafish 官方 release 获取适合系统的 executable，然后在设置页填写路径。

## 运行应用

```bash
scripts/run-app
```

也可以直接使用 npm：

```bash
npm start
```

打开：

```text
http://127.0.0.1:5177
```

设置页中填写 Pikafish executable，例如：

```text
/Users/wenhan/CodeNeverMute/Chicks/XiangQi/vendor/Pikafish/src/pikafish
```

然后点击“测试引擎”。

## 基本使用流程

1. 启动应用后默认是“自由走棋”，用户可以操控红黑双方。
2. 每步会更新 FEN、走法历史、对局日志；若引擎可用，会进行短分析并更新优势趋势。
3. 点击“开始计算”后，AI 接管当前轮到走的一方。
4. AI 走完后，另一方归用户；用户走完一步后棋盘锁定，AI 自动计算下一步。
5. 点击“AI 自战”后进入自动模式，AI 控制红黑双方，每步之间延迟 2 秒，方便观察。
6. 点击“暂停”后回到暂停自由模式，红黑都可手动操作；再次点击“开始计算”会重新按当前轮到方确定 AI 方。
7. 支持停止计算、停止自动模式、悔一步、悔一轮、重新开始、手动结束、导出日志和导出棋谱。

## 导出

对局结束或点击“手动结束”时，会自动导出棋谱到 `exports/`：

- `xiangqi-YYYY-MM-DD-HHMMSS.json`：完整结构化数据。
- `xiangqi-YYYY-MM-DD-HHMMSS.txt`：人类可读棋谱。

页面上也保留“导出日志”和“导出棋谱”按钮。

## 设置页

- 引擎设置：Pikafish 路径、测试引擎、重启引擎、引擎名称/作者、动态 UCI option 表单。
- 棋力档位：入门陪练、普通业余、业余高手、强业余/复盘分析、深度分析、自定义。
- 局面评分：自动短分析、评分耗时、评分深度、MultiPV 数量。
- UI 设置：坐标、最后一步高亮、可走位置提示。

## 难度档位

- 档位 1：`movetime 100ms` / depth 3，入门陪练。
- 档位 2：`movetime 300ms` / depth 5，普通业余。
- 档位 3：`movetime 800ms` / depth 7，业余高手。
- 档位 4：`movetime 1500ms` / depth 9，强业余 / 复盘分析。
- 档位 5：`movetime 3000ms` / depth 12，深度分析。

默认按 movetime 控制，因为用户体感更稳定；自定义档位可切换 depth。

## 常见问题

- 引擎不可用：确认 Pikafish 路径是可执行文件，并且有执行权限。
- TCHESS 为什么没直接改：TCHESS 需要 Java 21/JavaFX 23，本机当前缺 Java Runtime；为了先完成 P0，本项目先做轻量 wrapper。
- 胜率为什么叫优势倾向：它由引擎 cp/mate 评分换算，只是复盘参考，不代表真实胜率。

## 测试

```bash
npm test
```

当前覆盖 UCI option/info 解析和 side-to-move 分数转红方视角。

一键检查：

```bash
npm run check
# 或
scripts/check
```

`check` 会执行服务端语法检查、前端语法检查和单元测试。

## 打包计划

当前保持轻量 Web wrapper，不迁移到 TCHESS/JavaFX。未来如果要做 macOS App，可以评估两条路：

- 使用 Java 21 的 `jpackage` 包一个启动器壳，但需确认 Maven 当前运行时是否固定到 Java 21。
- 使用 Node 打包方案把本地服务和前端资源封装为 `.app`，并在首次运行时引导配置 Pikafish executable。

## 伦理说明

本工具仅用于本地训练、复盘、研究，或双方明确同意的 AI 辅助对局。请不要用于线上作弊、平台外挂、屏幕识别、自动点击第三方网页/客户端、绕过反作弊或任何违反平台规则和对手知情同意的场景。
