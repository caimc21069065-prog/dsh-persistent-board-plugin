import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initStore, createTicket } from '../lib/store.mjs';
import { startDashboard } from '../lib/dashboard.mjs';

test('dashboard: serves state, ticket detail and proper error codes on an OS-assigned port', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-board-dash-'));
  const root = path.join(project, '.dsh-board');
  initStore(root);
  createTicket(root, { title: 'Dash ticket', description: 'hello' });

  const dash = await startDashboard({ root, port: 0 });
  try {
    assert.ok(!dash.url.endsWith(':0'), 'port 0 must resolve to the actually bound port');

    const state = await (await fetch(`${dash.url}/api/state`)).json();
    assert.equal(state.exists, true);
    assert.equal(state.counts.open, 1);
    assert.equal(state.tickets[0].title, 'Dash ticket');

    const ticket = await (await fetch(`${dash.url}/api/ticket/T-001`)).json();
    assert.equal(ticket.title, 'Dash ticket');
    assert.equal(ticket._file, undefined);

    assert.equal((await fetch(`${dash.url}/api/ticket/T-999`)).status, 404);
    assert.equal((await fetch(`${dash.url}/api/ticket/%zz`)).status, 400);
    assert.equal((await fetch(`${dash.url}/api/ticket/..%2Fconfig`)).status, 400);
    assert.equal((await fetch(`${dash.url}/api/nope`)).status, 404);

    const html = await (await fetch(`${dash.url}/`)).text();
    assert.match(html, /dsh-board 持久看板/);
    assert.match(html, /Dash ticket/);
  } finally {
    dash.close();
  }
});
