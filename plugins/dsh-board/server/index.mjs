#!/usr/bin/env node
// dsh-board MCP server — exposes the .dsh-board/ store as board_* tools over
// the MCP stdio transport (newline-delimited JSON-RPC 2.0). Zero runtime
// dependencies. Start with --ui (or DSH_BOARD_UI=1) to also serve the local
// live dashboard.

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
import { startDashboard } from '../lib/dashboard.mjs';

const VERSION = '0.1.0';

const TOOL_SCHEMAS = {
  board_init: {
    description:
      'Initialize the persistent board store (.dsh-board/) in the current project: creates tickets/, stories/, handovers/, config.json and a .gitignore for machine-local files. Idempotent — an existing store is never overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Optional board directory. Defaults to <project>/.dsh-board (or DSH_BOARD_ROOT).' },
      },
    },
  },
  board_list: {
    description:
      'List board tickets. Filter by status, label, or free-text query. Default output truncates ticket bodies to keep responses small; use maxDescription=0 to omit or a number to control length.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Comma-separated status filter, e.g. "open,in_progress".' },
        label: { type: 'string', description: 'Comma-separated label filter (matches any).' },
        query: { type: 'string', description: 'Free-text filter over id, title and body.' },
        includeDone: { type: 'boolean', description: 'Include done/cancelled tickets (default true).' },
        limit: { type: 'number', description: 'Max tickets to return.' },
        maxDescription: { type: 'number', description: 'Truncate each description to N chars; 0 omits it. Default 160.' },
      },
    },
  },
  board_get: {
    description: 'Get one ticket with its full Markdown body (description, acceptance criteria, discussion notes).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Ticket id, e.g. "T-001".' } },
      required: ['id'],
    },
  },
  board_create: {
    description:
      'Create a ticket. Use this to record work without interrupting the current task (e.g. a side bug found mid-task): it lands in the open column and is picked up later.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string', description: 'Markdown body: context, repro steps, acceptance criteria.' },
        labels: { type: 'array', items: { type: 'string' } },
        blockedBy: { type: 'array', items: { type: 'string' }, description: 'Ticket ids this ticket depends on.' },
        assignee: { type: 'string', description: 'Agent or person, e.g. "main".' },
        goalId: { type: 'string', description: 'Optional dsh goal id to bind this ticket to.' },
        story: { type: 'string', description: 'Optional story/epic id.' },
        priority: { type: 'string' },
        status: { type: 'string', description: 'Defaults to "open".' },
      },
      required: ['title'],
    },
  },
  board_update: {
    description:
      'Update a ticket: status (open/in_progress/blocked/done/cancelled or project-configured columns), title, labels, blockedBy, assignee, goalId, or the Markdown body (description replaces; appendBody adds).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Replaces the label list.' },
        addLabels: { type: 'array', items: { type: 'string' } },
        removeLabels: { type: 'array', items: { type: 'string' } },
        blockedBy: { type: 'array', items: { type: 'string' } },
        assignee: { type: 'string', description: 'Empty string removes.' },
        goalId: { type: 'string', description: 'Empty string removes.' },
        story: { type: 'string' },
        priority: { type: 'string' },
        description: { type: 'string', description: 'Replaces the Markdown body.' },
        appendBody: { type: 'string', description: 'Appends Markdown to the body.' },
      },
      required: ['id'],
    },
  },
  board_comment: {
    description: 'Append a timestamped progress/decision note to a ticket. Comments persist on disk and survive compaction.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        text: { type: 'string' },
        author: { type: 'string', description: 'Defaults to "agent".' },
      },
      required: ['id', 'text'],
    },
  },
  board_handover_write: {
    description:
      'Write a structured session handover (summary, decisions, next steps) into .dsh-board/handovers/. Call it when wrapping up a significant work session so the next session can resume.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        decisions: { type: 'string' },
        next: { type: 'string' },
        sessionId: { type: 'string' },
        author: { type: 'string' },
      },
      required: ['summary'],
    },
  },
  board_handover_read: {
    description: 'Read the latest handover(s), newest first.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Default 1.' } },
    },
  },
  board_status: {
    description:
      'Compact board summary: per-column counts, in-progress tickets, blocked tickets, latest handover. Cheap way to answer "what should I do next".',
    inputSchema: { type: 'object', properties: {} },
  },
};

