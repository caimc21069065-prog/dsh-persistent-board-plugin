import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseFrontmatter, serializeFrontmatter } from '../lib/frontmatter.mjs';
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

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-board-test-'));
}

function boardDir(project) {
  return path.join(project, '.dsh-board');
}

test('frontmatter: roundtrip with arrays and quoting', () => {
  const data = {
    id: 'T-001',
    title: 'Fix: crash when "value" contains, commas',
    labels: ['bug', 'c++'],
    blockedBy: [],
    assignee: 'main',
  };
  const text = serializeFrontmatter(data) + 'Body line one\nBody line two\n';
  const { data: parsed, body } = parseFrontmatter(text);
  assert.equal(parsed.id, 'T-001');
  assert.equal(parsed.title, 'Fix: crash when "value" contains, commas');
  assert.deepEqual(parsed.labels, ['bug', 'c++']);
  assert.deepEqual(parsed.blockedBy, []);
  assert.equal(parsed.assignee, 'main');
  assert.equal(body, 'Body line one\nBody line two\n');
});

test('frontmatter: file without frontmatter passes through', () => {
  const { data, body } = parseFrontmatter('just a body\n');
  assert.deepEqual(data, {});
  assert.equal(body, 'just a body\n');
});

test('frontmatter: CRLF files are handled', () => {
  const { data, body } = parseFrontmatter('---\r\nid: T-001\r\n---\r\nbody\r\n');
  assert.equal(data.id, 'T-001');
  assert.equal(body, 'body\n', 'CRLF is normalized to LF for stable diffs');
});

test('resolveBoardRoot: walks up to an existing store', () => {
  const project = tmpProject();
  initStore(boardDir(project));
  const nested = path.join(project, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  const resolved = resolveBoardRoot(nested, {});
  assert.equal(resolved.exists, true);
  assert.equal(path.resolve(resolved.root), path.resolve(boardDir(project)));
});

test('resolveBoardRoot: defaults to <startDir>/.dsh-board when missing', () => {
  const project = tmpProject();
  const resolved = resolveBoardRoot(project, {});
  assert.equal(resolved.exists, false);
  assert.equal(resolved.root, path.join(project, '.dsh-board'));
});

test('resolveBoardRoot: honors DSH_BOARD_ROOT', () => {
  const project = tmpProject();
  const custom = path.join(project, 'custom-board');
  const resolved = resolveBoardRoot(project, { DSH_BOARD_ROOT: custom });
  assert.equal(resolved.root, path.resolve(custom));
});

test('initStore: creates layout, is idempotent and preserves config', () => {
  const project = tmpProject();
  const root = boardDir(project);
  const first = initStore(root);
  assert.equal(first.existed, false);
  assert.ok(fs.existsSync(path.join(root, 'tickets')));
  assert.ok(fs.existsSync(path.join(root, 'stories')));
  assert.ok(fs.existsSync(path.join(root, 'handovers')));
  assert.ok(fs.existsSync(path.join(root, 'config.json')));
  assert.ok(fs.existsSync(path.join(root, '.gitignore')));

  const config = readConfig(root);
  config.columns = ['open', 'doing', 'done'];
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config), 'utf8');

  const second = initStore(root);
  assert.equal(second.existed, true);
  assert.deepEqual(readConfig(root).columns, ['open', 'doing', 'done']);
});

test('createTicket: sequential ids, validation and defaults', () => {
  const project = tmpProject();
  const root = boardDir(project);
  initStore(root);

  const a = createTicket(root, { title: 'First ticket', description: '## Context\nsomething' });
  assert.equal(a.id, 'T-001');
  assert.equal(a.status, 'open');
  assert.equal(a.body, '## Context\nsomething');

  const b = createTicket(root, { title: 'Second', labels: ['bug'], goalId: 'g1', blockedBy: ['T-001'] });
  assert.equal(b.id, 'T-002');
  assert.deepEqual(b.labels, ['bug']);
  assert.deepEqual(b.blockedBy, ['T-001']);

  assert.throws(() => createTicket(root, { title: '  ' }), BoardError);
  assert.throws(() => createTicket(root, { title: 'X', status: 'nope' }), /Unknown status/);
  assert.throws(() => createTicket(root, { title: 'X', blockedBy: ['../evil'] }), BoardError);
});

