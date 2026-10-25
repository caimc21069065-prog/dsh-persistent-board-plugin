#!/usr/bin/env node
// dsh-board CLI — zero-dependency command line for the .dsh-board/ store.
// Same operations as the MCP tools; handy for humans, hooks, and agents
// without an MCP connection.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BoardError,
  addComment,
  boardStatus,
  createTicket,
  getTicket,
  initStore,
  listTickets,
  readConfig,
  readHandovers,
  resolveBoardRoot,
  updateTicket,
  writeHandover,
} from '../lib/store.mjs';
import { buildBoardState, boardHtml, renderBoardText, renderTicketText } from '../lib/render.mjs';
import { startDashboard, openBrowser } from '../lib/dashboard.mjs';

const VERSION = '0.1.1';

function usage() {
  return `dsh-board CLI v${VERSION}

Usage:
  board-cli init [--root <dir>]
  board-cli list [--status open,in_progress] [--label bug] [--query text] [--limit 20] [--json] [--no-trunc]
  board-cli get <id> [--json]
  board-cli create --title <title> [--desc <text> | --desc-file <path>] [--labels a,b]
                  [--blocked-by T-001,T-002] [--assignee me] [--goal <goalId>]
                  [--story <id>] [--priority p1] [--status open] [--json]
  board-cli update <id> [--status <s>] [--title <t>] [--labels a,b] [--add-labels x]
                    [--remove-labels x] [--blocked-by refs] [--assignee me]
                    [--goal <id>] [--priority p1] [--desc <text> | --desc-file <path>]
                    [--append <text>] [--json]
  board-cli done <id>
  board-cli comment <id> [--text <note>] [--author main]
  board-cli handover write --summary <text> [--decisions <text>] [--next <text>] [--session <id>]
  board-cli handover read [--limit 3] [--json]
  board-cli status [--json]
  board-cli serve [--port 7788] [--open]
  board-cli snapshot --out <file>
  board-cli help
`;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function output(data, flags) {
  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

function readDescInput(flags) {
  if (flags['desc-file']) {
    return fs.readFileSync(path.resolve(String(flags['desc-file'])), 'utf8');
  }
  if (flags.desc !== undefined) return String(flags.desc);
  return undefined;
}

function splitList(value) {
  if (value === undefined || value === true) return undefined;
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);

  if (!command || command === 'help' || flags.help) {
    console.log(usage());
    return;
  }
  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return;
  }

  const { root } = resolveBoardRoot(process.cwd(), process.env, flags.root ? String(flags.root) : null);

  switch (command) {
    case 'init': {
      const result = initStore(root);
      const config = readConfig(root);
      const summary = result.existed
        ? `Board store already exists at ${root} — nothing was overwritten.`
        : `Initialized board store at ${root}\nCreated: ${result.created.join(', ')}`;
      console.log(summary);
      console.log(`Columns: ${config.columns.join(' | ')}`);
      console.log('Tip: commit .dsh-board/ (minus cache/) to share the board, or add `.dsh-board/` to your project .gitignore to keep it local.');
      if (flags.json) console.log(JSON.stringify({ root, existed: result.existed }, null, 2));
      return;
    }
    case 'list': {
      const result = listTickets(root, {
        status: flags.status !== undefined ? String(flags.status) : undefined,
        label: flags.label !== undefined ? String(flags.label) : undefined,
        query: flags.query !== undefined ? String(flags.query) : undefined,
        includeDone: !flags.open,
        limit: flags.limit ? parseInt(flags.limit, 10) || undefined : undefined,
        maxDescription: flags['no-trunc'] ? 0 : 160,
      });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (!result.tickets.length) {
        console.log('No tickets matched.');
        return;
      }
      for (const t of result.tickets) {
        const flagsText = [t.blocked ? `⛔${(t.blockedBy || []).join(',')}` : null, (t.labels || []).join(',') || null, t.assignee || null, t.goalId ? `{${t.goalId}}` : null]
          .filter(Boolean)
          .join(' ');
        console.log(`${t.id.padEnd(8)} [${t.status.padEnd(11)}] ${t.title}${flagsText ? `  (${flagsText})` : ''}`);
        if (t.description) console.log(`${' '.repeat(10)}${t.description}`);
      }
      console.log(`\n${result.total} ticket(s)${result.warnings.length ? ` | warnings: ${result.warnings.join('; ')}` : ''}`);
      return;
    }
    case 'get': {
      const ticket = getTicket(root, positional[0]);
      output(flags.json ? { ...ticket, _file: undefined } : renderTicketText(ticket), flags);
      return;
    }
    case 'create': {
      const ticket = createTicket(root, {
        title: flags.title !== undefined ? String(flags.title) : positional.join(' '),
        description: readDescInput(flags),
        labels: splitList(flags.labels),
        blockedBy: splitList(flags['blocked-by']),
        assignee: flags.assignee,
        goalId: flags.goal,
        story: flags.story,
        priority: flags.priority,
        status: flags.status,
      });
      output(flags.json ? ticket : `Created ${ticket.id} [${ticket.status}] ${ticket.title}`, flags);
      return;
    }
    case 'update': {
      const patch = {
        status: flags.status,
        title: flags.title,
        labels: flags.labels !== undefined ? splitList(flags.labels) : undefined,
        addLabels: flags['add-labels'] !== undefined ? splitList(flags['add-labels']) : undefined,
        removeLabels: flags['remove-labels'] !== undefined ? splitList(flags['remove-labels']) : undefined,
        blockedBy: flags['blocked-by'] !== undefined ? splitList(flags['blocked-by']) : undefined,
        assignee: flags.assignee,
        goalId: flags.goal,
        story: flags.story,
        priority: flags.priority,
        description: readDescInput(flags),
        appendBody: flags.append !== undefined ? String(flags.append) : undefined,
      };
      const ticket = updateTicket(root, positional[0], patch);
      output(flags.json ? ticket : `Updated ${ticket.id} → [${ticket.status}] ${ticket.title}`, flags);
      return;
    }
    case 'done': {
      const ticket = updateTicket(root, positional[0], { status: 'done' });
      output(flags.json ? ticket : `Done: ${ticket.id} ${ticket.title}`, flags);
      return;
    }
    case 'comment': {
      let text = flags.text !== undefined ? String(flags.text) : undefined;
      if (text === undefined) {
        text = fs.readFileSync(0, 'utf8'); // stdin
      }
      const ticket = addComment(root, positional[0], { text, author: flags.author ? String(flags.author) : 'agent' });
      output(flags.json ? ticket : `Comment added to ${ticket.id}`, flags);
      return;
    }
    case 'handover': {
      const [sub] = positional;
      if (sub === 'write') {
        const result = writeHandover(root, {
          summary: flags.summary !== undefined ? String(flags.summary) : flags['desc-file'] ? fs.readFileSync(path.resolve(String(flags['desc-file'])), 'utf8') : undefined,
          decisions: flags.decisions,
          next: flags.next,
          sessionId: flags.session,
          author: flags.author,
        });
        output(flags.json ? result : `Handover written: ${result.file}`, flags);
        return;
      }
      if (sub === 'read') {
        const { handovers } = readHandovers(root, { limit: parseInt(flags.limit, 10) || 1 });
        output(flags.json ? handovers : handovers.map((h) => `=== ${h.file} (${h.createdAt}) ===\n${h.body.trim()}`).join('\n\n') || 'No handovers yet.', flags);
        return;
      }
      throw new BoardError('Usage: board-cli handover <write|read> [...]', 'USAGE');
    }
    case 'status': {
      const status = boardStatus(root);
      output(flags.json ? status : renderBoardText(root), flags);
      return;
    }
    case 'serve': {
      const port = flags.port ? parseInt(flags.port, 10) : (readConfigSafe(root)?.ui?.port ?? 7788);
      const { url } = await startDashboard({ root, port });
      console.log(`dsh-board dashboard: ${url}`);
      console.log('Press Ctrl+C to stop. (Read-only view; edit tickets via agent tools or board-cli.)');
      if (flags.open) openBrowser(url);
      return;
    }
    case 'snapshot': {
      if (!flags.out) throw new BoardError('snapshot requires --out <file>', 'USAGE');
      const state = buildBoardState(root);
      const html = boardHtml(state, { live: false });
      const out = path.resolve(String(flags.out));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, html, 'utf8');
      console.log(`Snapshot written: ${out}`);
      return;
    }
    default:
      throw new BoardError(`Unknown command: ${command}\n\n${usage()}`, 'USAGE');
  }
}

function readConfigSafe(root) {
  try {
    return readConfig(root);
  } catch {
    return null;
  }
}

main().catch((error) => {
  if (error instanceof BoardError && error.code === 'NO_STORE') {
    console.error(error.message);
  } else {
    console.error(`board-cli: ${error.message}`);
  }
  process.exit(1);
});
