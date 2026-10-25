// Core store I/O for the dsh-board plugin. The .dsh-board/ directory is the
// single source of truth: one Markdown file with YAML frontmatter per ticket,
// plain Markdown handovers, and a JSON config. All writes stay inside the
// board root.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';

export const BOARD_DIR_NAME = '.dsh-board';

export const STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  DONE: 'done',
  CANCELLED: 'cancelled',
};

export const DEFAULT_COLUMNS = [STATUS.OPEN, STATUS.IN_PROGRESS, STATUS.BLOCKED, STATUS.DONE, STATUS.CANCELLED];
export const DEFAULT_DONE_COLUMNS = [STATUS.DONE, STATUS.CANCELLED];

export class BoardError extends Error {
  constructor(message, code = 'BOARD_ERROR') {
    super(message);
    this.name = 'BoardError';
    this.code = code;
  }
}

export function defaultConfig() {
  return {
    version: 1,
    columns: [...DEFAULT_COLUMNS],
    doneColumns: [...DEFAULT_DONE_COLUMNS],
    defaultLabels: [],
    sessionSummary: false,
    ui: { port: 7788 },
  };
}

/**
 * Resolve the board directory for a project.
 * Order: explicit root → DSH_BOARD_ROOT env → nearest `.dsh-board/` walking up
 * from startDir → `<startDir>/.dsh-board` (candidate, may not exist yet).
 */
export function resolveBoardRoot(startDir = process.cwd(), env = process.env, explicit = null) {
  if (explicit) {
    return { root: path.resolve(explicit), exists: fs.existsSync(path.join(path.resolve(explicit), 'config.json')) };
  }
  if (env && env.DSH_BOARD_ROOT) {
    const root = path.resolve(env.DSH_BOARD_ROOT);
    return { root, exists: fs.existsSync(path.join(root, 'config.json')) };
  }
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, BOARD_DIR_NAME);
    if (fs.existsSync(path.join(candidate, 'config.json')) || fs.existsSync(path.join(candidate, 'tickets'))) {
      return { root: candidate, exists: true };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { root: path.join(path.resolve(startDir), BOARD_DIR_NAME), exists: false };
}

export function readConfig(root) {
  const configPath = path.join(root, 'config.json');
  if (!fs.existsSync(configPath)) return defaultConfig();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new BoardError(`config.json is not valid JSON: ${configPath} (${error.message})`, 'CONFIG_INVALID');
  }
  const merged = {
    ...defaultConfig(),
    ...raw,
    ui: { ...defaultConfig().ui, ...(raw.ui || {}) },
  };
  const isColumnList = (value) => Array.isArray(value) && value.length > 0 && value.every((c) => typeof c === 'string');
  if (!isColumnList(merged.columns)) merged.columns = defaultConfig().columns;
  if (!isColumnList(merged.doneColumns)) merged.doneColumns = defaultConfig().doneColumns;
  if (!Array.isArray(merged.defaultLabels)) merged.defaultLabels = [];
  return merged;
}

