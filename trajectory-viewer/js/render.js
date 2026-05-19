// CEOBench Trajectory Viewer - render logic

const STATE = {
  run: null,
  currentDayIdx: 0,
  daysList: [],
};

// ---------- formatters ----------
function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return sign + '$' + (a/1e9).toFixed(2) + 'B';
  if (a >= 1e6) return sign + '$' + (a/1e6).toFixed(2) + 'M';
  if (a >= 1e3) return sign + '$' + (a/1e3).toFixed(1) + 'K';
  return sign + '$' + a.toFixed(0);
}
function fmtInt(n) { return (n || 0).toLocaleString(); }
function escHTML(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- syntax highlight ----------
const PY_KW = new Set(['False','None','True','and','as','assert','async','await','break','class','continue','def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','nonlocal','not','or','pass','raise','return','try','while','with','yield']);
const SH_KW = new Set(['if','then','else','fi','for','while','do','done','case','esac','in','function','return','export','source','exit','set','unset','test','echo','cd','pwd','ls','mkdir','rm','cp','mv','cat','grep','sed','awk','find','python','python3','pip','uv','curl','wget','git']);

function highlightPython(code) {
  // crude tokenizer; works on display-only
  const out = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    // comment
    if (c === '#') {
      let j = code.indexOf('\n', i);
      if (j === -1) j = n;
      out.push('<span class="com">' + escHTML(code.slice(i, j)) + '</span>');
      i = j;
      continue;
    }
    // string
    if (c === '"' || c === "'") {
      const quote = c;
      const triple = code.slice(i, i+3) === quote.repeat(3);
      const m = triple ? quote.repeat(3) : quote;
      let j = i + m.length;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code.slice(j, j + m.length) === m) { j += m.length; break; }
        j++;
      }
      out.push('<span class="str">' + escHTML(code.slice(i, j)) + '</span>');
      i = j;
      continue;
    }
    // number
    if (/[0-9]/.test(c) && (i === 0 || /[^a-zA-Z0-9_]/.test(code[i-1]))) {
      let j = i;
      while (j < n && /[0-9_.eE+-]/.test(code[j])) j++;
      out.push('<span class="num">' + escHTML(code.slice(i, j)) + '</span>');
      i = j;
      continue;
    }
    // identifier
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_]/.test(code[j])) j++;
      const word = code.slice(i, j);
      const next = code[j];
      if (PY_KW.has(word)) {
        out.push('<span class="kw">' + escHTML(word) + '</span>');
      } else if (next === '(') {
        out.push('<span class="fn">' + escHTML(word) + '</span>');
      } else {
        out.push(escHTML(word));
      }
      i = j;
      continue;
    }
    out.push(escHTML(c));
    i++;
  }
  return out.join('');
}

function highlightDiff(text) {
  // Minimal unified-diff line coloring. Works on both real ``*** Begin Patch``
  // codex patches and standard ``diff --git`` patches. We color additions
  // green and deletions red; hunk/file headers get a muted blue.
  if (text == null) return '';
  const lines = String(text).split('\n');
  return lines.map(line => {
    const esc = escHTML(line);
    if (line.startsWith('+++') || line.startsWith('---')) {
      return `<span style="color:#7c3aed">${esc}</span>`;
    }
    if (line.startsWith('@@') || line.startsWith('***') || line.startsWith('diff ')) {
      return `<span style="color:#2563eb">${esc}</span>`;
    }
    if (line.startsWith('+')) {
      return `<span style="color:#16a34a">${esc}</span>`;
    }
    if (line.startsWith('-')) {
      return `<span style="color:#dc2626">${esc}</span>`;
    }
    return esc;
  }).join('\n');
}

function highlightShell(code) {
  const out = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === '#' && (i === 0 || code[i-1] === '\n' || code[i-1] === ' ')) {
      let j = code.indexOf('\n', i);
      if (j === -1) j = n;
      out.push('<span class="com">' + escHTML(code.slice(i, j)) + '</span>');
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\' && quote === '"') { j += 2; continue; }
        if (code[j] === quote) { j++; break; }
        j++;
      }
      out.push('<span class="str">' + escHTML(code.slice(i, j)) + '</span>');
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_-]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (SH_KW.has(word)) {
        out.push('<span class="kw">' + escHTML(word) + '</span>');
      } else {
        out.push(escHTML(word));
      }
      i = j;
      continue;
    }
    out.push(escHTML(c));
    i++;
  }
  return out.join('');
}

