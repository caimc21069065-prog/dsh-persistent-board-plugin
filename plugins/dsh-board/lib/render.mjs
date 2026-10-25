// Rendering for dsh-board: text summaries for CLI/tool output and a
// self-contained HTML board (used by both the local live dashboard and the
// static snapshot export).

import { readConfig, listTickets, readHandovers, boardStatus } from './store.mjs';

export function buildBoardState(root) {
  const status = boardStatus(root);
  if (!status.exists) {
    return { exists: false, root, columns: [], tickets: [], counts: {}, handover: null, generatedAt: new Date().toISOString() };
  }
  const config = readConfig(root);
  const { tickets } = listTickets(root, { maxDescription: 0 });
  return {
    exists: true,
    root,
    columns: config.columns,
    doneColumns: config.doneColumns,
    counts: status.counts,
    tickets: tickets.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      labels: t.labels,
      blockedBy: t.blockedBy,
      blocked: t.blocked,
      openBlockers: t.openBlockers,
      assignee: t.assignee,
      goalId: t.goalId,
      story: t.story,
      priority: t.priority,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    handover: status.latestHandover,
    generatedAt: status.generatedAt,
  };
}

export function renderBoardText(root) {
  const status = boardStatus(root);
  if (!status.exists) {
    return `No board store found at ${root}\nInitialize with: /dsh-board:board-init  (or \`board-cli init\`)`;
  }
  const lines = [];
  lines.push(`Board: ${status.root}`);
  const countParts = Object.entries(status.counts).map(([col, n]) => `${col}: ${n}`);
  lines.push(`Tickets (${status.total}): ${countParts.join(' | ')}`);
  if (status.inProgress.length) {
    lines.push('');
    lines.push('In progress:');
    for (const t of status.inProgress) {
      lines.push(`  ${t.id}  ${t.title}${t.assignee ? `  [${t.assignee}]` : ''}${t.goalId ? `  {${t.goalId}}` : ''}`);
    }
  }
  if (status.blocked.length) {
    lines.push('');
    lines.push('Blocked:');
    for (const t of status.blocked) {
      lines.push(`  ${t.id}  ${t.title}  (blockedBy: ${(t.blockedBy || []).join(', ') || '—'})`);
    }
  }
  if (status.latestHandover) {
    lines.push('');
    lines.push(`Latest handover: ${status.latestHandover.file} (${status.latestHandover.createdAt})`);
  }
  return lines.join('\n');
}