export function assertExists(root) {
  if (!fs.existsSync(path.join(root, 'tickets'))) {
    throw new BoardError(
      `No board store found at ${root}. Run board_init (or \`/dsh-board:board-init\`) first.`,
      'NO_STORE'
    );
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = path.join(dir, `.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

function isValidId(id) {
  return ID_PATTERN.test(id) && !WINDOWS_RESERVED.has(String(id).toUpperCase());
}

function ticketPath(root, id) {
  if (!isValidId(id)) {
    throw new BoardError(`Invalid ticket id: ${JSON.stringify(id)}`, 'INVALID_ID');
  }
  const file = path.join(root, 'tickets', `${id}.md`);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) {
    throw new BoardError(`Ticket path escapes board root: ${id}`, 'PATH_ESCAPE');
  }
  return file;
}

function nextId(root, prefix = 'T') {
  const dir = path.join(root, 'tickets');
  let max = 0;
  if (fs.existsSync(dir)) {
    const pattern = new RegExp(`^${prefix}-(\\d+)\\.md$`);
    for (const name of fs.readdirSync(dir)) {
      const match = pattern.exec(name);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

const FRONTMATTER_ORDER = ['id', 'title', 'status', 'labels', 'blockedBy', 'assignee', 'goalId', 'story', 'priority', 'createdAt', 'updatedAt'];

export function serializeTicket(ticket) {
  const data = {};
  for (const key of FRONTMATTER_ORDER) {
    if (ticket[key] !== undefined) data[key] = ticket[key];
  }
  for (const [key, value] of Object.entries(ticket)) {
    if (key === 'body' || key.startsWith('_')) continue;
    if (!(key in data) && value !== undefined) data[key] = value;
  }
  return serializeFrontmatter(data) + '\n' + (ticket.body || '').replace(/\s*$/, '') + '\n';
}

function parseTicketFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  return { ...data, body: body.replace(/\s+$/, ''), _file: file };
}

export function initStore(root, options = {}) {
  const created = [];
  const existsBefore = fs.existsSync(path.join(root, 'tickets'));
  const ensureTracked = (rel) => {
    if (!fs.existsSync(path.join(root, rel))) {
      ensureDir(path.join(root, rel));
      created.push(`${rel}/`);
    }
  };
  ensureTracked('tickets');
  ensureTracked('stories');
  ensureTracked('handovers');
  ensureTracked('cache');

  const configPath = path.join(root, 'config.json');
  if (!fs.existsSync(configPath)) {
    const config = { ...defaultConfig(), ...options.config };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    created.push('config.json');
  }
  const gitignorePath = path.join(root, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '# Machine-local files (locks, temp files). Safe to keep the rest of the store under version control.\ncache/\n', 'utf8');
    created.push('.gitignore');
  }
  return { root, existed: existsBefore, created };
}

export function createTicket(root, input = {}) {
  assertExists(root);
  const config = readConfig(root);
  const title = String(input.title || '').trim();
  if (!title) throw new BoardError('title is required', 'VALIDATION');
  const status = input.status || STATUS.OPEN;
  if (!config.columns.includes(status)) {
    throw new BoardError(`Unknown status "${status}". Configured columns: ${config.columns.join(', ')}`, 'VALIDATION');
  }
  const now = new Date().toISOString();
  const labels = normalizeList(input.labels) ?? normalizeList(config.defaultLabels) ?? [];
  const blockedBy = normalizeList(input.blockedBy) ?? [];
  for (const ref of blockedBy) {
    if (!isValidId(ref)) throw new BoardError(`Invalid blockedBy reference: ${JSON.stringify(ref)}`, 'VALIDATION');
  }

  const ticket = {
    id: null,
    title,
    status,
    labels,
    blockedBy,
    createdAt: now,
    updatedAt: now,
    body: input.description ? String(input.description) : '',
  };
  if (input.assignee) ticket.assignee = String(input.assignee);
  if (input.goalId) ticket.goalId = String(input.goalId);
  if (input.story) ticket.story = String(input.story);
  if (input.priority) ticket.priority = String(input.priority);

  const dir = path.join(root, 'tickets');
  ensureDir(dir);
  const prefix = (input.idPrefix ? String(input.idPrefix) : 'T').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'T';
  for (let attempt = 0; attempt < 1000; attempt++) {
    ticket.id = nextId(root, prefix);
    const file = ticketPath(root, ticket.id);
    try {
      const handle = fs.openSync(file, 'wx');
      fs.writeSync(handle, serializeTicket(ticket), null, 'utf8');
      fs.closeSync(handle);
      return ticket;
    } catch (error) {
      if (error.code === 'EEXIST') continue; // concurrent creation: take the next id
      throw error;
    }
  }
  throw new BoardError('Could not allocate a ticket id after 1000 attempts', 'ID_EXHAUSTED');
}

export function getTicket(root, id) {
  assertExists(root);
  const file = ticketPath(root, id);
  if (!fs.existsSync(file)) {
    throw new BoardError(`Ticket not found: ${id}`, 'NOT_FOUND');
  }
  return parseTicketFile(file);
}

export function updateTicket(root, id, patch = {}) {
  assertExists(root);
  const config = readConfig(root);
  const ticket = getTicket(root, id);

  if (patch.title !== undefined) {
    const title = String(patch.title).trim();
    if (!title) throw new BoardError('title cannot be empty', 'VALIDATION');
    ticket.title = title;
  }
  if (patch.status !== undefined && patch.status !== ticket.status) {
    const status = String(patch.status);
    if (!config.columns.includes(status)) {
      throw new BoardError(`Unknown status "${status}". Configured columns: ${config.columns.join(', ')}`, 'VALIDATION');
    }
    ticket.status = status;
  }
  if (patch.labels !== undefined) {
    ticket.labels = normalizeList(patch.labels) ?? [];
  }
  if (patch.addLabels !== undefined) {
    const add = normalizeList(patch.addLabels) ?? [];
    ticket.labels = [...new Set([...(ticket.labels || []), ...add])];
  }
  if (patch.removeLabels !== undefined) {
    const remove = new Set(normalizeList(patch.removeLabels) ?? []);
    ticket.labels = (ticket.labels || []).filter((l) => !remove.has(l));
  }
  if (patch.blockedBy !== undefined) {
    const refs = normalizeList(patch.blockedBy) ?? [];
    for (const ref of refs) {
      if (!isValidId(ref)) throw new BoardError(`Invalid blockedBy reference: ${JSON.stringify(ref)}`, 'VALIDATION');
    }
    ticket.blockedBy = refs;
  }
  if (patch.assignee !== undefined) {
    if (patch.assignee === null || patch.assignee === '') delete ticket.assignee;
    else ticket.assignee = String(patch.assignee);
  }
  if (patch.goalId !== undefined) {
    if (patch.goalId === null || patch.goalId === '') delete ticket.goalId;
    else ticket.goalId = String(patch.goalId);
  }
  if (patch.story !== undefined) {
    if (patch.story === null || patch.story === '') delete ticket.story;
    else ticket.story = String(patch.story);
  }
  if (patch.priority !== undefined) {
    if (patch.priority === null || patch.priority === '') delete ticket.priority;
    else ticket.priority = String(patch.priority);
  }
  if (patch.description !== undefined) {
    ticket.body = String(patch.description);
  }
  if (patch.appendBody !== undefined) {
    ticket.body = ((ticket.body || '').replace(/\s*$/, '') + '\n\n' + String(patch.appendBody)).trim() + '\n';
  }
  ticket.updatedAt = new Date().toISOString();
  atomicWrite(ticketPath(root, id), serializeTicket(ticket));
  return ticket;
}

export function addComment(root, id, { text, author = 'agent' } = {}) {
  assertExists(root);
  const body = String(text || '').trim();
  if (!body) throw new BoardError('comment text is required', 'VALIDATION');
  const ticket = getTicket(root, id);
  const stamp = new Date().toISOString();
  ticket.body = ((ticket.body || '').replace(/\s*$/, '') +
    `\n\n### ${stamp} · ${String(author)}\n\n${body}\n`).trim() + '\n';
  ticket.updatedAt = stamp;
  atomicWrite(ticketPath(root, id), serializeTicket(ticket));
  return ticket;
}

function truncate(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

// Accepts arrays (MCP schema) or comma-separated strings (CLI / loose clients);
// undefined passes through so callers can keep their own defaults.
function normalizeList(value) {
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((item) => String(item).trim()).filter((item) => item !== '');
}

export function listTickets(root, filter = {}) {
  assertExists(root);
  const config = readConfig(root);
  const dir = path.join(root, 'tickets');
  const warnings = [];
  const doneSet = new Set(config.doneColumns);
  const statusOrder = new Map(config.columns.map((c, i) => [c, i]));

  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { tickets: [], warnings, config };
  }
  const tickets = [];
  for (const name of names) {
    if (!name.endsWith('.md') || name.startsWith('.')) continue;
    try {
      const parsed = parseTicketFile(path.join(dir, name));
      if (!parsed.id || !parsed.title) {
        warnings.push(`skipped ${name}: missing id or title in frontmatter`);
        continue;
      }
      // The frontmatter id is canonical; a mismatch with the filename means a
      // hand rename/edit went wrong — surface it instead of forking the truth.
      if (String(parsed.id) !== name.replace(/\.md$/, '')) {
        warnings.push(`skipped ${name}: frontmatter id ${parsed.id} does not match filename`);
        continue;
      }
      tickets.push(parsed);
    } catch (error) {
      warnings.push(`skipped ${name}: ${error.message}`);
    }
  }

  // Dependency resolution from the in-memory index: no per-ref disk reads, so a
  // 500-ticket board stays well inside the <100ms listing budget (NFR-2).
  const byId = new Map(tickets.map((t) => [String(t.id), t]));

  let result = tickets;
  if (filter.status) {
    const wanted = Array.isArray(filter.status) ? filter.status : String(filter.status).split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = wanted.filter((s) => !config.columns.includes(s));
    if (unknown.length) {
      throw new BoardError(`Unknown status filter: ${unknown.join(', ')}. Configured columns: ${config.columns.join(', ')}`, 'VALIDATION');
    }
    result = result.filter((t) => wanted.includes(t.status));
  }
  if (filter.includeDone === false) {
    result = result.filter((t) => !doneSet.has(t.status));
  }
  if (filter.label) {
    const wanted = Array.isArray(filter.label) ? filter.label : String(filter.label).split(',').map((s) => s.trim()).filter(Boolean);
    result = result.filter((t) => wanted.some((l) => (t.labels || []).includes(l)));
  }
  if (filter.query) {
    const q = String(filter.query).toLowerCase();
    result = result.filter(
      (t) => String(t.id || '').toLowerCase().includes(q) || String(t.title || '').toLowerCase().includes(q) || String(t.body || '').toLowerCase().includes(q)
    );
  }

  result.sort((a, b) => {
    const statusDiff = (statusOrder.get(a.status) ?? 99) - (statusOrder.get(b.status) ?? 99);
    if (statusDiff !== 0) return statusDiff;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });

  const total = result.length;
  const limit = Number(filter.limit);
  if (Number.isFinite(limit) && limit > 0) result = result.slice(0, limit);
  const maxDescription = filter.maxDescription !== undefined ? Number(filter.maxDescription) : 160;

  return {
    tickets: result.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      labels: t.labels || [],
      blockedBy: t.blockedBy || [],
      assignee: t.assignee,
      goalId: t.goalId,
      story: t.story,
      priority: t.priority,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      blocked: (t.blockedBy || []).length > 0,
      openBlockers: (t.blockedBy || []).filter((ref) => {
        const dep = byId.get(String(ref));
        return dep ? !doneSet.has(dep.status) : false;
      }),
      description: maxDescription > 0 ? truncate(t.body, maxDescription) : undefined,
      _file: undefined,
    })),
    total,
    warnings,
    config,
  };
}