// ---------- diff ----------
function makeDiff(oldStr, newStr) {
  // Simple line-based diff using Myers shortest edit script (limited).
  // For brevity, use simple longest-common-prefix/suffix trim + line-level diff.
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  // Trim common prefix
  let p = 0;
  while (p < oldLines.length && p < newLines.length && oldLines[p] === newLines[p]) p++;
  // Trim common suffix
  let so = oldLines.length - 1;
  let sn = newLines.length - 1;
  while (so >= p && sn >= p && oldLines[so] === newLines[sn]) { so--; sn--; }
  const ctxBefore = Math.max(0, p - 2);
  const ctxAfterStart = so + 1;
  const ctxAfterEnd = Math.min(oldLines.length, ctxAfterStart + 2);
  const lines = [];
  if (ctxBefore < p) {
    for (let i = ctxBefore; i < p; i++) {
      lines.push({type:'ctx', text: oldLines[i]});
    }
  }
  if (p > 0 || so >= p || sn >= p) {
    lines.push({type:'hunk', text:`@@ -${p+1},${so-p+1} +${p+1},${sn-p+1} @@`});
  }
  for (let i = p; i <= so; i++) lines.push({type:'minus', text: oldLines[i]});
  for (let i = p; i <= sn; i++) lines.push({type:'plus', text: newLines[i]});
  if (ctxAfterStart < ctxAfterEnd) {
    for (let i = ctxAfterStart; i < ctxAfterEnd; i++) {
      lines.push({type:'ctx', text: oldLines[i]});
    }
  }
  return lines.map(l => {
    const cls = l.type === 'minus' ? 'minus' : l.type === 'plus' ? 'plus' : l.type === 'hunk' ? 'hunk' : 'ctx';
    const prefix = l.type === 'minus' ? '- ' : l.type === 'plus' ? '+ ' : l.type === 'hunk' ? '' : '  ';
    return `<div class="row-line ${cls}">${escHTML(prefix + (l.text || ''))}</div>`;
  }).join('');
}

// ---------- charts ----------
function buildCashChart(container, series, currentDay) {
  const W = 1060, H = 200, PL = 70, PR = 20, PT = 12, PB = 28;
  const cx = (d) => PL + (W - PL - PR) * (d / Math.max(1, currentDay));
  const filtered = series.filter(p => p.day <= currentDay);
  if (filtered.length === 0) {
    container.innerHTML = '<div style="color:#697386;font-size:11px;padding:8px;">No cash data yet.</div>';
    return;
  }
  let minY = Infinity, maxY = -Infinity;
  for (const p of filtered) { if (p.cash < minY) minY = p.cash; if (p.cash > maxY) maxY = p.cash; }
  if (minY === maxY) {
    const span = Math.max(1, Math.abs(minY) * 0.2);
    minY -= span; maxY += span;
  }
  const yPad = (maxY - minY) * 0.1;
  minY -= yPad; maxY += yPad;
  const cy = (v) => PT + (H - PT - PB) * (1 - (v - minY) / (maxY - minY));

  // y ticks
  const ticks = 5;
  let yLines = '';
  for (let i = 0; i <= ticks; i++) {
    const v = minY + (maxY - minY) * (i / ticks);
    const y = cy(v);
    yLines += `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="#e5e9ef" stroke-width="1"/>`;
    yLines += `<text class="yt" x="${PL-6}" y="${y+3}" text-anchor="end">${fmtMoney(v)}</text>`;
  }
  // x ticks
  let xLines = '';
  const xTicks = Math.min(8, currentDay + 1);
  for (let i = 0; i <= xTicks; i++) {
    const d = Math.round(currentDay * i / xTicks);
    const x = cx(d);
    xLines += `<text class="xt" x="${x}" y="${H-8}" text-anchor="middle">d${d}</text>`;
  }

  // Path
  const pts = filtered.map(p => `${cx(p.day)},${cy(p.cash)}`).join(' L ');
  // Zero line if applicable
  let zero = '';
  if (minY < 0 && maxY > 0) {
    const zy = cy(0);
    zero = `<line x1="${PL}" y1="${zy}" x2="${W-PR}" y2="${zy}" stroke="#cd3500" stroke-width="1.2" stroke-dasharray="4,3"/>`;
  }
  // current value
  const last = filtered[filtered.length - 1];
  const cashColor = last.cash >= 0 ? '#00875a' : '#cd3500';

  container.innerHTML = `
    <svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${yLines}
      ${zero}
      <path d="M ${pts}" fill="none" stroke="${cashColor}" stroke-width="2"/>
      <circle cx="${cx(last.day)}" cy="${cy(last.cash)}" r="3.5" fill="${cashColor}" stroke="#fff" stroke-width="1.5"/>
      <text class="annot" x="${cx(last.day)+8}" y="${cy(last.cash)+4}">${fmtMoney(last.cash)}</text>
      ${xLines}
    </svg>
  `;
}

