# dsh-persistent-board 插件需求规格书

**版本**: 0.1.0-draft  
**日期**: 2026-10-25  
**状态**: 需求草案（可直接作为实现起点）  
**参考实现**:
- **Storybloq**: https://github.com/Storybloq/storybloq （repo 内 `.story/` 账本 + 侧栏看板 + MCP/CLI）
- **Sidequest**: https://github.com/Eigenwise/eigenwise-toolshed （插件路径 `plugins/sidequest`，本地看板 + 可验证并行派发）

**目标平台**: DeepSeek Harness (dsh) ≥ 0.2.x（web / desktop profile）  
**建议插件名**: `dsh-board` / `persistent-board` / `story-board`（最终以仓库为准）

---

## 1. 背景与目标

### 1.1 问题

长项目 / 多 agent / 频繁 compaction 时：

- 对话里的任务意图、阻塞点、下一步在压缩或新会话后丢失
- goal / subagent 状态散落在 session log，没有「一眼能看的项目级看板」
- 中途发现的旁路 bug 要么打断主任务，要么永远不再做

Claude 生态里：

- **Storybloq**：把 tickets / issues / handovers / lessons 落在仓库 `.story/`，侧栏画四列看板，跨会话可恢复
- **Sidequest**：本地 Kanban + 把 ticket 派到隔离 worktree 的 executor，带回验证证据再合并

dsh 已有 goal / trajectory / 多 agent 能力，但缺少**持久、可视、可被 agent 读写的项目级看板层**。

### 1.2 目标

做一个 dsh 插件，实现：

1. **持久看板**：任务以结构化 ticket 存在项目内（或可配置的本地 store），压缩与新会话后仍在
2. **侧栏/面板可视化**：Open / In Progress / Blocked / Done（可配置列），实时随状态更新
3. **Agent 可读写**：通过工具或 skill，agent 可创建/更新/查询 ticket，并在会话开始加载「当前该做什么」
4. **与 dsh goal / subagent 对齐**：ticket 可绑定 goal、可标记由哪个 agent 执行
5. **可选派发**（二期）：把 ready ticket 派到隔离执行环境，带回验证结果再合入

### 1.3 非目标（v1）

- 不替代 GitHub Issues / Linear 作为团队真源（可做双向链接，但不强制）
- 不做完整多仓库 federation（Storybloq 高级能力）
- 不做强制 worktree 隔离执行（Sidequest 完整派发可作为二期）
- 不要求用户安装独立桌面 App

---

## 2. 参考仓库与安装（对照）

### 2.1 Storybloq

| 项 | 内容 |
|----|------|
| **GitHub** | https://github.com/Storybloq/storybloq |
| 官网 | https://storybloq.com |
| 核心概念 | 仓库内 `.story/` 目录：tickets、issues、handovers、lessons、status |
| Claude 侧 | CLI + MCP + `/story` skill + 侧栏 Mod（画看板） |
| 安装（Claude） | `npm i -g @storybloq/storybloq@latest` → `storybloq setup --client all` → `storybloq init` |
| 许可 | PolyForm Shield 1.0.0（源码可见，限制做竞品） |
| 价值点 | **文件即真源**、可 git 跟踪、侧栏只读绘制、跨会话 `/story` 加载状态 |

### 2.2 Sidequest

| 项 | 内容 |
|----|------|
| **GitHub** | https://github.com/Eigenwise/eigenwise-toolshed （`plugins/sidequest`） |
| 文档 | https://eigenwise.github.io/eigenwise-toolshed/getting-started/sidequest/ |
| 核心概念 | 本地看板 store；ticket 含说明、复现、状态、讨论；可 dispatch 到并行 executor（worktree + 验证门） |
| Claude 侧 | `/sidequest:board` + MCP tools + 工具调用守卫 |
| 安装（Claude） | `claude plugin marketplace add Eigenwise/eigenwise-toolshed` → `claude plugin install sidequest@eigenwise-toolshed` |
| 许可 | MIT |
| 价值点 | **任务在压缩后仍可捡起**、看板驱动派发、验证后再集成 |

### 2.3 对 dsh 的取舍建议

