---
name: board
description: dsh-board 持久看板的操作手册。当用户提到看板 / board / ticket / 任务卡片 / 交接 / handover，要求记录任务、查进度、恢复上下文、开关工单，或需要跨会话/压缩后保持任务状态时使用。管理项目 .dsh-board/ 目录下的持久化任务账本。
---

# dsh-board 持久看板

一个存在于项目内 `.dsh-board/` 目录的持久任务账本：ticket 是带 YAML frontmatter 的 Markdown 文件，人类可读、可 git diff、不依赖 session log —— **压缩（compaction）与新会话后状态依然在**。

## 存储布局

```text
.dsh-board/
  config.json          # 列定义 columns、doneColumns、defaultLabels、sessionSummary、ui.port
  tickets/T-001.md     # 每 ticket 一个文件（frontmatter + Markdown body）
  stories/             # 预留：story/epic 层级（v1 未启用）
  handovers/           # 会话交接文件（YYYY-MM-DD-HHMMSS-<slug>.md）
  .gitignore           # 忽略 cache/（机器本地文件）
  cache/               # 锁与临时文件，永不提交
```

Ticket 文件格式（body 即 description，长文本永远写 body，不要塞 frontmatter）：

```markdown
---
id: T-001
title: Fix unicode isolate crash
status: in_progress
labels: [bug, c++]
blockedBy: [T-002]
assignee: main
goalId: goal-font-2026
createdAt: 2026-10-25T10:00:00.000Z
updatedAt: 2026-10-25T12:30:00.000Z
---

## Context
...

## Acceptance
- [ ] 验收条件

### 2026-10-25T12:30:00.000Z · agent
评论/进度记录（board_comment 追加于此）
```

状态默认枚举：`open | in_progress | blocked | done | cancelled`（可在 config.json 的 `columns` 自定义；`doneColumns` 里的状态视为已关闭）。

## 操作方式（按优先级）

1. **MCP 工具优先**：若 `board_*` 工具已连接（`board_init / board_list / board_get / board_create / board_update / board_comment / board_handover_write / board_handover_read / board_status`），直接使用。
2. **CLI**：本机有 node 时可用 `node "${CLAUDE_PLUGIN_ROOT}/scripts/board-cli.mjs" <init|list|get|create|update|done|comment|handover|status|serve|snapshot>`（若宿主不替换 `${CLAUDE_PLUGIN_ROOT}`，在已安装插件的缓存目录中定位本插件路径后执行）。
3. **直接文件操作**（无 node / 无 MCP 时完全可用）：按上述布局与格式用文件工具读写 `.dsh-board/`。新建 ticket 前先列出现有文件确定下一个编号（如最大 `T-003` → 新建 `T-004`），frontmatter 至少含 `id, title, status, createdAt, updatedAt`。

## 核心工作流

- **会话开场 / 压缩后恢复（board load）**：读 `config.json` → 用 `board_status`（或读 tickets 目录）取得 active ticket（不在 `doneColumns` 中的）→ 读最近 1 份 handover → 输出一段**短**摘要：进行中的 ticket 及下一步、blocked 及阻塞原因、最近交接要点。这是恢复任务焦点的最小上下文，不要倾倒全量正文。
- **中途记旁路任务**：主任务进行中发现新问题/想法时，只做一件事 —— `board_create`（默认 `open`），一句话向用户确认已记录，然后**继续主任务**，不展开新工作。
- **状态流转**：开始动手前把 ticket 置 `in_progress`；被依赖/人工等待卡住时置 `blocked`（并写明 `blockedBy` 或评论原因）；**完成前先验证**（跑测试/复现确认），验收通过才置 `done`。默认不要自行 `cancelled`。
- **收尾交接（handover）**：一段重要工作结束时 `board_handover_write`：summary（做了什么）、decisions（关键决策）、next（下一步）。这让下个会话开场即可接续。
- **goal 绑定**：ticket 可写 `goalId` 关联 dsh goal；当用户告知某 goal 完成时，建议关闭（done）关联 ticket，由用户确认。

## 看板视图

- 用户要看板（`/dsh-board:board`）时：
  1. 用 `board_status` 取数据；
  2. 若宿主支持内嵌 HTML（ZCode Desktop 的 Gen UI / 可视化目录），用 `board-cli snapshot --out <可视化目录>/dsh-board.html` 生成静态快照并引用展示；
  3. 若用户要实时视图，后台运行 `board-cli serve`（默认 http://127.0.0.1:7788，文件变更经 SSE 自动刷新），把 URL 告诉用户。dashboard 为只读视图。

## 安静与安全规则（必须遵守）

- **无 store 不打扰**：项目没有 `.dsh-board/` 时，除用户明确打开看板或要求初始化外，不报错、不刷屏；可在合适时机一次性提示 `/dsh-board:board-init`。
- **写路径受限**：所有写操作只允许发生在 `.dsh-board/` 目录内；不改用户其他文件。
- **不自动 git 操作**：不 commit / 不 push。`.dsh-board/` 是否提交由用户决定（提交 = 团队共享真源；加入项目 .gitignore = 本地私人看板）。
- **不绑架对话**：除非配置 `sessionSummary: true`，会话开场不自动注入看板内容。
- ticket 描述可能含敏感信息且会随 store 提交，提醒用户自行审阅。