function buildSubsChart(container, seatSeriesByGroup, currentDay) {
  const W = 1060, H = 240, PL = 70, PR = 110, PT = 12, PB = 28;
  // Build pivoted: day -> {group_id: count}
  const filtered = seatSeriesByGroup.filter(p => p.day <= currentDay);
  if (filtered.length === 0) {
    container.innerHTML = '<div style="color:#697386;font-size:11px;padding:8px;">No subscriber data yet.</div>';
    return;
  }
  // Get all groups
  const groupSet = new Set();
  const dayMap = new Map(); // day -> {gid: count}
  for (const p of filtered) {
    groupSet.add(p.group_id);
    if (!dayMap.has(p.day)) dayMap.set(p.day, {});
    dayMap.get(p.day)[p.group_id] = p.count;
  }
  // Sort groups: S then E then D_S then D_E
  const groupOrder = (g) => {
    if (g.startsWith('D_')) return (g.startsWith('D_S') ? 100 : 200) + parseInt(g.slice(3) || '0');
    if (g.startsWith('S')) return parseInt(g.slice(1) || '0');
    if (g.startsWith('E')) return 50 + parseInt(g.slice(1) || '0');
    return 999;
  };
  const groups = [...groupSet].sort((a, b) => groupOrder(a) - groupOrder(b));
  const days = [...dayMap.keys()].sort((a, b) => a - b);
  // Stack: per day, cumulative sum
  const stacked = days.map(d => {
    const counts = dayMap.get(d);
    let cum = 0;
    return { day: d, items: groups.map(g => {
      const c = counts[g] || 0;
      const item = { g, base: cum, top: cum + c, val: c };
      cum += c;
      return item;
    }), total: cum };
  });
  let maxY = 1;
  for (const s of stacked) if (s.total > maxY) maxY = s.total;
  const cx = (d) => PL + (W - PL - PR) * (d / Math.max(1, currentDay));
  const cy = (v) => PT + (H - PT - PB) * (1 - v / maxY);

  // Color map
  const baseColors = ['#2f6df6', '#ed5b2c', '#00875a', '#b15c00', '#cd3500', '#0c6fa6', '#b8326b', '#6b3fc8'];
  const colorMap = {};
  groups.forEach((g, i) => { colorMap[g] = baseColors[i % baseColors.length]; });

  // y ticks
  const ticks = 5;
  let yLines = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (maxY * i / ticks);
    const y = cy(v);
    yLines += `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="#e5e9ef" stroke-width="1"/>`;
    yLines += `<text class="yt" x="${PL-6}" y="${y+3}" text-anchor="end">${Math.round(v).toLocaleString()}</text>`;
  }
  // x ticks
  let xLines = '';
  const xTicks = Math.min(8, currentDay + 1);
  for (let i = 0; i <= xTicks; i++) {
    const d = Math.round(currentDay * i / xTicks);
    const x = cx(d);
    xLines += `<text class="xt" x="${x}" y="${H-8}" text-anchor="middle">d${d}</text>`;
  }

  // Stacked area: build per-group polygons (fill-between top and bottom)
  let polys = '';
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const top = stacked.map(s => s.items[gi].top);
    const base = stacked.map(s => s.items[gi].base);
    const xPath = stacked.map((s, i) => `${cx(s.day)},${cy(top[i])}`).join(' L ');
    const xPathRev = stacked.slice().reverse().map((s, i) => {
      const idx = stacked.length - 1 - i;
      return `${cx(s.day)},${cy(base[idx])}`;
    }).join(' L ');
    polys += `<path d="M ${xPath} L ${xPathRev} Z" fill="${colorMap[g]}" fill-opacity="0.7" stroke="${colorMap[g]}" stroke-width="0.6"/>`;
  }

  // Legend (right side, vertical)
  let legend = '';
  const lx = W - PR + 10;
  groups.forEach((g, i) => {
    const ly = PT + 6 + i * 15;
    if (ly > H - PB) return;
    legend += `<rect x="${lx}" y="${ly-7}" width="9" height="9" fill="${colorMap[g]}" fill-opacity="0.8" stroke="${colorMap[g]}"/>`;
    legend += `<text x="${lx+13}" y="${ly+1}" class="yt" style="fill:#0a2540;font-size:10px;">${escHTML(g)}</text>`;
  });

  container.innerHTML = `
    <svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${yLines}
      ${polys}
      ${xLines}
      ${legend}
    </svg>
  `;
}

