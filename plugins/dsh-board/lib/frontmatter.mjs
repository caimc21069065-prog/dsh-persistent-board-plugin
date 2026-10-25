// Minimal YAML frontmatter parser/serializer for ticket files.
// Supported value shapes: plain scalars (kept as strings), double-quoted
// scalars, and inline arrays: [a, b, "c, d"]. Multiline scalars are not
// supported on purpose — long text belongs in the Markdown body.

function needsQuoting(value) {
  return value === '' || /[:#\[\],"']|\n|\r|^[\s]|[\s]$/.test(value);
}

function quoteScalar(value) {
  if (!needsQuoting(value)) return value;
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}

function unquoteScalar(raw) {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\["\\nrt]/g, (ch) => {
      switch (ch) {
        case '\\n': return '\n';
        case '\\r': return '\r';
        case '\\t': return '\t';
        case '\\"': return '"';
        default: return '\\';
      }
    });
  }
  return value;
}

function parseArray(raw) {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === '') return [];
  const items = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' && inner[i - 1] !== '\\') inQuotes = !inQuotes;
    if (ch === ',' && !inQuotes) {
      items.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map((item) => unquoteScalar(item)).filter((item) => item !== '');
}

export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { data: {}, body: text };
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0].trim() !== '---') return { data: {}, body: text };
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex === -1) return { data: {}, body: text };
  const data = {};
  for (let i = 1; i < closeIndex; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const rawValue = line.slice(sep + 1).trim();
    if (rawValue === '') {
      data[key] = '';
    } else if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      data[key] = parseArray(rawValue);
    } else {
      data[key] = unquoteScalar(rawValue);
    }
  }
  const body = lines.slice(closeIndex + 1).join('\n').replace(/^\n+/, '');
  return { data, body };
}

export function serializeFrontmatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const items = value.map((item) => quoteScalar(String(item)));
      lines.push(`${key}: [${items.join(', ')}]`);
    } else {
      lines.push(`${key}: ${quoteScalar(String(value))}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}
