const SVG_NS = "http://www.w3.org/2000/svg";

const MODEL_COLORS = {
"Claude Fable 5.2": "#3b0764",
"GPT-6.2 Astra": "#3b82f6",
"GPT-6.1 Sol": "#34a36b",
"GPT-6.2 Sol": "#0b4f2f",
"Gemini 4 Neon": "#e11d74",
"Gemini 4 Carbon": "#7c4a1e",
"Claude Fable 5.1": "#702da5",
"Gemini 4 Argon": "#c5221f",
"Gemini 3.8 Flash": "#7cb342",
"GPT-6 Sol": "#176f45",
"Claude Opus 5.5": "#c44500",
"GPT-6 Astra": "#0959b0",
  "Claude Fable 5": "#111827",
  "GPT-5.6 Sol": "#0072b2",
  "Claude Opus 4.8": "#d55e00",
  "Qwen 3.7 Max": "#8a63d2",
  "Grok 4.6": "#a16207",
  "Gemini 3.5 Flash": "#2f6df6",
  "Claude Opus 4.7": "#cc79a7",
  "Claude Sonnet 5": "#009e73",
  "Claude Haiku 4.5": "#0c6fa6",
  "GLM 5.2": "#7c2d6f",
  "Kimi K2.6": "#b15c00",
  "Claude Sonnet 4.6": "#00875a",
  "GPT-5.5": "#e69f00",
  "Grok 4.5": "#0097a7",
  "GLM 5.1": "#b8326b",
  "DeepSeek V4 Pro": "#0a2540",
  "Gemini 3 Flash": "#697386",
  "Kimi K3": "#3f8f8f",
  "Grok 4.20": "#6b3fc8",
  "Rule-Based Baseline": "#6b6b6b"
};

function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  if (parent) parent.appendChild(node);
  return node;
}

function formatCash(value) {
  if (value == null || Number.isNaN(value)) return "ended";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatAxisCash(value) {
  if (value >= 1e9) return `$${value / 1e9}B`;
  if (value >= 1e6) return `$${value / 1e6}M`;
  if (value >= 1e3) return `$${value / 1e3}k`;
  return `$${value}`;
}

function appendModelName(node, name) {
  node.textContent = name;
}

function modelNameHtml(name) {
  return name;
}

function valueAtDay(points, day) {
  if (!points.length || day < points[0][0] || day > points[points.length - 1][0]) {
    return null;
  }

  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid][0] === day) return points[mid][1];
    if (points[mid][0] < day) lo = mid + 1;
    else hi = mid - 1;
  }

  const left = points[Math.max(0, hi)];
  const right = points[Math.min(points.length - 1, lo)];
  if (!left || !right || left[0] === right[0]) return left ? left[1] : null;
  const t = (day - left[0]) / (right[0] - left[0]);
  return left[1] + t * (right[1] - left[1]);
}

// Ranking uses each model's mean day-500 cash across its games (bankrupt games count as $0).
function rankValue(run) {
  return Number.isFinite(run.mean_cash) ? run.mean_cash : (Number(run.final_cash) || 0);
}

function compareRuns(a, b) {
  const delta = rankValue(b) - rankValue(a);
  return delta || modelNameHtml(a.pretty).localeCompare(modelNameHtml(b.pretty));
}

// All of a model's games (from the per-model figure data), for the hover view.
function modelTrajectories(run) {
  const byModel = typeof RUNS_BY_MODEL === "object" && RUNS_BY_MODEL ? RUNS_BY_MODEL : {};
  return (byModel[run.pretty] || []).filter(game => Array.isArray(game.points) && game.points.length);
}

// A round step (1, 2, 2.5 or 5 × 10^n) of at least `raw`.
function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw);
}

function formatLinearTick(value) {
  if (value === 0) return "$0";
  if (value >= 1e9) return `$${Number((value / 1e9).toFixed(2))}B`;
  if (value >= 1e6) return `$${Number((value / 1e6).toFixed(1))}M`;
  if (value >= 1e3) return `$${Number((value / 1e3).toFixed(1))}k`;
  return `$${value}`;
}