// ---------- action rendering ----------
function suppressLong(s, maxLines = 60) {
  const lines = String(s).split('\n');
  if (lines.length <= maxLines) return s;
  const head = lines.slice(0, Math.floor(maxLines * 0.7)).join('\n');
  const tail = lines.slice(-Math.floor(maxLines * 0.3)).join('\n');
  const skipped = lines.length - maxLines;
  return head + '\n⋯ ' + skipped + '+ lines suppressed ⋯\n' + tail;
}

function renderAction(action, idx) {
  const tool = action.tool || 'unknown';
  const args = action.arguments || {};
  const result = action.result || '';
  const turn = action.turn || idx;
  let ts = '';
  if (action.timestamp) {
    let d = null;
    if (typeof action.timestamp === 'string') {
      d = new Date(action.timestamp);
    } else if (typeof action.timestamp === 'number') {
      d = new Date(action.timestamp > 1e12 ? action.timestamp : action.timestamp * 1000);
    }
    if (d && !isNaN(d.getTime())) ts = d.toISOString().slice(11, 19);
  }

  let headClass = '';
  let label = tool;
  let subtitle = '';
  let bodyHtml = '';

  // Bash-style execution: bash_agent's "bash", claude_code's "Bash", and
  // codex's "exec_command" all run a shell command and return its stdout.
  // Field names differ: bash_agent/claude_code use ``args.command``; codex
  // uses ``args.cmd`` plus extras (``workdir``, ``yield_time_ms``, ...).
  if (tool === 'bash' || tool === 'Bash' || tool === 'exec_command') {
    headClass = 'h-bash';
    label = (tool === 'exec_command') ? 'exec_command' : 'bash';
    const cmd = (args.command || args.cmd || '').toString();
    bodyHtml = `<pre class="code">${highlightShell(cmd)}</pre>`;
    // Optional metadata strip: description (claude_code), workdir (codex)
    const meta = [];
    if (args.description) meta.push(`# ${args.description}`);
    if (args.workdir) meta.push(`cwd: ${args.workdir}`);
    if (args.yield_time_ms) meta.push(`yield_time_ms=${args.yield_time_ms}`);
    if (args.max_output_tokens) meta.push(`max_output_tokens=${args.max_output_tokens}`);
    if (args.timeout) meta.push(`timeout=${args.timeout}`);
    if (args.run_in_background) meta.push('background');
    if (meta.length) subtitle = meta.join(' · ');
    if (result) {
      const trimmed = suppressLong(String(result), 80);
      bodyHtml += `<div class="stdout">${escHTML(trimmed)}</div>`;
    }
  } else if (tool === 'write_file' || tool === 'Write') {
    headClass = 'h-write';
    label = tool === 'Write' ? 'Write' : 'write_file';
    subtitle = args.path || args.file_path || '';
    const content = (args.content || '').toString();
    const isPython = (subtitle.endsWith('.py'));
    const isShell = (subtitle.endsWith('.sh'));
    const trimmed = suppressLong(content, 200);
    const html = isPython ? highlightPython(trimmed)
                : isShell ? highlightShell(trimmed)
                : escHTML(trimmed);
    bodyHtml = `<pre class="code">${html}</pre>`;
    if (result) bodyHtml += `<div class="stdout collapsed">${escHTML(String(result))}</div>`;
  } else if (tool === 'edit_file' || tool === 'Edit') {
    headClass = 'h-edit';
    label = tool === 'Edit' ? 'Edit' : 'edit_file';
    subtitle = args.path || args.file_path || '';
    const oldS = (args.old_string || '').toString();
    const newS = (args.new_string || '').toString();
    bodyHtml = `<div class="diff">${makeDiff(oldS, newS)}</div>`;
    if (result) bodyHtml += `<div class="stdout collapsed">${escHTML(String(result))}</div>`;
  } else if (tool === 'read_file' || tool === 'Read') {
    headClass = 'h-read';
    label = tool === 'Read' ? 'Read' : 'read_file';
    subtitle = args.path || args.file_path || '';
    const sub = [];
    if (args.offset) sub.push(`offset=${args.offset}`);
    if (args.limit) sub.push(`limit=${args.limit}`);
    if (sub.length) subtitle += ' (' + sub.join(', ') + ')';
    if (result) {
      const trimmed = suppressLong(String(result), 80);
      bodyHtml = `<div class="stdout">${escHTML(trimmed)}</div>`;
    }
  } else if (tool === 'search_files' || tool === 'glob_files' || tool === 'Grep' || tool === 'Glob') {
    headClass = 'h-search';
    label = tool;
    const parts = [];
    if (args.pattern) parts.push(`pattern=${JSON.stringify(args.pattern)}`);
    if (args.glob) parts.push(`glob=${JSON.stringify(args.glob)}`);
    if (args.path) parts.push(`path=${args.path}`);
    if (args.type) parts.push(`type=${args.type}`);
    if (args.output_mode) parts.push(`mode=${args.output_mode}`);
    subtitle = parts.join(' · ');
    if (result) {
      const trimmed = suppressLong(String(result), 60);
      bodyHtml = `<div class="stdout">${escHTML(trimmed)}</div>`;
    }
  } else if (tool === 'apply_patch') {
    // Codex's custom_tool: args is a unified-patch string. Render as diff
    // block (best-effort) and fall back to raw patch in a code block.
    headClass = 'h-edit';
    label = 'apply_patch';
    const patch = (args.input || args._raw || args.patch || JSON.stringify(args)).toString();
    bodyHtml = `<pre class="code diff-raw">${highlightDiff(patch)}</pre>`;
    if (result) bodyHtml += `<div class="stdout collapsed">${escHTML(String(result))}</div>`;
  } else if (tool === 'write_stdin') {
    // Codex tool: writes text into a running command's stdin.
    headClass = 'h-bash';
    label = 'write_stdin';
    const txt = (args.chars || args.text || args._raw || '').toString();
    if (args.session_id) subtitle = `session=${args.session_id}`;
    bodyHtml = `<pre class="code">${escHTML(suppressLong(txt, 60))}</pre>`;
    if (result) bodyHtml += `<div class="stdout collapsed">${escHTML(String(result))}</div>`;
  } else if (tool === '_dashboard') {
    headClass = 'h-dash';
    label = 'dashboard';
    subtitle = 'weekly KPI report';
    if (result) bodyHtml = `<div class="stdout">${escHTML(suppressLong(String(result), 100))}</div>`;
  } else if (tool === '_reasoning') {
    headClass = 'h-reason';
    label = 'reasoning';
    subtitle = 'agent thinking';
    const txt = (args && args.text) || result || '';
    bodyHtml = `<div style="font-size:12px;line-height:1.5;color:#425466;">${escHTML(suppressLong(String(txt), 60))}</div>`;
  } else {
    label = tool;
    subtitle = JSON.stringify(args).slice(0, 120);
    if (result) bodyHtml = `<div class="stdout">${escHTML(suppressLong(String(result), 60))}</div>`;
  }

  // Default-collapsed for verbose tools
  const defaultCollapsed = (tool === 'read_file');
  const collapsedCls = defaultCollapsed ? 'collapsed' : '';

  return `
    <div class="tile action ${collapsedCls}" data-idx="${idx}">
      <div class="head ${headClass}">
        <span class="panel-mark">${idx+1}</span>
        <span><b>${escHTML(label)}</b></span>
        ${subtitle ? `<span class="path">${escHTML(subtitle)}</span>` : ''}
        <span class="turn">turn ${turn}</span>
        <span class="ts">${ts}</span>
        <button class="toggle" onclick="toggleAction(${idx})" aria-label="toggle">${defaultCollapsed ? '▸' : '▾'}</button>
      </div>
      <div class="body">${bodyHtml || '<div style="color:#8792a2;font-size:11px;">(no output)</div>'}</div>
    </div>
  `;
}