| 能力 | 建议来源 | 说明 |
|------|----------|------|
| 仓库内明文状态、可 commit | Storybloq 风格 | 适合团队共享与审计 |
| 本地看板 + 中途记旁路任务 | Sidequest 风格 | 适合个人高速迭代 |
| 侧栏实时四列 | 两者都有 | dsh Web UI slot 实现 |
| worktree 并行 + 验证门 | Sidequest（二期） | 与 dsh subagent 可对接 |
| `/story` 式会话开场加载 | Storybloq | 直接提升跨会话连续性 |

**MVP 推荐**：以「仓库内或项目级 store + 看板 UI + agent 工具 + 会话加载」为主，先不实现完整 worktree 派发。

---

## 3. dsh 设计原则

1. **真源优先文件**  
   Ticket 默认落在项目内可版本控制的目录（建议 `.dsh-board/` 或 `.story/` 兼容布局），可选镜像到用户级 store。

2. **压缩无关**  
   看板状态不依赖 session log 中的自然语言；compaction 后仍可通过工具/命令读回。

3. **只增强、不绑架**  
   不强制每次对话都注入全量看板；默认「按需加载」+ 可选 session 开始摘要。

4. **与现有 dsh 概念映射**  
   - ticket ↔ goal 条目 / 工作项  
   - In Progress ↔ 当前 turn / active agent  
   - Blocked ↔ 依赖未完成或人工阻塞  
   - Done ↔ 已验证关闭  

5. **安全默认**  
   插件对看板文件的写路径受控；不自动执行危险 shell；派发（若有）必须显式触发。

---

## 4. 术语

| 术语 | 含义 |
|------|------|
| **Ticket** | 最小工作项：标题、描述、状态、标签、依赖、可选复现步骤与验收条件 |
| **Story / Epic** | 一组相关 ticket（可选层级） |
| **Board** | 按状态列展示的看板视图 |
| **Ledger / Store** | 磁盘上的 ticket 集合（目录或 JSON/MD 文件） |
| **Handover** | 会话结束时的结构化交接（进度、决策、下一步） |
| **Dispatch** | 将 ready ticket 交给隔离执行体（二期） |

---

## 5. 功能需求（FR）

### FR-1 存储与数据模型

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-1.1 | 默认在项目根创建 `.dsh-board/`（或兼容 `.story/` 布局），内含 tickets、可选 stories、handovers | P0 |
| FR-1.2 | 单 ticket 为可读结构化文件（建议 YAML frontmatter + Markdown body，或 JSON + 可选 MD） | P0 |
| FR-1.3 | 字段至少：`id`, `title`, `status`, `createdAt`, `updatedAt`, `labels[]`, `blockedBy[]`, `description`, `acceptance?`, `assignee?`, `goalId?` | P0 |
| FR-1.4 | 状态枚举可配置，默认：`open` \| `in_progress` \| `blocked` \| `done` \| `cancelled` | P0 |
| FR-1.5 | `.dsh-board/` 中机器本地路径（缓存、锁、临时）写入 `.gitignore` 模板 | P0 |
| FR-1.6 | 支持 `board init` 初始化；已有目录不破坏 | P0 |
| FR-1.7 | 可选：用户级全局看板目录（跨项目旁路任务） | P2 |

### FR-2 看板 UI

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-2.1 | Web UI 侧栏或 overlay 展示四列（或配置列）看板 | P0 |
| FR-2.2 | 卡片显示 id、标题、标签、阻塞标记；点击展开详情 | P0 |
| FR-2.3 | 文件变更后自动刷新（监听 store 目录 mtime / 事件） | P0 |
| FR-2.4 | 无 store 时不强制占位；提示 `/board init` | P1 |
| FR-2.5 | 命令 `/board` 打开/聚焦看板；`/board refresh` 强制重扫 | P0 |
| FR-2.6 | 窄布局可降级为状态计数摘要条 | P2 |

### FR-3 Agent 工具（MCP 或 dsh tools）

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-3.1 | `board_list`：按状态/标签/查询列出 ticket | P0 |
| FR-3.2 | `board_get`：取单 ticket 全文 | P0 |
| FR-3.3 | `board_create`：创建 ticket（含 description / labels / blockedBy） | P0 |
| FR-3.4 | `board_update`：改状态、标题、描述、依赖、标签 | P0 |
| FR-3.5 | `board_comment`：追加讨论/进度笔记（持久） | P1 |
| FR-3.6 | `board_handover_write` / `board_handover_read`：写读交接摘要 | P1 |
| FR-3.7 | 工具结果控制体积（列表默认截断描述） | P1 |