function drawCashPlot(runs, mount, scale = "log") {
  const linear = scale === "linear";
  if (!mount) return;
  const legend = document.getElementById(mount.dataset.legendId || "cash-legend");
  const rankedRuns = runs.slice().sort(compareRuns);

  mount.innerHTML = "";
  if (legend) {
    legend.innerHTML = "";
    legend.hidden = true;
  }

  // Plot on the left, ranked list on the right; the list matches the plot height and scrolls on overflow.
  const layout = document.createElement("div");
  layout.className = "cash-plot-layout";
  mount.appendChild(layout);
  const plotBox = document.createElement("div");
  plotBox.className = "cash-plot-area";
  layout.appendChild(plotBox);
  const listBox = document.createElement("div");
  listBox.className = "cash-rank-list";
  layout.appendChild(listBox);

  const W = 760;
  const H = 600;
  const pad = { left: 74, right: 18, top: 26, bottom: 58 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const plotRight = pad.left + innerW;
  const xMin = 0;
  const xMax = 500;

  // The y range fits the curves shown (with a little headroom; at least two decades, floor $100).
  const shownValues = rankedRuns.flatMap(run => run.points.map(point => point[1]).filter(v => v > 0));
  const maxCash = Math.max(...shownValues, 1);
  const minCash = Math.min(...shownValues, maxCash);
  const yMaxLog = Math.log10(maxCash) + 0.12;
  const yMinLog = Math.min(Math.max(2, Math.log10(minCash) - 0.12), yMaxLog - 2);
  const yFloor = Math.pow(10, yMinLog);
  const yCeil = Math.pow(10, yMaxLog);
  // Linear option: $0 up to a rounded value just above the highest curve shown.
  const linStep = niceStep(maxCash * 1.04 / 5);
  const linMax = Math.ceil(maxCash * 1.04 / linStep) * linStep;

  const x = value => pad.left + ((value - xMin) / (xMax - xMin)) * innerW;
  const y = value => {
    if (linear) return pad.top + innerH - (Math.min(linMax, Math.max(0, value)) / linMax) * innerH;
    if (value <= 0) return pad.top + innerH;
    const safe = Math.min(yCeil, Math.max(yFloor, value));
    return pad.top + innerH - ((Math.log10(safe) - yMinLog) / (yMaxLog - yMinLog)) * innerH;
  };
  const invX = value => xMin + ((value - pad.left) / innerW) * (xMax - xMin);
  const pathFor = points => points
    .filter(([day]) => day <= xMax)
    .map(([day, cash], index) => `${index === 0 ? "M" : "L"} ${x(day).toFixed(2)} ${y(cash).toFixed(2)}`)
    .join(" ");

  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Cash on hand by day for each model's best run"
  }, plotBox);

  const tickStyle = { "font-family": "Inter, sans-serif", "font-size": "12", "font-weight": "400", fill: "#000000" };
  const labelStyle = { "font-family": "Inter, sans-serif", "font-size": "13", "font-weight": "400", fill: "#000000" };

  const yTicks = linear
    ? Array.from({ length: Math.round(linMax / linStep) + 1 }, (_, i) => i * linStep)
    : Array.from({ length: Math.floor(yMaxLog + 1e-9) - Math.ceil(yMinLog - 1e-9) + 1 }, (_, i) => Math.pow(10, Math.ceil(yMinLog - 1e-9) + i));
  for (const tick of yTicks) {
    const yy = y(tick);
    svgEl("line", {
      x1: pad.left, x2: plotRight, y1: yy, y2: yy,
      stroke: tick === 1000000 ? "#b7c2d0" : "#e5eaf0",
      "stroke-width": "0.9",
      "stroke-dasharray": tick === 1000000 ? "5 4" : "2 5"
    }, svg);
    svgEl("text", { x: pad.left - 8, y: yy + 4, "text-anchor": "end", ...tickStyle }, svg).textContent = linear ? formatLinearTick(tick) : formatAxisCash(tick);
  }

  [0, 100, 200, 300, 400, 500].forEach(tick => {
    const xx = x(tick);
    svgEl("line", { x1: xx, x2: xx, y1: pad.top, y2: pad.top + innerH, stroke: "#f0f3f7", "stroke-width": "0.8" }, svg);
    svgEl("line", { x1: xx, x2: xx, y1: pad.top + innerH, y2: pad.top + innerH + 5, stroke: "#0a2540", "stroke-width": "1" }, svg);
    svgEl("text", { x: xx, y: H - 27, "text-anchor": "middle", ...tickStyle }, svg).textContent = String(tick);
  });

  svgEl("line", { x1: pad.left, x2: pad.left, y1: pad.top - 3, y2: pad.top + innerH + 2, stroke: "#0a2540", "stroke-width": "1.3" }, svg);
  svgEl("line", { x1: pad.left - 3, x2: plotRight + 2, y1: pad.top + innerH, y2: pad.top + innerH, stroke: "#0a2540", "stroke-width": "1.3" }, svg);

  if (!linear && 1000000 >= yFloor && 1000000 <= yCeil) {
    const startY = y(1000000);
    svgEl("line", {
      x1: pad.left, x2: plotRight, y1: startY, y2: startY,
      stroke: "#0a2540", "stroke-width": "1", "stroke-dasharray": "5 4", opacity: "0.55"
    }, svg);
    svgEl("text", {
      x: plotRight - 8, y: startY - 8, "text-anchor": "end",
      "font-family": "Inter, sans-serif", "font-size": "12", "font-weight": "400", fill: "#000000"
    }, svg).textContent = "$1M starting cash balance";
  }

  svgEl("text", { x: pad.left + innerW / 2, y: H - 8, "text-anchor": "middle", ...labelStyle }, svg).textContent = "Day";
  svgEl("text", {
    x: -(pad.top + innerH / 2), y: 17, transform: "rotate(-90)", "text-anchor": "middle", ...labelStyle
  }, svg).textContent = linear ? "Cash on hand (USD)" : "Cash on hand (USD, log)";

  const lineGroup = svgEl("g", {}, svg);
  const runElements = new Map();
  rankedRuns.slice().reverse().forEach(run => {
    const color = MODEL_COLORS[run.pretty] || "#0a2540";
    const rank = rankedRuns.indexOf(run);
    const baseStrokeWidth = rank < 3 ? "3" : "2.1";
    const baseOpacity = rank < 3 ? "0.98" : "0.72";
    const path = svgEl("path", {
      d: pathFor(run.points),
      fill: "none",
      stroke: color,
      "stroke-width": baseStrokeWidth,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      opacity: baseOpacity
    }, lineGroup);
    const last = run.points[run.points.length - 1];
    let dot = null;
    if (!run.bankrupt) {
      dot = svgEl("circle", { cx: x(last[0]), cy: y(last[1]), r: "4.6", fill: color, stroke: color, "stroke-width": "2" }, lineGroup);
    }
    runElements.set(run, { path, dot, color, baseStrokeWidth, baseOpacity });
  });
  // Drawn on hover: the hovered model's games, above the greyed-out curves.
  const focusGroup = svgEl("g", { "aria-hidden": "true" }, svg);

  const greyStroke = "#c3c9d2";
  function setCurveHighlight(activeRun) {
    focusGroup.innerHTML = "";
    listBox.querySelectorAll(".cash-rank-row").forEach(row => row.classList.toggle("active", row.runRef === activeRun));
    const games = activeRun ? modelTrajectories(activeRun) : [];
    runElements.forEach(({ path, dot, color, baseStrokeWidth, baseOpacity }, run) => {
      const isActive = run === activeRun;
      if (!activeRun) {
        path.setAttribute("stroke", color);
        path.setAttribute("stroke-width", baseStrokeWidth);
        path.setAttribute("opacity", baseOpacity);
        if (dot) { dot.setAttribute("fill", color); dot.setAttribute("stroke", color); dot.setAttribute("opacity", "1"); }
        return;
      }
      // With per-game data, every curve (including the hovered model's best) is greyed and its games are redrawn on top.
      if (isActive && !games.length) {
        path.setAttribute("stroke", color);
        path.setAttribute("stroke-width", "4.6");
        path.setAttribute("opacity", "1");
        lineGroup.appendChild(path);
        return;
      }
      path.setAttribute("stroke", greyStroke);
      path.setAttribute("stroke-width", "1.6");
      path.setAttribute("opacity", "0.55");
      if (dot) { dot.setAttribute("fill", greyStroke); dot.setAttribute("stroke", greyStroke); dot.setAttribute("opacity", "0.55"); }
    });
    if (!games.length) return;
    const color = MODEL_COLORS[activeRun.pretty] || "#0a2540";
    games.forEach(game => {
      const pts = game.points.filter(([day]) => day <= xMax);
      if (!pts.length) return;
      svgEl("path", {
        d: pathFor(pts), fill: "none", stroke: color, "stroke-width": "2.6",
        "stroke-linecap": "round", "stroke-linejoin": "round", opacity: "0.95"
      }, focusGroup);
      const end = pts[pts.length - 1];
      if (end[1] > 0) svgEl("circle", { cx: x(end[0]), cy: y(end[1]), r: "4", fill: color, stroke: "#ffffff", "stroke-width": "1.4" }, focusGroup);
    });
  }

  // Ranked list (by mean): rank, model, best run, mean.
  const head = document.createElement("div");
  head.className = "cash-rank-head";
  head.innerHTML = '<span class="cash-rank-num">#</span><span class="cash-rank-name">Model</span><span class="cash-rank-value">Best</span><span class="cash-rank-value">Mean</span>';
  const scroll = document.createElement("div");
  scroll.className = "cash-rank-scroll";
  scroll.appendChild(head);
  rankedRuns.forEach((run, index) => {
    const last = run.points[run.points.length - 1];
    const row = document.createElement("div");
    row.className = "cash-rank-row";
    row.runRef = run;
    const color = MODEL_COLORS[run.pretty] || "#0a2540";
    const cells = [
      ["cash-rank-num", String(index + 1)],
      ["cash-rank-name", run.pretty],
      ["cash-rank-value", run.bankrupt ? "Bankrupted" : formatCash(last[1])],
      ["cash-rank-value cash-rank-mean", formatCash(Math.max(0, rankValue(run)))]
    ];
    cells.forEach(([cls, text]) => {
      const span = document.createElement("span");
      span.className = cls;
      span.textContent = text;
      if (cls === "cash-rank-name") span.style.color = color;
      row.appendChild(span);
    });
    row.addEventListener("pointerenter", () => setCurveHighlight(run));
    row.addEventListener("focus", () => setCurveHighlight(run));
    row.tabIndex = 0;
    scroll.appendChild(row);
  });
  scroll.addEventListener("pointerleave", () => setCurveHighlight(null));
  scroll.addEventListener("focusout", () => setCurveHighlight(null));
  listBox.appendChild(scroll);

  const hoverGroup = svgEl("g", { opacity: "0" }, svg);
  const hoverLine = svgEl("line", {
    y1: pad.top, y2: pad.top + innerH, stroke: "#0a2540", "stroke-width": "1", "stroke-dasharray": "3 3", opacity: "0.75"
  }, hoverGroup);
  const hoverDots = svgEl("g", {}, hoverGroup);

  const tooltip = document.createElement("div");
  tooltip.className = "plot-tooltip";
  mount.appendChild(tooltip);

  function clearTooltip() {
    hoverGroup.setAttribute("opacity", "0");
    tooltip.classList.remove("visible");
  }

  function updateTooltip(event) {
    const svgRect = svg.getBoundingClientRect();
    const mountRect = mount.getBoundingClientRect();
    const sx = W / svgRect.width;
    const rawX = (event.clientX - svgRect.left) * sx;
    if (rawX < pad.left || rawX > plotRight) {
      clearTooltip();
      return;
    }
    const day = Math.max(xMin, Math.min(xMax, Math.round(invX(rawX))));
    const xx = x(day);
    hoverGroup.setAttribute("opacity", "1");
    hoverLine.setAttribute("x1", xx);
    hoverLine.setAttribute("x2", xx);
    hoverDots.innerHTML = "";

    const values = rankedRuns.map(run => ({
      name: run.pretty,
      color: MODEL_COLORS[run.pretty] || "#0a2540",
      value: valueAtDay(run.points, day)
    })).filter(item => item.value !== null);
    values.forEach(item => {
      svgEl("circle", { cx: xx, cy: y(item.value), r: "3.6", fill: item.color, stroke: "#ffffff", "stroke-width": "1.4" }, hoverDots);
    });
    values.sort((a, b) => b.value - a.value);
    tooltip.innerHTML = `
      <div class="tooltip-day">Day ${day}</div>
      ${values.map(item => `
        <div class="tooltip-row">
          <span class="tooltip-dot" style="background:${item.color}"></span>
          <span class="tooltip-name">${modelNameHtml(item.name)}</span>
          <span class="tooltip-value">${formatCash(item.value)}</span>
        </div>
      `).join("")}
    `;

    const edgeGap = 10;
    const selectionGap = 16;
    const selectedX = svgRect.left - mountRect.left + (xx / W) * svgRect.width;
    const maxLeft = Math.max(edgeGap, mountRect.width - tooltip.offsetWidth - edgeGap);
    const rightLeft = selectedX + selectionGap;
    const leftLeft = selectedX - tooltip.offsetWidth - selectionGap;
    let left = rightLeft <= maxLeft ? rightLeft : leftLeft;
    let top = 18;
    if (left < edgeGap) left = rightLeft <= maxLeft ? rightLeft : edgeGap;
    if (left < selectedX && selectedX < left + tooltip.offsetWidth) {
      top = svgRect.height + selectionGap;
      left = Math.max(edgeGap, Math.min(selectedX - tooltip.offsetWidth / 2, maxLeft));
    }
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.classList.add("visible");
  }

  svg.addEventListener("pointermove", updateTooltip);
  svg.addEventListener("pointerenter", updateTooltip);
  svg.addEventListener("pointerleave", clearTooltip);
}

