---
description: 看板状态文字摘要（CLI 风格，不做 UI）
---

按 `dsh-board:board` skill 输出看板文字摘要：

1. 调用 `board_status`（无 MCP 时等价于 `board-cli status --json` 或直接读 `.dsh-board/`）。
2. store 不存在时：一句话提示未初始化（`/dsh-board:board-init`），结束。
3. 输出简洁文字摘要：各列计数、进行中列表（id + 标题 + assignee + goalId）、阻塞列表（含 blockedBy）、最新交接文件名。不要展开 ticket 正文。