export function renderTicketText(ticket) {
  const lines = [];
  lines.push(`${ticket.id} [${ticket.status}] ${ticket.title}`);
  const meta = [];
  if (ticket.labels && ticket.labels.length) meta.push(`labels: ${ticket.labels.join(', ')}`);
  if (ticket.assignee) meta.push(`assignee: ${ticket.assignee}`);
  if (ticket.goalId) meta.push(`goalId: ${ticket.goalId}`);
  if (ticket.story) meta.push(`story: ${ticket.story}`);
  if (ticket.priority) meta.push(`priority: ${ticket.priority}`);
  if (ticket.blockedBy && ticket.blockedBy.length) meta.push(`blockedBy: ${ticket.blockedBy.join(', ')}`);
  if (meta.length) lines.push(meta.join(' | '));
  if (ticket.createdAt) lines.push(`created: ${ticket.createdAt}  updated: ${ticket.updatedAt}`);
  lines.push('');
  lines.push((ticket.body || '').trim() || '(no description)');
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root {
  --bg: #0f1115; --panel: #171a21; --panel-2: #1d212b; --border: #2a2f3a;
  --text: #e6e9ef; --muted: #9aa3b2; --accent: #5b9dff;
  --open: #5b9dff; --in_progress: #f2b135; --blocked: #ef5b6e; --done: #4fc487; --cancelled: #6b7280;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.55 "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--panel); position: sticky; top: 0; z-index: 5; }
header h1 { font-size: 16px; margin: 0; }
header .path { color: var(--muted); font-size: 12px; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
header .spacer { flex: 1; }
.badge { font-size: 12px; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; display: inline-block; }
.dot.live { background: var(--done); }
.dot.off { background: #6b7280; }
button, select { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 5px 12px; font-size: 13px; cursor: pointer; }
button:hover { border-color: var(--accent); }
main { padding: 18px 20px; display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); align-items: start; }
.column { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; min-height: 120px; }
.column h2 { margin: 0; padding: 10px 14px; font-size: 13px; letter-spacing: .04em; color: var(--muted); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; text-transform: uppercase; }
.column h2 .n { color: var(--text); }
.cards { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.card { background: var(--panel-2); border: 1px solid var(--border); border-left: 3px solid var(--muted); border-radius: 8px; padding: 8px 10px; cursor: pointer; }
.card:hover { border-color: var(--accent); }
.card .id { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--muted); }
.card .title { font-size: 13px; margin: 2px 0 4px; word-break: break-word; }
.card .meta { display: flex; flex-wrap: wrap; gap: 4px; font-size: 11px; color: var(--muted); }
.chip { border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; }
.chip.label { color: #bcd3ff; }
.chip.blocked { color: #ffb3bd; border-color: #7c3a44; }
.chip.goal { color: #9ee7c0; border-color: #2f5c48; }
.st-open { border-left-color: var(--open); }
.st-in_progress { border-left-color: var(--in_progress); }
.st-blocked { border-left-color: var(--blocked); }
.st-done { border-left-color: var(--done); opacity: .75; }
.st-cancelled { border-left-color: var(--cancelled); opacity: .6; }
.empty { color: var(--muted); font-size: 12px; padding: 10px; text-align: center; }
#drawer { position: fixed; top: 0; right: -560px; width: 540px; max-width: 92vw; height: 100vh; background: var(--panel); border-left: 1px solid var(--border); transition: right .18s ease; z-index: 20; display: flex; flex-direction: column; }
#drawer.open { right: 0; }
#drawer .head { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
#drawer .head h3 { margin: 0; font-size: 15px; flex: 1; }
#drawer .body { padding: 14px 16px; overflow-y: auto; flex: 1; }
#drawer .meta-row { color: var(--muted); font-size: 12px; margin-bottom: 10px; }
#drawer .section { margin-bottom: 14px; }
#drawer .section h4 { margin: 0 0 6px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
#drawer pre { white-space: pre-wrap; word-break: break-word; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin: 0; font: 12.5px/1.6 ui-monospace, Consolas, monospace; }
#drawer .md h3, #drawer .md h4, #drawer .md h5, #drawer .md h6 { margin: 12px 0 4px; }
#drawer .md p { margin: 6px 0; }
#drawer .md ul { margin: 6px 0; padding-left: 20px; }
#drawer .md code { background: var(--panel-2); border-radius: 4px; padding: 1px 5px; }
#backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: none; z-index: 15; }
#backdrop.open { display: block; }
.welcome { max-width: 640px; margin: 60px auto; text-align: center; color: var(--muted); }
.welcome h1 { color: var(--text); }
.welcome code { background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; }
`;

const SCRIPT = `
const LIVE = __LIVE__;
let state = __STATE__;
let currentId = null;

function timeShort(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Light, safe Markdown rendering for ticket bodies: escape everything first,
// then apply a few inline/block transforms.
function renderMd(body) {
  const lines = escHtml(body).split('\\n');
  const out = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const line of lines) {
    const inline = line
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    const heading = /^(#{1,4})\\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 2, 6);
      out.push('<h' + level + '>' + heading[2] + '</h' + level + '>');
      continue;
    }
    if (/^\\s*[-*]\\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push('<li>' + inline.replace(/^\\s*[-*]\\s+/, '') + '</li>');
      continue;
    }
    closeList();
    if (line.trim() === '') {
      out.push('');
    } else {
      out.push('<p>' + inline + '</p>');
    }
  }
  closeList();
  return out.join('\\n');
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function chip(text, cls) { return el('span', { class: 'chip ' + (cls || ''), text }); }

function cardEl(t) {
  const card = el('div', { class: 'card st-' + t.status, onclick: () => openTicket(t.id) });
  const meta = el('div', { class: 'meta' });
  meta.appendChild(chip(t.id, ''));
  if (t.priority) meta.appendChild(chip(t.priority, ''));
  for (const l of t.labels || []) meta.appendChild(chip(l, 'label'));
  if ((t.openBlockers || []).length) meta.appendChild(chip('⛔ ' + t.openBlockers.join(', '), 'blocked'));
  else if (t.status === 'blocked') meta.appendChild(chip('⛔ blocked', 'blocked'));
  if (t.assignee) meta.appendChild(chip('👤 ' + t.assignee, ''));
  if (t.goalId) meta.appendChild(chip('🎯 ' + t.goalId, 'goal'));
  card.appendChild(el('div', { class: 'id', text: timeShort(t.updatedAt) }));
  card.appendChild(el('div', { class: 'title', text: t.title }));
  card.appendChild(meta);
  return card;
}

function render() {
  const root = document.getElementById('app');
  root.innerHTML = '';
  if (!state.exists) {
    root.innerHTML = '<div class="welcome"><h1>持久看板</h1><p>当前项目还没有看板 store。</p>' +
      '<p>在对话中运行 <code>/dsh-board:board-init</code> 或执行 <code>board-cli init</code> 初始化 <code>.dsh-board/</code>。</p></div>';
    return;
  }
  const hideDone = document.getElementById('hide-done').checked;
  const columns = state.columns || [];
  const visible = columns.filter((c) => !(hideDone && (state.doneColumns || ['done', 'cancelled']).includes(c)));
  for (const col of visible) {
    const tickets = (state.tickets || []).filter((t) => t.status === col);
    const column = el('div', { class: 'column' });
    const h = el('h2', {}, el('span', { text: col }), el('span', { class: 'n', text: String(tickets.length) }));
    column.appendChild(h);
    const cards = el('div', { class: 'cards' });
    if (!tickets.length) cards.appendChild(el('div', { class: 'empty', text: '—' }));
    for (const t of tickets) cards.appendChild(cardEl(t));
    column.appendChild(cards);
    root.appendChild(column);
  }
  document.getElementById('counts').textContent = Object.entries(state.counts || {}).map(([k, v]) => k + ': ' + v).join('  ·  ');
  document.getElementById('handover').textContent = state.handover ? '最新交接: ' + state.handover.file : '暂无交接记录';
}

async function refresh() {
  if (!LIVE) return;
  try {
    const res = await fetch('/api/state');
    state = await res.json();
    render();
    if (currentId) openTicket(currentId, true);
  } catch (e) { /* keep last state */ }
}

async function openTicket(id, silent) {
  try {
    const res = await fetch('/api/ticket/' + encodeURIComponent(id));
    if (!res.ok) throw new Error('not found');
    const t = await res.json();
    currentId = id;
    const body = document.getElementById('drawer-body');
    body.innerHTML = '';
    const meta = el('div', { class: 'meta-row', text: [t.id, t.status, (t.labels || []).join(', '), t.assignee ? 'assignee: ' + t.assignee : null, t.goalId ? 'goal: ' + t.goalId : null, t.createdAt + ' → ' + t.updatedAt].filter(Boolean).join('  ·  ') });
    body.appendChild(meta);
    if ((t.blockedBy || []).length) {
      const sec = el('div', { class: 'section' });
      sec.appendChild(el('h4', { text: 'Blocked by' }));
      sec.appendChild(el('pre', { text: t.blockedBy.join('\\n') }));
      body.appendChild(sec);
    }
    const desc = el('div', { class: 'section' });
    desc.appendChild(el('h4', { text: '描述 / 记录' }));
    const md = el('div', { class: 'md' });
    md.innerHTML = renderMd(t.body);
    desc.appendChild(md);
    body.appendChild(desc);
    document.getElementById('drawer-title').textContent = t.title;
    document.getElementById('drawer').classList.add('open');
    document.getElementById('backdrop').classList.add('open');
  } catch (e) {
    if (!silent) console.error(e);
  }
}

function closeDrawer() {
  currentId = null;
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('backdrop').classList.remove('open');
}

document.getElementById('backdrop').addEventListener('click', closeDrawer);
document.getElementById('close').addEventListener('click', closeDrawer);
document.getElementById('hide-done').addEventListener('change', render);
document.getElementById('refresh').addEventListener('click', refresh);
render();

if (LIVE) {
  const dot = document.getElementById('conn');
  try {
    const es = new EventSource('/api/events');
    es.addEventListener('changed', refresh);
    es.onopen = () => dot.className = 'dot live';
    es.onerror = () => dot.className = 'dot off';
  } catch (e) { dot.className = 'dot off'; }
  setInterval(refresh, 30000);
}
`;

export function boardHtml(state, { live } = { live: false }) {
  // Function replacements: ticket titles may contain $& / $' patterns that a
  // string replacement argument would expand into the matched placeholder.
  const script = SCRIPT
    .replace('__LIVE__', () => (live ? 'true' : 'false'))
    .replace('__STATE__', () => JSON.stringify(state).replace(/</g, '\\u003c'));
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-board 持久看板</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <span id="conn" class="dot ${live ? 'off' : 'off'}" title="${live ? '实时刷新' : '静态快照'}"></span>
  <h1>📋 dsh-board 持久看板</h1>
  <span class="path" title="${escapeHtml(state.root || '')}">${escapeHtml(state.root || '')}</span>
  <span class="badge" id="counts"></span>
  <span class="badge" id="handover"></span>
  <span class="spacer"></span>
  <label style="color:var(--muted);font-size:12px"><input type="checkbox" id="hide-done"> 隐藏已完成</label>
  ${live ? '<button id="refresh">刷新</button>' : '<span class="badge">静态快照 · 运行 /dsh-board:board 获取实时视图</span>'}
</header>
<main id="app"></main>
<div id="backdrop"></div>
<aside id="drawer">
  <div class="head">
    <h3 id="drawer-title"></h3>
    <button id="close">✕</button>
  </div>
  <div class="body" id="drawer-body"></div>
</aside>
<script>${script}</script>
</body>
</html>
`;
}