function fitFrame(frame) {
  const wrap = frame.closest(".frame-wrap");
  const baseW = Number(frame.dataset.width);
  let baseH = Number(frame.dataset.height);
  if (!wrap || !baseW || !baseH) return;

  if (frame.dataset.autoHeight === "true") {
    try {
      const frameDocument = frame.contentDocument;
      const contentRoot = frameDocument && frameDocument.querySelector(".page");
      const contentBottom = contentRoot ? contentRoot.getBoundingClientRect().bottom : 0;
      const contentHeight = Math.max(
        contentBottom,
        frameDocument && frameDocument.body ? frameDocument.body.scrollHeight : 0,
        frameDocument && frameDocument.documentElement ? frameDocument.documentElement.scrollHeight : 0
      );
      baseH = Math.max(baseH, Math.ceil(contentHeight));
    } catch (_) {
      // Keep the declared height if the frame document cannot be measured.
    }
  }

  const available = wrap.clientWidth;
  if (available <= 0) return;
  const scale = Math.min(1.3, available / baseW);
  const renderedW = baseW * scale;
  frame.style.width = `${baseW}px`;
  frame.style.height = `${baseH}px`;
  frame.style.transform = `scale(${scale})`;
  frame.style.marginLeft = `${Math.max(0, (available - renderedW) / 2)}px`;
  wrap.style.height = `${Math.ceil(baseH * scale)}px`;
}

