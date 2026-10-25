---
description: 快速记录一张 open ticket（中途记旁路任务，不打断主任务）
argument-hint: <标题> [— 简短说明]
---

按 `dsh-board:board` skill 执行「中途记旁路任务」工作流。参数（`$ARGUMENTS`）是 ticket 标题，可附带一句说明。

1. 若看板未初始化：先 `board_init`（等价于 /dsh-board:board-init，无需再确认）。
2. 用 `board_create` 创建 `open` ticket：标题取参数；若参数含补充说明则放入 description；可从上下文推断 labels（如 bug、refactor）。
3. **只做记录**：一句话回复「已记录 T-XXX：<标题>，稍后处理」，不要展开任何新实现或分析。
4. 若当前明显处于主任务执行中，回复保持最短，不改变主任务方向。