test('getTicket: roundtrip including optional fields, rejects path escape', () => {
  const project = tmpProject();
  const root = boardDir(project);
  initStore(root);
  createTicket(root, { title: 'With meta', assignee: 'main', goalId: 'goal-1', story: 'S-01', priority: 'p1', labels: ['a', 'b'] });
  const ticket = getTicket(root, 'T-001');
  assert.equal(ticket.assignee, 'main');
  assert.equal(ticket.goalId, 'goal-1');
  assert.equal(ticket.story, 'S-01');
  assert.equal(ticket.priority, 'p1');
  assert.deepEqual(ticket.labels, ['a', 'b']);
  assert.throws(() => getTicket(root, '../evil'), BoardError);
  assert.throws(() => getTicket(root, 'T-999'), /not found/i);
});

test('updateTicket: status, labels, body operations', () => {
  const project = tmpProject();
  const root = boardDir(project);
  initStore(root);
  createTicket(root, { title: 'T', labels: ['a'] });

  const before = getTicket(root, 'T-001');
  const updated = updateTicket(root, 'T-001', { status: 'in_progress', addLabels: ['b'], removeLabels: ['a'] });
  assert.equal(updated.status, 'in_progress');
  assert.deepEqual(updated.labels, ['b']);
  assert.ok(updated.updatedAt >= before.updatedAt);

  updateTicket(root, 'T-001', { description: 'New body' });
  assert.equal(getTicket(root, 'T-001').body, 'New body');

  updateTicket(root, 'T-001', { appendBody: 'Appended line' });
  assert.match(getTicket(root, 'T-001').body, /New body\n\nAppended line/);

  updateTicket(root, 'T-001', { goalId: '' });
  assert.equal(getTicket(root, 'T-001').goalId, undefined);

  assert.throws(() => updateTicket(root, 'T-001', { status: 'nope' }), BoardError);
  assert.throws(() => updateTicket(root, 'T-042', { title: 'x' }), /not found/i);
});