function fitAllFrames() {
  document.querySelectorAll(".frame-wrap iframe").forEach(fitFrame);
}

function orderRuns(runs) {
  return runs.slice().sort(compareRuns);
}

function parseBaselineCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().split(",");
  const dayIdx = header.indexOf("day");
  const cashIdx = header.indexOf("cash");
  if (dayIdx === -1 || cashIdx === -1) {
    throw new Error("baseline CSV must include day and cash columns");
  }
  return lines
    .map(line => {
      const cols = line.split(",");
      return [Number(cols[dayIdx]), Number(cols[cashIdx])];
    })
    .filter(([day, cash]) => Number.isFinite(day) && Number.isFinite(cash))
    .sort((a, b) => a[0] - b[0]);
}

function baselineRun(points) {
  if (!points.length) return null;
  const finalPoint = points[points.length - 1];
  return {
    model: "rule-based-baseline",
    pretty: "Rule-Based Baseline",
    bankrupt: 0,
    max_day: finalPoint[0],
    final_cash: finalPoint[1],
    points
  };
}

const TOP_MODEL_CHOICES = [5, 10, Infinity];
const DEFAULT_TOP_MODELS = 10;

// Minimal top-N selector over all entries ranked by mean; the rule-based baseline is ranked like any model.
function mountTopModelsControl(orderedRuns, mount) {
  const models = orderedRuns;
  const control = document.createElement("div");
  control.className = "top-models-control";
  control.setAttribute("role", "group");
  control.setAttribute("aria-label", "Models shown");
  const label = document.createElement("span");
  label.className = "top-models-label";
  label.textContent = "Show";
  control.appendChild(label);
  let currentLimit = models.length > DEFAULT_TOP_MODELS ? DEFAULT_TOP_MODELS : Infinity;
  let currentScale = "log";
  const draw = (limit = currentLimit, scale = currentScale) => {
    currentLimit = limit; currentScale = scale;
    drawCashPlot(models.slice(0, limit), mount, scale);
    control.querySelectorAll("button[data-limit]").forEach(button => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.limit) === limit));
    });
    control.querySelectorAll("button[data-scale]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.scale === scale));
    });
  };
  TOP_MODEL_CHOICES.filter(n => n === Infinity || n < models.length).forEach(limit => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.limit = String(limit);
    button.textContent = limit === Infinity ? "All" : `Top ${limit}`;
    button.addEventListener("click", () => draw(limit));
    control.appendChild(button);
  });
  const scaleLabel = document.createElement("span");
  scaleLabel.className = "top-models-label scale-label";
  scaleLabel.textContent = "Scale";
  control.appendChild(scaleLabel);
  [["log", "Log"], ["linear", "Linear"]].forEach(([scale, text]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.scale = scale;
    button.textContent = text;
    button.addEventListener("click", () => draw(currentLimit, scale));
    control.appendChild(button);
  });
  mount.parentNode.insertBefore(control, mount);
  // Open on the top 10 models (by mean cash) on a log scale.
  draw();
}