### FR-4 会话连续性

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-4.1 | `/board load` 或 skill：把「Open + In Progress + 最近 handover」压缩成短上下文注入当前会话 | P0 |
| FR-4.2 | 可选：`session/start` 时若存在 store，自动注入极短摘要（可配置关闭，默认 off 或极简） | P1 |
| FR-4.3 | compaction 前后不丢失 store；仅提示用户可用 `/board load` 恢复焦点 | P0 |
| FR-4.4 | 支持「中途记旁路任务」：主任务不中断，只 `board_create` 一条 open ticket | P0 |

### FR-5 与 dsh goal / agent 集成

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-5.1 | ticket 可绑定 `goalId`；goal 完成时可建议关闭关联 ticket | P1 |
| FR-5.2 | 当前 in_progress ticket 可显示在 trajectory / 状态区 | P1 |
| FR-5.3 | 文档说明如何与现有 goal 插件共存（不互相覆盖） | P0 |

### FR-6 派发与验证（二期，可选）

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-6.1 | 将无冲突的 ready ticket 派给 subagent / 隔离工作区 | P2 |
| FR-6.2 | 要求返回「验证证据」（测试命令输出、diff 摘要等）后再标 done | P2 |
| FR-6.3 | 文件冲突检测（两 ticket 改同一路径时禁止并行） | P2 |

### FR-7 命令面

| 命令 | 作用 | 优先级 |
|------|------|--------|
| `/board` | 打开看板 | P0 |
| `/board init` | 初始化 store | P0 |
| `/board load` | 加载状态到对话 | P0 |
| `/board add <title>` | 快速建 ticket | P1 |
| `/board done <id>` | 快速关单 | P1 |
| `/board status` | CLI 风格文字摘要 | P1 |

---

## 6. 非功能需求（NFR）

| ID | 需求 |
|----|------|
| NFR-1 | 看板刷新不依赖模型调用；纯本地读写 |
| NFR-2 | 列表扫描在常见规模（≤500 tickets）下 < 100ms 量级（尽力） |
| NFR-3 | 不污染用户 git 历史：提供 ignore 模板；用户可选择是否 commit `.dsh-board/` |
| NFR-4 | 与 dsh append-only session log 正交：ticket 变更可另写审计事件（可选） |
| NFR-5 | 插件禁用后 UI 与工具消失；磁盘 store 保留不删 |
| NFR-6 | Windows / macOS / Linux 路径与监听行为可用 |

---

## 7. 数据布局建议（示例）

```text
.dsh-board/
  config.json          # 列定义、默认标签、是否自动摘要
  tickets/
    T-001.md           # frontmatter + body
    T-002.md
  stories/
    S-01.md            # 可选
  handovers/
    2026-10-25-session-abc.md
  .gitignore           # 本地锁、缓存等
```

**Ticket 示例（Markdown）**:

```markdown
---
id: T-001
title: Fix unicode isolate crash in font engine
status: in_progress
labels: [bug, filmora, c++]
blockedBy: []
goalId: goal-font-2026
createdAt: 2026-10-25T10:00:00+08:00
updatedAt: 2026-10-25T12:30:00+08:00
assignee: main
---

## Context
...

## Acceptance
- [ ] Repro no longer crashes
- [ ] Unit test added

## Notes
- 2026-10-25: narrowed to bidirectional isolate path
```

实现可用 JSON 等价物；关键是**人类可读 + agent 可解析 + 可 git diff**。

---

## 8. 架构建议

```
┌──────────────────────────────────────────────┐
│ dsh process                                  │
│  ┌────────────────────────────────────────┐  │
│  │ persistent-board plugin                │  │
│  │  - store I/O (tickets/)                │  │
│  │  - tools: board_*                      │  │
│  │  - commands: /board *                  │  │
│  │  - UI slot: board pane                 │  │
│  │  - optional: session/start summary     │  │
│  └────────────────────────────────────────┘  │
│           │ reads/writes                     │
│           ▼                                  │
│  .dsh-board/  (project files)                │
└──────────────────────────────────────────────┘
```