export function boardStatus(root) {
  if (!fs.existsSync(path.join(root, 'tickets'))) {
    return { exists: false, root };
  }
  const config = readConfig(root);
  const { tickets } = listTickets(root, { maxDescription: 0 });
  const counts = Object.fromEntries(config.columns.map((c) => [c, 0]));
  for (const t of tickets) {
    if (counts[t.status] !== undefined) counts[t.status] += 1;
    else counts[t.status] = 1;
  }
  const latestHandover = readHandovers(root, { limit: 1 }).handovers[0] || null;
  return {
    exists: true,
    root,
    counts,
    total: tickets.length,
    inProgress: tickets
      .filter((t) => t.status === STATUS.IN_PROGRESS)
      .map((t) => ({ id: t.id, title: t.title, assignee: t.assignee, goalId: t.goalId })),
    blocked: tickets
      .filter((t) => t.status === STATUS.BLOCKED || (t.blockedBy || []).length > 0)
      .map((t) => ({ id: t.id, title: t.title, blockedBy: t.blockedBy || [] })),
    latestHandover: latestHandover
      ? { file: latestHandover.file, createdAt: latestHandover.createdAt, session: latestHandover.session }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export function writeHandover(root, input = {}) {
  assertExists(root);
  const summary = String(input.summary || '').trim();
  if (!summary) throw new BoardError('handover summary is required', 'VALIDATION');
  const now = new Date();
  const stamp = now.toISOString();
  const base = `${stamp.slice(0, 10)}-${stamp.slice(11, 19).replace(/:/g, '')}`;
  let slug = 'session';
  if (input.sessionId) {
    const candidate = String(input.sessionId).toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (SLUG_PATTERN.test(candidate)) slug = candidate;
  }
  let file = path.join(root, 'handovers', `${base}-${slug}.md`);
  for (let n = 2; fs.existsSync(file); n++) {
    file = path.join(root, 'handovers', `${base}-${slug}-${n}.md`);
  }
  const sections = [`## Summary`, '', summary, ''];
  const decisions = String(input.decisions || '').trim();
  if (decisions) sections.push('## Decisions', '', decisions, '');
  const next = String(input.next || '').trim();
  if (next) sections.push('## Next', '', next, '');
  const content =
    serializeFrontmatter({
      type: 'handover',
      createdAt: stamp,
      session: input.sessionId ? String(input.sessionId) : undefined,
      author: input.author ? String(input.author) : undefined,
    }) + sections.join('\n');
  atomicWrite(file, content);
  return { file, createdAt: stamp, session: input.sessionId || null };
}

export function readHandovers(root, { limit = 1 } = {}) {
  const dir = path.join(root, 'handovers');
  if (!fs.existsSync(dir)) return { handovers: [] };
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('.'))
    .sort()
    .reverse()
    .slice(0, Math.max(1, limit));
  const handovers = [];
  for (const name of files) {
    const file = path.join(dir, name);
    const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const summaryMatch = body.match(/^## Summary\s*\n+([\s\S]*?)(?=\n## |$)/);
    handovers.push({ file: name, ...data, body, summary: truncate(summaryMatch ? summaryMatch[1] : body, 400) });
  }
  return { handovers };
}