async function loadBaselineRun() {
  const response = await fetch("assets/rule_based_baseline_day_vs_cash.csv");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return baselineRun(parseBaselineCsv(await response.text()));
}

async function loadCashRuns() {
  const runs = Array.isArray(window.CEOBENCH_RUNS)
    ? window.CEOBENCH_RUNS
    : await (async () => {
        const response = await fetch("assets/runs.json");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })();

  const baseline = await loadBaselineRun();
  const stats = await loadModelStatistics();
  const withMeans = runs.map(run => {
    const mean = stats.get(run.pretty);
    return Number.isFinite(mean) ? { ...run, mean_cash: mean } : run;
  });
  return baseline ? withMeans.concat(baseline) : withMeans;
}

// Mean day-500 cash per model (bankrupt games count as $0); missing stats fall back to the best run.
async function loadModelStatistics() {
  try {
    const response = await fetch("assets/model-statistics.json");
    if (!response.ok) return new Map();
    const rows = await response.json();
    return new Map(rows.map(row => [row.model, Number(row.mean)]));
  } catch (_) {
    return new Map();
  }
}

const cashPlotMounts = Array.from(document.querySelectorAll(".cash-plot[data-cash-plot='best']"));
if (cashPlotMounts.length) {
  loadCashRuns()
    .then(runs => {
      const orderedRuns = orderRuns(runs);
      cashPlotMounts.forEach(mount => mountTopModelsControl(orderedRuns, mount));
    })
    .catch(error => {
      cashPlotMounts.forEach(mount => {
        mount.innerHTML = `<div class="plot-error">Could not load cash data: ${error.message}</div>`;
      });
    });
}

window.addEventListener("load", () => {
  fitAllFrames();
});
window.addEventListener("resize", () => {
  fitAllFrames();
});
document.querySelectorAll("details").forEach(details => {
  details.addEventListener("toggle", () => {
    fitAllFrames();
    if (details.open && window.MathJax && typeof window.MathJax.typesetPromise === "function") {
      window.MathJax.typesetPromise([details]).catch(() => {});
    }
  });
});
document.querySelectorAll(".frame-wrap iframe").forEach(frame => {
  frame.addEventListener("load", () => {
    fitFrame(frame);
    if (frame.dataset.autoHeight !== "true") return;

    try {
      const fonts = frame.contentDocument && frame.contentDocument.fonts;
      if (fonts && fonts.ready) fonts.ready.then(() => fitFrame(frame));
    } catch (_) {
      // The initial measurement remains a safe fallback.
    }
  });
});
