---
description: 将看板当前焦点（open/in_progress/blocked + 最近交接）注入当前会话
---

按 `dsh-board:board` skill 执行「会话开场 / 压缩后恢复」工作流：

1. 读取看板：`board_status` + `board_list`（status=open,in_progress,blocked；maxDescription 适当放大到 400）。
2. 读取最近一份 handover（`board_handover_read`，limit=1）。
3. 向用户输出一段**短**结构化摘要并据此恢复任务焦点：
   - **进行中**：ticket id + 标题 + 下一步（来自 body/评论/交接的 next）；
   - **被阻塞**：id + 阻塞原因（blockedBy 或评论）；
   - **待办**：open ticket 的 id + 标题（仅列标题，不展开）；
   - **最近交接**：summary 与 next 的要点。
4. 若列表为空且无 handover：告知看板当前为空。
5. 摘要之后直接问用户：要继续进行中的哪一项，还是开始新任务？不要未经确认就开始大段实现。
