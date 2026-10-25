---
description: 打开 dsh-board 持久看板（支持 init/load/add/done/status 子命令）
argument-hint: [init | load | add <标题> | done <id> | status]
---

按 `dsh-board:board` skill 的规则处理本命令。参数：`$ARGUMENTS`

执行「看板视图」工作流：

1. 用 `board_status`（无 MCP 时按 skill 中的替代方式）读取当前项目看板状态。
2. 若 store 不存在：不要刷屏，告诉用户当前项目还没有看板，运行 `/dsh-board:board-init` 即可创建，然后结束。
3. 若 store 存在：
   - 向用户输出四列（按 config.columns）文字摘要：每列 ticket 的 id + 标题（带标签/阻塞/assignee 标记）；
   - 若宿主支持内嵌 HTML 可视化（如 ZCode Desktop），按 skill 生成静态快照 HTML 并引用展示；
   - 若参数包含 `serve` 或用户明确要实时视图，再后台启动 `board-cli serve` 并给出 URL（默认 http://127.0.0.1:7788）。
4. 若参数是子命令：`init` → 按初始化工作流；`load` → 按加载工作流；`add <标题>` → 创建 open ticket 并简短确认（不展开新工作）；`done <id>` → 验证验收条件后关闭；`status` → 仅输出文字摘要。
