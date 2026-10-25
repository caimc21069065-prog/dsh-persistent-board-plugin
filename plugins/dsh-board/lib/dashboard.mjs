// Local live dashboard for dsh-board. Serves the board HTML, a JSON state
// API, and an SSE stream fed by fs.watch on the board directory. Binds to
// 127.0.0.1 only and is read-only: mutations go through the agent tools /
// CLI, never the web UI.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildBoardState, boardHtml } from './render.mjs';
import { getTicket } from './store.mjs';

function startWatcher(root, onChange) {
  const events = [];
  let watcher;
  try {
    watcher = fs.watch(root, { recursive: true }, () => events.push(1));
  } catch {
    // Recursive watch unsupported on this platform: watch key paths separately.
    const watchers = [];
    for (const sub of ['', 'tickets', 'handovers']) {
      const dir = sub ? path.join(root, sub) : root;
      try {
        watchers.push(fs.watch(dir, () => events.push(1)));
      } catch {
        /* path may not exist yet */
      }
    }
    watcher = { close: () => watchers.forEach((w) => w.close()) };
  }
  const timer = setInterval(() => {
    if (events.length) {
      events.length = 0;
      onChange();
    }
  }, 300);
  return () => {
    clearInterval(timer);
    watcher.close();
  };
}

export function startDashboard({ root, port = 7788, host = '127.0.0.1' } = {}) {
  const clients = new Set();

  const broadcast = (event, data) => {
    const payload = `event: ${event}\ndata: ${data}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  };

  let stopWatcher = () => {};
  try {
    stopWatcher = startWatcher(root, () => broadcast('changed', JSON.stringify({ at: new Date().toISOString() })));
  } catch {
    /* dashboard still works with client-side polling */
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const state = buildBoardState(root);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(boardHtml(state, { live: true }));
        return;
      }
      if (url.pathname === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(buildBoardState(root)));
        return;
      }
      const ticketMatch = /^\/api\/ticket\/([^/]+)$/.exec(url.pathname);
      if (ticketMatch) {
        const ticket = getTicket(root, decodeURIComponent(ticketMatch[1]));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ...ticket, _file: undefined }));
        return;
      }
      if (url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
          'Cache-Control': 'no-store',
        });
        res.write(`event: changed\ndata: ${JSON.stringify({ hello: true })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    } catch (error) {
      const message = error.code === 'NOT_FOUND' ? `Ticket not found` : error.message;
      res.writeHead(error.code === 'NOT_FOUND' ? 404 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: message }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      stopWatcher();
      reject(error);
    });
    server.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      resolve({
        url,
        close: () => {
          stopWatcher();
          for (const res of clients) {
            try {
              res.end();
            } catch {
              /* already gone */
            }
          }
          clients.clear();
          server.close();
        },
      });
    });
  });
}

export function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}
