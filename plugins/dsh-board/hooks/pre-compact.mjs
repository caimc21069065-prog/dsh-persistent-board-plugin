// PreCompact hook — remind that board state lives on disk and survives
// compaction; point at the load command. Silent when there is no store.

import { resolveBoardRoot, boardStatus } from '../lib/store.mjs';

const { root, exists } = resolveBoardRoot(process.cwd(), process.env, null);
if (exists) {
  try {
    const status = boardStatus(root);
    if (status.exists) {
      console.log(
        `[dsh-board] 压缩前提示：看板状态保存在磁盘 ${root}，不受 compaction 影响。` +
          `压缩后如需恢复任务焦点，运行 /dsh-board:board-load。`
      );
    }
  } catch {
    // never break compaction over a board problem
  }
}
