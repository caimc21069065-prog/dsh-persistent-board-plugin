---
description: 在当前项目初始化 dsh-board 持久看板（.dsh-board/）
---

按 `dsh-board:board` skill 的规则处理。执行初始化工作流：

1. 调用 `board_init`（无 MCP 时按 skill 创建 `.dsh-board/` 布局：tickets/、stories/、handovers/、config.json、.gitignore）。
2. 若已存在：明确告知「已存在，未做任何修改」，不要覆盖任何文件。
3. 初始化成功后输出：store 路径、默认列、以及一句提示 —— 将 `.dsh-board/`（除 cache/）纳入版本控制可跨会话/团队共享；不想提交可把 `.dsh-board/` 加入项目 .gitignore（由用户自行决定，不要代改 git 配置）。
4. 询问用户是否现在创建第一张 ticket（可选，不强制）。