// ---------- weekly artifact rendering ----------
const WEEK_CACHE = new Map();  // week# -> Promise<weekData>

function fetchWeek(runId, weekNum) {
  const key = `${runId}:${weekNum}`;
  if (WEEK_CACHE.has(key)) return WEEK_CACHE.get(key);
  const p = fetch(`data/runs/${runId}/week_${weekNum}.json`).then(r => r.json());
  WEEK_CACHE.set(key, p);
  return p;
}

function renderWeekFile(file, idx) {
  const path = file.path;
  const status = file.status;
  const isPython = path.endsWith('.py');
  const isShell = path.endsWith('.sh');
  let body = '';
  if (file.binary) {
    body = `<div class="stdout">[binary file — content not shown]</div>`;
  } else if (status === 'D') {
    body = `<div class="stdout">[deleted]</div>`;
  } else if (status === 'A' && file.content !== undefined) {
    const c = suppressLong(file.content || '', 200);
    const html = isPython ? highlightPython(c) : isShell ? highlightShell(c) : escHTML(c);
    body = `<pre class="code">${html}</pre>`;
  } else if (file.diff !== undefined) {
    // file.diff is a unified diff string from `git diff --unified=2`
    const c = suppressLong(file.diff || '', 200);
    const lines = c.split('\n').map(l => {
      let cls = 'ctx';
      if (l.startsWith('+++') || l.startsWith('---')) cls = 'hunk';
      else if (l.startsWith('@@')) cls = 'hunk';
      else if (l.startsWith('+')) cls = 'plus';
      else if (l.startsWith('-')) cls = 'minus';
      return `<div class="row-line ${cls}">${escHTML(l)}</div>`;
    }).join('');
    body = `<div class="diff">${lines}</div>`;
  } else {
    body = `<div class="stdout">(no content)</div>`;
  }
  const statusLabel = status === 'A' ? 'added' : status === 'M' ? 'modified' : status === 'D' ? 'deleted' : status;
  const headClass = status === 'A' ? 'h-write' : status === 'D' ? 'h-edit' : 'h-edit';
  return `
    <div class="tile action collapsed" data-idx="wk-${idx}">
      <div class="head ${headClass}">
        <span class="panel-mark">${idx+1}</span>
        <span><b>${escHTML(statusLabel)}</b></span>
        <span class="path">${escHTML(path)}</span>
        <button class="toggle" onclick="toggleAction('wk-${idx}')" aria-label="toggle">▸</button>
      </div>
      <div class="body">${body}</div>
    </div>
  `;
}

