import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../server/index.mjs', import.meta.url));

function startServer(projectDir) {
  const child = spawn(process.execPath, [serverPath], { cwd: projectDir, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
  const request = (id, method, params) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method} (stderr: ${stderr})`)), 8000);
      pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
      send({ jsonrpc: '2.0', id, method, params });
    });
  const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
  const stop = () => {
    child.stdin.end();
    child.kill();
  };
  return { child, request, notify, stop, stderrText: () => stderr };
}

test('MCP server: handshake, tool list and board tool calls over stdio', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-board-mcp-'));
  const server = startServer(project);

  try {
    const init = await server.request(1, 'initialize', { protocolVersion: '2024-11-05' });
    assert.equal(init.result.serverInfo.name, 'dsh-board');
    assert.ok(init.result.capabilities.tools);
    server.notify('notifications/initialized', {});

    const list = await server.request(2, 'tools/list', {});
    const names = list.result.tools.map((t) => t.name);
    assert.ok(names.includes('board_list'));
    assert.ok(names.includes('board_get'));
    assert.ok(names.includes('board_create'));
    assert.ok(names.includes('board_update'));
    assert.ok(names.includes('board_comment'));
    assert.ok(names.includes('board_handover_write'));
    assert.ok(names.includes('board_handover_read'));
    assert.ok(names.includes('board_init'));
    assert.ok(names.includes('board_status'));

    const initCall = await server.request(3, 'tools/call', { name: 'board_init', arguments: {} });
    assert.ok(!initCall.result.isError);
    assert.match(initCall.result.content[0].text, /initialized/i);

    const createCall = await server.request(4, 'tools/call', {
      name: 'board_create',
      arguments: { title: 'From MCP', description: 'created by the smoke test', labels: ['test'] },
    });
    assert.match(createCall.result.content[0].text, /Created T-001/);

    const listCall = await server.request(5, 'tools/call', {
      name: 'board_list',
      arguments: { status: 'open' },
    });
    const parsed = JSON.parse(listCall.result.content[0].text);
    assert.equal(parsed.total, 1);
    assert.equal(parsed.tickets[0].title, 'From MCP');

    const getCall = await server.request(6, 'tools/call', { name: 'board_get', arguments: { id: 'T-001' } });
    const ticket = JSON.parse(getCall.result.content[0].text);
    assert.equal(ticket.body, 'created by the smoke test');

    const updateCall = await server.request(7, 'tools/call', {
      name: 'board_update',
      arguments: { id: 'T-001', status: 'in_progress' },
    });
    assert.match(updateCall.result.content[0].text, /in_progress/);

    const loose = await server.request(10, 'tools/call', {
      name: 'board_create',
      arguments: { title: 'Loose client', labels: 'bug,ui', blockedBy: 'T-001' },
    });
    const looseTicket = JSON.parse(loose.result.content[0].text);
    assert.deepEqual(looseTicket.labels, ['bug', 'ui']);
    assert.deepEqual(looseTicket.blockedBy, ['T-001']);

    const missing = await server.request(8, 'tools/call', { name: 'board_get', arguments: { id: 'T-999' } });
    assert.equal(missing.result.isError, true);
    assert.match(missing.result.content[0].text, /not found/i);

    const unknown = await server.request(9, 'tools/call', { name: 'board_nope', arguments: {} });
    assert.equal(unknown.result.isError, true);

    const onDisk = fs.readFileSync(path.join(project, '.dsh-board', 'tickets', 'T-001.md'), 'utf8');
    assert.match(onDisk, /^---\n/);
    assert.match(onDisk, /title: From MCP/);
  } finally {
    server.stop();
  }
});