**事件挂接（按实际 dsh API 调整）**：

- `session/start`：可选短摘要
- `turn/end`：可选刷新看板 UI
- 文件监听：外部 CLI/人工改 ticket 后刷新 UI
- 不在 `tools/pre-execute` 里默认拦截业务工具（除非二期做派发守卫）

---

## 9. MVP 范围（第一期）

必须交付：

1. `board init` + `.dsh-board/tickets` 文件模型  
2. `board_list` / `get` / `create` / `update` 工具  
3. `/board` 侧栏四列 UI + 自动刷新  
4. `/board load` 将会话相关 open/in_progress 注入  
5. 中途 `board_create` 记旁路任务不打断主流程  
6. ignore 模板 + 简短用户文档  

可第二期：

- handover 自动化  
- story 层级  
- worktree/subagent 派发 + 验证门  
- GitHub issue 双向同步  
- 全局跨项目收件箱  

---

## 10. 验收用例（摘要）

1. **跨会话恢复**  
   会话 A 创建 T-001 in_progress → 结束 → 新会话 `/board load` → 模型能复述 T-001 与下一步。

2. **压缩后不丢**  
   长会话触发 compaction 后，看板仍显示 T-001；`/board load` 仍可用。

3. **旁路任务**  
   主任务进行中让 agent「记一个 ticket：xxx」→ 出现 open 卡，主任务继续。

4. **UI 同步**  
   手动编辑 `T-001.md` 状态为 done → 数秒内看板列移动。

5. **无 store 安静**  
   未 init 的项目不弹错误刷屏，仅在用户打开 `/board` 时提示初始化。

6. **与 goal 共存**  
   已有 goal 插件的项目安装后互不覆盖配置；ticket 可写 `goalId` 关联。

---

## 11. 安全与合规

- [ ] 工具写路径限制在配置的 board root 下  
- [ ] 不自动 `git commit`（除非用户明确要求的后续增强）  
- [ ] 描述中可能含密钥的风险在文档中提示用户自审  
- [ ] 二期派发若使用 worktree，禁止对 board root 外任意路径的未审批删除  

**许可注意**：Storybloq 为 PolyForm Shield，**不要复制其专有实现或商标**；本插件应独立实现数据模型与 UI，可兼容「类似目录约定」。Sidequest 为 MIT，可学习其工作流设计，仍建议独立代码。

---

## 12. 与 dsh 现有能力关系

| 能力 | 关系 |
|------|------|
| goal / trajectory | ticket 可绑定 goal；看板是「跨会话可视化层」 |
| subagent | 二期派发目标；MVP 只记账不派发 |
| session log | 正交；可选把 board 变更记一条插件事件便于审计 |
| code review 插件 | 可在 ticket 验收条件中引用 review 结果 |
| shared-session | 协作时可共享已 commit 的 `.dsh-board/` |

---

## 13. 实现任务拆分（建议）

| 阶段 | 任务 | 预估 |
|------|------|------|
| A | 数据模型 + init + 文件读写库 | 2d |
| B | board_* 工具 + 命令 | 2–3d |
| C | Web 侧栏看板 UI + 监听刷新 | 3–4d |
| D | `/board load` 摘要注入 | 1–2d |
| E | 文档、ignore 模板、验收用例 | 1–2d |

**MVP 合计约 1.5–2.5 人周**（不含派发）。

---

## 14. 参考链接

- Storybloq 仓库：https://github.com/Storybloq/storybloq  
- Storybloq 官网：https://storybloq.com  
- claude-mods 页：https://claude-mods.com/storybloq/  
- Sidequest 所在 monorepo：https://github.com/Eigenwise/eigenwise-toolshed  
- Sidequest 路径：`plugins/sidequest`  
- Sidequest 文档：https://eigenwise.github.io/eigenwise-toolshed/getting-started/sidequest/  
- claude-mods 页：https://claude-mods.com/sidequest/  

---

## 15. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0-draft | 2026-10-25 | 初稿：合并 Storybloq 文件账本 + Sidequest 持久看板思路，给出 dsh MVP |

---

*本文档可直接作为插件仓库的 `docs/REQUIREMENTS.md`。实现前请用目标 dsh 版本的 UI slot / tools API 再核对事件名与权限模型。*