function renderWeekTile(weekRow) {
  // weekRow: {week, day, hash, file_count, size_bytes}
  const id = `week-tile-${weekRow.week}`;
  return `
    <div class="tile action collapsed" id="${id}" data-week="${weekRow.week}">
      <div class="head" style="background:#0c6fa6;color:#fff;">
        <span class="panel-mark" style="background:#fff;color:#0c6fa6;">W</span>
        <span><b>Week ${weekRow.week} artifacts</b></span>
        <span class="path">commit ${escHTML(weekRow.hash)} · ${weekRow.file_count} files · ${(weekRow.size_bytes/1024).toFixed(0)}KB</span>
        <button class="toggle" onclick="toggleWeek(${weekRow.week})" aria-label="toggle">▸</button>
      </div>
      <div class="body" id="${id}-body">
        <div style="color:#697386;font-size:11px;padding:6px;">Click ▸ to load.</div>
      </div>
    </div>
  `;
}

window.toggleAction = function(idx) {
  const el = document.querySelector(`.action[data-idx="${idx}"]`);
  if (!el) return;
  el.classList.toggle('collapsed');
  const btn = el.querySelector('.toggle');
  if (btn) btn.textContent = el.classList.contains('collapsed') ? '▸' : '▾';
};

window.toggleWeek = async function(weekNum) {
  const tile = document.getElementById(`week-tile-${weekNum}`);
  if (!tile) return;
  const willOpen = tile.classList.contains('collapsed');
  tile.classList.toggle('collapsed');
  const btn = tile.querySelector('.toggle');
  if (btn) btn.textContent = tile.classList.contains('collapsed') ? '▸' : '▾';
  if (willOpen) {
    const body = document.getElementById(`week-tile-${weekNum}-body`);
    if (body && body.dataset.loaded !== '1') {
      body.innerHTML = `<div style="color:#697386;font-size:11px;padding:6px;">Loading week ${weekNum}…</div>`;
      try {
        const data = await fetchWeek(STATE.run.run_id, weekNum);
        const html = (data.files || []).map((f, i) => renderWeekFile(f, i)).join('');
        body.innerHTML = html || '<div style="color:#697386;font-size:11px;padding:6px;">(no files)</div>';
        body.dataset.loaded = '1';
      } catch (e) {
        body.innerHTML = `<div style="color:#cd3500;font-size:11px;padding:6px;">Failed to load week ${weekNum}: ${escHTML(e.message)}</div>`;
      }
    }
  }
};