test('addComment: appends a timestamped note', () => {
  const project = tmpProject();
  const root = boardDir(project);
  initStore(root);
  createTicket(root, { title: 'T', description: 'Base' });
  addComment(root, 'T-001', { text: 'narrowed to isolate path', author: 'main' });
  const ticket = getTicket(root, 'T-001');
  assert.match(ticket.body, /^Base/);
  assert.match(ticket.body, /### .* · main/);
  assert.match(ticket.body, /narrowed to isolate path/);
  assert.throws(() => addComment(root, 'T-001', { text: '  ' }), BoardError);
});

test('listTickets: filters, sorting, truncation, warnings', () => {
  const project = tmpProject();
  const root = boardDir(project);
  initStore(root);
  createTicket(root, { title: 'Bug one', labels: ['bug'], description: 'x'.repeat(300) });
  createTicket(root, { title: 'Feature two', status: 'in_progress' });
  createTicket(root, { title: 'Wait on dep', status: 'blocked', blockedBy: ['T-001'] });
  createTicket(root, { title: 'Old work', status: 'done' });

  const all = listTickets(root, { maxDescription: 0 });
  assert.equal(all.total, 4);
  assert.deepEqual(all.tickets.map((t) => t.status), ['open', 'in_progress', 'blocked', 'done']);

  const open = listTickets(root, { status: 'open' });
  assert.equal(open.total, 1);

  const byLabel = listTickets(root, { label: 'bug' });
  assert.equal(byLabel.total, 1);
  assert.equal(byLabel.tickets[0].id, 'T-001');

  const byQuery = listTickets(root, { query: 'feature' });
  assert.equal(byQuery.total, 1);
  assert.equal(byQuery.tickets[0].id, 'T-002');

  const noDone = listTickets(root, { includeDone: false, maxDescription: 0 });
  assert.equal(noDone.total, 3);

  const truncated = listTickets(root, { status: 'open' });
  assert.equal(truncated.tickets[0].description.length, 160);
  assert.ok(truncated.tickets[0].description.endsWith('…'));

  const listed = listTickets(root, { maxDescription: 0 });
  assert.equal(listed.tickets.find((t) => t.id === 'T-001').blocked, false);
  const blocked = listed.tickets.find((t) => t.id === 'T-003');
  assert.equal(blocked.blocked, true);
  assert.deepEqual(blocked.blockedBy, ['T-001']);

  assert.throws(() => listTickets(root, { status: 'nope' }), BoardError);

  fs.writeFileSync(path.join(root, 'tickets', 'T-broken.md'), 'not a ticket');
  const warned = listTickets(root, { maxDescription: 0 });
  assert.ok(warned.tickets.every((t) => t.id !== undefined));
});

test('boardStatus: counts and blocked summary; quiet when missing', () => {
  const project = tmpProject();
  const root = boardDir(project);
  assert.equal(boardStatus(root).exists, false);

  initStore(root);
  createTicket(root, { title: 'A', status: 'in_progress', goalId: 'g1' });
  createTicket(root, { title: 'B', status: 'blocked', blockedBy: ['T-001'] });
  const status = boardStatus(root);
  assert.equal(status.exists, true);
  assert.equal(status.counts.open, 0);
  assert.equal(status.counts.in_progress, 1);
  assert.equal(status.counts.blocked, 1);
  assert.equal(status.inProgress[0].id, 'T-001');
  assert.equal(status.blocked[0].id, 'T-002');
  assert.deepEqual(status.blocked[0].blockedBy, ['T-001']);
});

test('handover: write, validation and read-latest', () => {
  const project = tmpProject();
  const root = boardDir(project);
  initStore(root);
  assert.throws(() => writeHandover(root, { summary: '' }), BoardError);

  writeHandover(root, { summary: 'Did the thing', decisions: 'Use JSON store', next: 'Write tests', sessionId: 'sess-abc' });
  const { handovers } = readHandovers(root, { limit: 3 });
  assert.equal(handovers.length, 1);
  assert.match(handovers[0].file, /sess-abc/);
  assert.equal(handovers[0].session, 'sess-abc');
  assert.match(handovers[0].summary, /Did the thing/);
  assert.match(handovers[0].body, /## Decisions[\s\S]*Use JSON store/);
  assert.match(handovers[0].body, /## Next[\s\S]*Write tests/);

  writeHandover(root, { summary: 'Newer handover' });
  const latest = readHandovers(root, { limit: 1 }).handovers;
  assert.equal(latest.length, 1);
  assert.match(latest[0].summary, /Newer handover/);
});

test('render: text and html output stay informative and escaped', () => {
  const project = tmpProject();
  const root = boardDir(project);
  initStore(root);
  createTicket(root, { title: 'Escaped <script>alert(1)</script>', labels: ['bug'] });

  const text = renderBoardText(root);
  assert.match(text, /Board:/);
  assert.match(text, /open: 1/);

  const ticket = getTicket(root, 'T-001');
  assert.match(renderTicketText(ticket), /T-001 \[open\]/);

  const state = buildBoardState(root);
  assert.equal(state.exists, true);
  assert.deepEqual(state.columns, ['open', 'in_progress', 'blocked', 'done', 'cancelled']);
  assert.equal(state.tickets.length, 1);

  const html = boardHtml(state, { live: false });
  assert.match(html, /dsh-board 持久看板/);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'titles must not appear unescaped');
  assert.ok(html.includes('\\u003cscript>'), 'embedded state JSON must escape < as \\u003c');

  const missing = buildBoardState(path.join(project, 'nope'));
  assert.equal(missing.exists, false);
  assert.doesNotThrow(() => boardHtml(missing, { live: false }));
});
