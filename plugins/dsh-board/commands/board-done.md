---
description: 验证并关闭一张 ticket（置为 done）
argument-hint: <ticket-id 或标题关键词>
---

按 `dsh-board:board` skill 执行状态流转。参数（`$ARGUMENTS`）是 ticket id（如 T-001）或标题关键词。

1. 定位 ticket：id 精确匹配优先；否则用 `board_list` + query 按标题匹配；命中多张时列出让用户选择，不要猜。
2. 读取全文（`board_get`）：若 body 中有 `## Acceptance` / 验收条件，先逐条核对；能当场验证的（跑测试、复现）就验证；不能验证的向用户说明并将该 ticket 置为 `in_progress` + 评论剩余验收项，而不是直接关闭。
3. 验证通过后：`board_update` 置 `status=done`，并 `board_comment` 记录一句验证方式（如「unit tests passed」）。
4. 简短回复：`T-XXX done ✓（验证方式）`。若有因此解除阻塞的其他 ticket，顺带提醒用户。