// ---------- main day render ----------
function renderDay(idx) {
  const day = STATE.daysList[idx];
  const dayData = STATE.run.days[String(day)];
  STATE.currentDayIdx = idx;
  // Update day-nav
  document.getElementById('day-select').value = String(idx);
  document.getElementById('prev-day').disabled = (idx === 0);
  document.getElementById('next-day').disabled = (idx === STATE.daysList.length - 1);

  // Day-specific cash/subs
  let cash = 0;
  for (const p of STATE.run.cash_series) { if (p.day <= day) cash = p.cash; else break; }
  let subs = 0;
  for (const p of STATE.run.sub_series) { if (p.day <= day) subs = p.subscribers; else break; }
  document.getElementById('day-cash').textContent = fmtMoney(cash);
  document.getElementById('day-subs').textContent = fmtInt(subs);
  document.getElementById('day-actions').textContent = (dayData && dayData.actions ? dayData.actions.length : 0);

  // Charts
  buildCashChart(document.getElementById('cash-body'), STATE.run.cash_series, day);
  buildSubsChart(document.getElementById('subs-body'), STATE.run.seat_series_by_group, day);

  // Day content
  const container = document.getElementById('day-content');
  let html = `<div class="day-section">`;
  html += `<h2 style="font-size:16px;margin:0 0 8px 0;font-weight:800;">Day ${day} <span style="color:#8792a2;font-size:12px;font-weight:500;">· ${dayData ? dayData.actions.length : 0} actions</span></h2>`;
  if (dayData && dayData.rationale) {
    html += `<div class="day-rationale"><span class="lbl">Weekly rationale</span>${escHTML(dayData.rationale)}</div>`;
  }
  // Find the weekly commit (if any) whose day matches this day.
  const weeksIndex = STATE.run.weeks_index || [];
  const weekRow = weeksIndex.find(w => w.day === day);
  if (weekRow) {
    html += renderWeekTile(weekRow);
  }
  if (dayData && dayData.actions && dayData.actions.length > 0) {
    for (let i = 0; i < dayData.actions.length; i++) {
      html += renderAction(dayData.actions[i], i);
    }
  } else if (!weekRow) {
    html += `<div style="color:#8792a2;padding:12px;">No actions for this day.</div>`;
  }
  html += `</div>`;
  container.innerHTML = html;
  window.scrollTo({top: 0, behavior: 'smooth'});
}

