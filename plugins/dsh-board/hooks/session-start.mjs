// SessionStart hook — opt-in (config sessionSummary: true). Prints a very
// short board digest so a new/resumed session picks up current focus.
// Stays completely silent when there is no store or the flag is off, so
// projects without the board are never spammed.

import fs from 'node:fs';
import path from 'node:path';
import { resolveBoardRoot, readConfig, listTickets, readHandovers } from '../lib/store.mjs';

const { root, exists } = resolveBoardRoot(process.cwd(), process.env, null);
if (exists) {
  try {
    const config = readConfig(root);
    if (config.sessionSummary) {
      const { tickets } = listTickets(root, { maxDescription: 0 });
      const doneColumns = new Set(config.doneColumns);
      const active = tickets.filter((t) => !doneColumns.has(t.status));
      const counts = {};
      for (const t of tickets) counts[t.status] = (counts[t.status] || 0) + 1;
      const lines = [`[dsh-board] 看板摘要 (${path.basename(path.dirname(root))}): ${active.length} active / ${tickets.length} total — ${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ')}`];
      for (const t of active.slice(0, 10)) {
        lines.push(`  ${t.id} [${t.status}] ${t.title}${t.assignee ? ` (@${t.assignee})` : ''}`);
      }
      const { handovers } = readHandovers(root, { limit: 1 });
      if (handovers.length) {
        lines.push(`  最近交接: ${handovers[0].file}`);
      }
      lines.push('  运行 /dsh-board:board-load 查看完整上下文。');
      console.log(lines.join('\n'));
    }
  } catch {
    // never break the session over a board problem
  }
}
