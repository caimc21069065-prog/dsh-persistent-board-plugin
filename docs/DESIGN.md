# dsh-board 设计说明

对应需求规格：[dsh-persistent-board-plugin-requirements.md](../dsh-persistent-board-plugin-requirements.md)（版本 0.1.0-draft）。本文说明实现取舍、数据模型与验证情况。

## 1. 架构

```
ZCode 宿主
 └── dsh-board 插件
      ├── MCP server (server/index.mjs, stdio)   ← board_* 工具
      ├── commands/*.md + skills/board/SKILL.md  ← /dsh-board:board 命令族与 agent 工作流
      ├── hooks/ (SessionStart, PreCompact)      ← 可选摘要 / 压缩提示
      └── lib/ (store, frontmatter, render, dashboard)
              │  读写
              ▼
        <project>/.dsh-board/        ← 唯一真源（文件）
```

**分层原则**：store 是唯一事实；MCP 工具、CLI、skill 的直接文件操作三者等价。删掉任何一层，其余仍可用 —— 这保证「无 node / 无 MCP」环境下功能降级而非失效（对应 NFR-5、验收用例 5）。

## 2. 数据模型

### 2.1 Ticket（`tickets/T-001.md`）

YAML frontmatter + Markdown body。frontmatter 使用**严格子集**：标量一律存为字符串（日期、优先级无类型歧义），数组为行内 `[a, b]`，不支持多行标量 —— 长文本一律放 body。序列化器在含特殊字符时自动加引号，保证手工编辑与程序写回可逆（有往返测试覆盖）。

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✓ | 文件名即 id；`[A-Za-z0-9][A-Za-z0-9._-]*` 白名单校验，拒绝路径逃逸 |
| `title` | ✓ | |
| `status` | ✓ | 必须在 `config.columns` 内 |
| `labels` / `blockedBy` | 默认 `[]` | `blockedBy` 引用其他 ticket id；列表视图计算 `openBlockers`（未关闭的依赖数） |
| `assignee` / `goalId` / `story` / `priority` | 可选 | 删除以空串表示 |
| `createdAt` / `updatedAt` | ✓ | ISO 8601 UTC |

body 即描述（需求 FR-1.3 的 `description`），评论由 `board_comment` 以 `### <时间> · <作者>` 小节追加，`## Acceptance` 约定为验收清单（`board-done` 命令会先核对再关单，对应 FR-6.2 的验证精神在 v1 的落点）。

### 2.2 ID 分配与并发

扫描 `tickets/` 取最大序号 +1（`T-001` 起，三位零填充，超 999 自然增长）；创建用 `fs.open(wx)` 独占写，撞号自动顺延 —— 两个 agent 并行建卡不会写坏文件（MVP 级并发安全，未做跨进程文件锁，`cache/` 预留给二期派发锁）。

### 2.3 写入原子性

临时文件 + `rename`（同目录原子）；所有写路径经 `resolve` 后强制前缀校验在 board root 内。

### 2.4 config.json

```json
{
  "version": 1,
  "columns": ["open", "in_progress", "blocked", "done", "cancelled"],
  "doneColumns": ["done", "cancelled"],
  "defaultLabels": [],
  "sessionSummary": false,
  "ui": { "port": 7788 }
}
```

`columns` 即状态枚举与看板列（FR-1.4 可配置）；`doneColumns` 定义「已关闭」语义（过滤 active、判断 openBlockers）。init 幂等：目录存在则不触碰 config（FR-1.6）。

## 3. 看板 UI（FR-2）

同一渲染器（`lib/render.mjs`）产出两种形态：

- **本地 dashboard**（`board-cli serve` / MCP `--ui`）：`http://127.0.0.1:<port>`，只读。刷新链路 = `fs.watch`（递归，平台不支持时降级为分目录 watch）→ 300ms 去抖 → SSE `changed` 事件 → 页面重拉 `/api/state`；另含 30s 兜底轮询。**刷新不经过模型**（NFR-1）。
- **静态快照**（`board-cli snapshot --out <file>`）：单文件 HTML，内嵌 state JSON（`<` 转义为 `\u003c` 防止 `</script>` 逃逸），供无端口环境/内嵌展示。

卡片显示 id、标题、标签、阻塞标记（⛔ + blocker 列表）、assignee、goalId、优先级；点卡片右侧抽屉看全文（内置小型安全 Markdown 渲染：先整体 HTML 转义再施加有限转换）。窄屏时 CSS grid 自动换行降级（FR-2.6 的尽力实现）。

## 4. 会话连续性（FR-4）

| 机制 | 触发 | 默认 |
|------|------|------|
| `/dsh-board:board-load` | 用户显式 | — |
| SessionStart 摘要 | 每次会话开始 | **off**（`sessionSummary: true` 开启） |
| PreCompact 提示 | 压缩前 | on（仅当 store 存在） |
| 旁路任务 | agent 按需 | `board_create` 一句话确认，不展开 |

hook 输出刻意极短（≤10 行），且无 store 时零输出 —— 遵守「只增强、不绑架」（设计原则 3）与验收用例 5。

## 5. 与参考实现的关系

| 能力 | Storybloq | Sidequest | dsh-board v1 |
|------|-----------|-----------|--------------|
| 存储位置 | 仓库内 `.story/`（JSON） | 本地 store | 仓库内 `.dsh-board/`（MD+frontmatter） |
| 会话加载 | `/story` skill | 持久 ticket | `/dsh-board:board-load` + SessionStart |
| 看板 | Mac 侧栏（status.json 驱动） | 本地 dashboard | 本地 dashboard + 静态快照 |
| 交接 | `handover` 命令 | ticket 讨论 | `board_handover_*` |
| 派发/验证 | — | worktree + 验证门 | 二期（FR-6） |

许可证合规：Storybloq 为 PolyForm Shield —— **未复制其代码**，仅采用「文件账本 + 会话加载」这一工作流概念；Sidequest 为 MIT，同样只借鉴流程设计，代码独立实现。

## 6. 二期路线（FR-6 派发与验证）

1. **冲突预检**：两 ticket 触碰同一路径（可从 body 声明的 `paths:` frontmatter 读取）时禁止并行
2. **派发**：ready（open 且 openBlockers=0 且无路径冲突）ticket → subagent / git worktree 执行
3. **验证门**：executor 必须回传验证证据（测试输出、diff 摘要）写入 ticket 评论，才允许置 done
4. **全局收件箱**：用户级 store（FR-1.7），跨项目旁路任务

预留点：`cache/`（锁）、`stories/`（层级）、`story` 字段、`config.json` 版本号迁移。

## 7. 验证情况

| 验证项 | 状态 |
|--------|------|
| `node --test`（store/frontmatter/render 单测） | 15/15 通过 |
| MCP stdio 冒烟（initialize → tools/list → 6 次工具调用 + 错误路径） | 通过 |
| CLI E2E（init→create→update→comment→list→done→handover→status→snapshot→serve） | 通过 |
| dashboard HTTP + SSE（/api/state、/api/ticket/:id、/api/events） | 通过（curl 级） |
| hooks（无 store 静默 / 默认关 / 开启后摘要 / PreCompact） | 通过 |
| 插件 preflight（manifest 资源存在、路径包含、占位符） | 通过 |
| `zcode plugins validate`（schema 级） | 未执行：本机无 zcode CLI |
| 浏览器人工验收 dashboard 视觉 | 见交付说明 |