// ---------- init ----------
async function init() {
  const params = new URLSearchParams(window.location.search);
  const runId = params.get('run');
  if (!runId) {
    document.getElementById('run-sub').textContent = 'No run id given. Go back to index.';
    return;
  }
  const runIdMeta = document.getElementById('run-id-meta');
  if (runIdMeta) runIdMeta.textContent = runId;
  document.getElementById('run-footer-id').textContent = runId;
  document.getElementById('run-footer-stamp').textContent = new Date().toISOString().slice(0, 10);
  let r;
  try {
    r = await (await fetch(`data/runs/${runId}.json`)).json();
  } catch (e) {
    document.getElementById('run-sub').textContent = 'Failed to load run: ' + e.message;
    return;
  }
  STATE.run = r;
  STATE.daysList = r.days_list || [];

  document.getElementById('model-name').textContent = r.model_display || r.model;
  const subParts = [];
  subParts.push(`<b>${r.label || ''}</b>`);
  subParts.push(`run <code>${runId}</code>`);
  const survival = r.survival_days ?? (r.bankrupt ? (r.current_day || 0) : 500);
  if (r.bankrupt) {
    subParts.push(`<span style="background:#cd3500;color:#fff;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.08em;padding:2px 6px;border-radius:3px;">BANKRUPTED</span>`);
    subParts.push(`survived <b>${survival}d</b>`);
  } else {
    subParts.push(`survived <b>${survival}d</b>`);
    subParts.push(`final cash <b>${fmtMoney(r.cash)}</b>`);
  }
  subParts.push(`${r.action_count} actions over ${r.days_list.length}-week entries`);
  subParts.push(`subs <b>${fmtInt(r.subscribers)}</b>`);
  if (r.founder_dividends) subParts.push(`dividends <b>${fmtMoney(r.founder_dividends)}</b>`);
  document.getElementById('run-sub').innerHTML = subParts.join(' · ');

  // Day select
  const sel = document.getElementById('day-select');
  const weekByDay = new Map();
  for (const w of (r.weeks_index || [])) weekByDay.set(w.day, w.week);
  for (let i = 0; i < STATE.daysList.length; i++) {
    const d = STATE.daysList[i];
    const acts = (r.days[String(d)] && r.days[String(d)].actions) ? r.days[String(d)].actions.length : 0;
    const wk = weekByDay.get(d);
    const opt = document.createElement('option');
    opt.value = String(i);
    const wkTag = wk !== undefined ? ` ★W${wk}` : '';
    opt.textContent = `Day ${d} (${acts})${wkTag}`;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => renderDay(parseInt(sel.value)));
  document.getElementById('prev-day').addEventListener('click', () => {
    if (STATE.currentDayIdx > 0) renderDay(STATE.currentDayIdx - 1);
  });
  document.getElementById('next-day').addEventListener('click', () => {
    if (STATE.currentDayIdx < STATE.daysList.length - 1) renderDay(STATE.currentDayIdx + 1);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowLeft' && STATE.currentDayIdx > 0) renderDay(STATE.currentDayIdx - 1);
    if (e.key === 'ArrowRight' && STATE.currentDayIdx < STATE.daysList.length - 1) renderDay(STATE.currentDayIdx + 1);
  });

  if (STATE.daysList.length > 0) {
    renderDay(0);
  } else {
    document.getElementById('day-content').textContent = 'No days with data.';
  }
}

init();