function toolDefinitions() {
  return Object.entries(TOOL_SCHEMAS).map(([name, spec]) => ({ name, ...spec }));
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function jsonResult(data) {
  return textResult(JSON.stringify(data, null, 2));
}

function createContext(explicitRoot) {
  const { root, exists } = resolveBoardRoot(process.cwd(), process.env, explicitRoot);
  return { root, exists };
}

function dispatchTool(name, args = {}) {
  const ctx = createContext(name === 'board_init' ? args.root : null);
  switch (name) {
    case 'board_init': {
      const result = initStore(ctx.root);
      const config = readConfig(ctx.root);
      return jsonResult({
        root: ctx.root,
        existed: result.existed,
        created: result.created,
        message: result.existed
          ? `Board store already exists at ${ctx.root}; nothing was overwritten.`
          : `Board store initialized at ${ctx.root}. Columns: ${config.columns.join(', ')}`,
      });
    }
    case 'board_list':
      return jsonResult(
        listTickets(ctx.root, {
          status: args.status,
          label: args.label,
          query: args.query,
          includeDone: args.includeDone !== false,
          limit: args.limit,
          maxDescription: args.maxDescription,
        })
      );
    case 'board_get':
      return jsonResult({ ...getTicket(ctx.root, args.id), _file: undefined });
    case 'board_create': {
      const ticket = createTicket(ctx.root, args);
      return jsonResult({
        ...ticket,
        message: `Created ${ticket.id} [${ticket.status}] ${ticket.title}`,
      });
    }
    case 'board_update': {
      const { id, ...patch } = args;
      const ticket = updateTicket(ctx.root, id, patch);
      return jsonResult({ ...ticket, message: `Updated ${ticket.id} → [${ticket.status}] ${ticket.title}` });
    }
    case 'board_comment': {
      const ticket = addComment(ctx.root, args.id, { text: args.text, author: args.author });
      return jsonResult({ ...ticket, message: `Comment added to ${ticket.id}` });
    }
    case 'board_handover_write': {
      const result = writeHandover(ctx.root, args);
      return jsonResult({ ...result, message: `Handover written: ${result.file}` });
    }
    case 'board_handover_read':
      return jsonResult(readHandovers(ctx.root, { limit: args.limit }));
    case 'board_status': {
      const status = boardStatus(ctx.root);
      if (!status.exists) {
        return textResult(
          `No board store at ${ctx.root}. Call board_init (or /dsh-board:board-init) to create one. This is not an error — the board is simply not initialized for this project.`
        );
      }
      return jsonResult(status);
    }
    default:
      throw new BoardError(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
  }
}

let dashboardPromise = null;
function maybeStartDashboard() {
  const enabled = process.argv.includes('--ui') || process.env.DSH_BOARD_UI === '1';
  if (!enabled || dashboardPromise) return;
  const { root } = resolveBoardRoot(process.cwd(), process.env, null);
  const port = Number(process.env.DSH_BOARD_UI_PORT) || (() => { try { return readConfig(root).ui.port; } catch { return 7788; } })();
  dashboardPromise = startDashboard({ root, port })
    .then((dash) => {
      process.stderr.write(`[dsh-board] dashboard: ${dash.url}\n`);
      return dash;
    })
    .catch((error) => {
      process.stderr.write(`[dsh-board] dashboard failed to start: ${error.message}\n`);
      return null;
    });
}

async function handle(message) {
  const { id, method, params } = message || {};
  if (method === 'initialize') {
    return {
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'dsh-board', version: VERSION },
      },
    };
  }
  if (method === 'ping') {
    return { id, result: {} };
  }
  if (method === 'tools/list') {
    return { id, result: { tools: toolDefinitions() } };
  }
  if (method === 'tools/call') {
    maybeStartDashboard();
    try {
      const result = dispatchTool(params.name, params.arguments || {});
      return { id, result };
    } catch (error) {
      const hint = error.code === 'NO_STORE' ? ' Hint: call board_init first.' : '';
      return { id, result: textResult(`${error.message}${hint}`, true) };
    }
  }
  if (method && typeof method === 'string' && method.startsWith('notifications/')) {
    return null; // notifications get no response
  }
  if (id !== undefined && id !== null) {
    return { id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
  return null;
}

function main() {
  maybeStartDashboard();
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        process.stderr.write(`[dsh-board] ignoring unparseable message: ${error.message}\n`);
        continue;
      }
      handle(message)
        .then((response) => {
          if (response) process.stdout.write(JSON.stringify(response) + '\n');
        })
        .catch((error) => {
          process.stderr.write(`[dsh-board] handler error: ${error.stack || error.message}\n`);
          if (message && message.id !== undefined && message.id !== null) {
            process.stdout.write(
              JSON.stringify({ id: message.id, error: { code: -32603, message: String(error.message || error) } }) + '\n'
            );
          }
        });
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stderr.write(`[dsh-board] MCP server v${VERSION} ready (tools: ${Object.keys(TOOL_SCHEMAS).join(', ')})\n`);
}

main();
