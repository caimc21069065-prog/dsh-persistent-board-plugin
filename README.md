# dsh-board — dsh/持久看板插件

把项目任务放进**项目内**的一组可读文件（`.dsh-board/`），获得一块跨会话、跨压缩（compaction）依然存在的看板：

- 🗂 **文件即真源**：每张 ticket 是一个 YAML frontmatter + Markdown 的文件，人类可读、可 git diff、可手工编辑
- 🔁 **压缩无关**：状态在磁盘上，不在 session log 里；新会话一条 `/dsh-board:board-load` 恢复焦点
- 🤖 **Agent 可读写**：9 个 `board_*` MCP 工具；无 MCP 时同功能 CLI；连 node 都没有时 agent 也能直接按文件格式操作
- 📋 **看板可视化**：本地 dashboard（文件变更 SSE 自动刷新）+ 可内嵌展示的静态快照
- 🛫 **中途记旁路任务**：主任务不中断，一句「记个 ticket」即落一张 open 卡
- 🤝 **交接（handover）**：会话收尾写入结构化 summary / decisions / next，下个会话开场即接续
- 🎯 **与 goal 共存**：ticket 可写 `goalId` 绑定既有 goal 体系，互不覆盖

设计灵感来自 [Storybloq](https://github.com/Storybloq/storybloq)（`.story/` 文件账本 + 侧栏看板 + `/story` 会话加载）与 [Sidequest](https://github.com/Eigenwise/eigenwise-toolshed)（本地看板 + 压缩后可捡起 + 验证后关单），代码为独立实现（详见 [设计说明](docs/DESIGN.md)）。

需求来源：[dsh-persistent-board-plugin-requirements.md](dsh-persistent-board-plugin-requirements.md)。

---

## 安装（本地测试市场）

前置：本机装有 **Node.js ≥ 18**（MCP server / hooks / dashboard 需要；没有 node 时 skill 工作流仍可用文件工具完成大部分操作）。

1. 在 ZCode 中打开 **Plugin Marketplace → Add → Add Plugin Marketplace**，粘贴目录：

   ```
   D:\Project\dsh-persistent-board-plugin\plugins
   ```

2. 在 **Personal → dev-dsh-persistent-board-plugin-cf2a1db1 → DSH Board（持久看板）** 点击 **Install**。
3. 安装后在 **Settings → Plugins** 中确认 `dsh-board` 已启用。MCP server 随会话自动启动（`dsh-board`）。

更新：改动 `plugins/dsh-board/` 源码后，在插件管理里对该插件执行 **Update/Refresh**（版本号在 `.zcode-plugin/plugin.json` 中维护）。

## 安装到 DeepSeek Harness (dsh)

`plugins/dsh-board/` 子包声明了 `dsh.bundle` manifest（`package.json` + `cordis.patch.yml`），可经 `dsh plugin add` 从 monorepo 子目录安装。MCP server（`server/index.mjs`，stdio）与全部逻辑零 npm 依赖，Node ≥ 18 即可运行；27 个测试覆盖存储层、MCP stdio 协议与 dashboard HTTP 接口。

## 快速开始

安装后在新会话里：

| 命令 | 作用 |
|------|------|
| `/dsh-board:board-init` | 在当前项目创建 `.dsh-board/`（幂等，不覆盖已有配置） |
| `/dsh-board:board` | 打开看板（文字摘要 + 内嵌快照；`serve` 启动实时页面，`refresh` 强制重扫输出最新摘要） |
| `/dsh-board:board-add 修复登录超时` | 中途快速记一张 open ticket（不打断主任务） |
| `/dsh-board:board-load` | 把 open/in_progress/blocked + 最近交接注入当前会话（开场/压缩后用） |
| `/dsh-board:board-done T-001` | 验证验收条件后关闭 ticket |
| `/dsh-board:board-status` | CLI 风格文字摘要 |

自然语言同样有效：「记个 ticket：xxx」「现在看板上有什么」「把 T-001 标记阻塞，等设计稿」。

### 会话连续性

- 收尾时让 agent「写个 handover」→ `board_handover_write` 保存 summary/decisions/next
- 新会话（或长对话被压缩后）运行 `/dsh-board:board-load` → 模型复述当前进度与下一步
- 可选：把 `.dsh-board/config.json` 的 `sessionSummary` 设为 `true`，每次会话开始自动注入极短摘要（默认关闭）

### 存储：提交还是忽略？

- **提交 `.dsh-board/`**（除 `cache/`）：团队共享真源，跨机器恢复 —— 推荐
- **忽略整个 `.dsh-board/`**：加入项目 `.gitignore`，变成个人本地看板

插件不做任何 git 操作，由你决定。

---

## 组件

```
plugins/dsh-board/
├── .zcode-plugin/plugin.json   # ZCode 插件清单
├── .mcp.json                   # MCP server：node server/index.mjs（stdio）
├── skills/board/SKILL.md       # agent 操作手册（文件格式 / 工作流 / 安全规则）
├── commands/                   # /dsh-board:board 六件套
├── hooks/                      # SessionStart（可选摘要，默认关）+ PreCompact（压缩提示）
├── server/index.mjs            # MCP server：board_init/list/get/create/update/comment/handover_write/handover_read/status
├── lib/                        # store（读写层）/ frontmatter / render / dashboard
├── scripts/board-cli.mjs       # 零依赖 CLI（同能力，供人/hooks/无 MCP 场景）
└── tests/                      # node --test 单测 + MCP stdio 冒烟测试
```

### board_* 工具

| 工具 | 说明 |
|------|------|
| `board_init` | 初始化 store（幂等） |
| `board_list` | 按状态/标签/关键词列出；默认截断描述控制体积 |
| `board_get` | 取单 ticket 全文 |
| `board_create` | 建 ticket（title 必填；labels/blockedBy/assignee/goalId 可选） |
| `board_update` | 改状态、标题、标签、依赖、正文（replace/append） |
| `board_comment` | 追加时间戳评论（持久） |
| `board_handover_write` / `board_handover_read` | 写/读会话交接 |
| `board_status` | 各列计数 + in_progress + blocked + 最新交接 |

### CLI（零依赖）

```bash
node plugins/dsh-board/scripts/board-cli.mjs init
node plugins/dsh-board/scripts/board-cli.mjs list --status open,in_progress
node plugins/dsh-board/scripts/board-cli.mjs create --title "..." --labels bug,ui
node plugins/dsh-board/scripts/board-cli.mjs update T-001 --status blocked --blocked-by T-002
node plugins/dsh-board/scripts/board-cli.mjs serve --port 7788     # 实时看板 http://127.0.0.1:7788
node plugins/dsh-board/scripts/board-cli.mjs snapshot --out board.html  # 静态快照
```

（`board-cli handover write --summary ... --next ...`、`board-cli done T-001`、`board-cli status --json` 等见 `help`。）

### 数据布局

```text
.dsh-board/
  config.json          # columns / doneColumns / defaultLabels / sessionSummary / ui.port
  tickets/T-001.md     # frontmatter(id,title,status,labels,blockedBy,assignee,goalId,…) + Markdown body
  stories/             # 预留 story/epic 层级
  handovers/           # 会话交接（YYYY-MM-DD-HHMMSS-<session>.md）
  .gitignore           # 仅忽略 cache/（机器本地文件）
  cache/               # 锁与临时文件，永不提交
```

---

## 安全与边界

- 所有写路径限制在 `.dsh-board/` 内（id 经校验，拒绝路径逃逸）
- 不自动执行 git 操作；dashboard 仅监听 `127.0.0.1` 且**只读**
- hook 在无 store / 无 node 时静默退出，不刷屏
- ticket 描述会随 store 提交，含敏感信息请先自审
- 插件禁用后：UI 与工具消失，磁盘 store 原样保留

## 开发

```bash
cd plugins/dsh-board
node --test tests/store.test.mjs tests/mcp-server.test.mjs tests/dashboard.test.mjs   # 27 个测试（含 dashboard HTTP 集成与 MCP stdio 冒烟）
node scripts/board-cli.mjs help
```

路线图（二期）：story 层级、handover 自动化、worktree/subagent 派发 + 验证门、GitHub Issues 双向同步、跨项目收件箱 —— 见 [docs/DESIGN.md](docs/DESIGN.md)。

## 许可

MIT。本项目为独立实现：仅借鉴 Storybloq（PolyForm Shield）与 Sidequest（MIT）的工作流设计，未复制其代码或商标。
