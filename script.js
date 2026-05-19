const SVG_NS = "http://www.w3.org/2000/svg";

const MODEL_COLORS = {
  "GPT-5.5": "#2f6df6",
  "Claude Opus 4.7": "#ed5b2c",
  "Claude Sonnet 4.6": "#00875a",
  "Kimi K2.6": "#b15c00",
  "GLM 5.1": "#b8326b",
  "Claude Haiku 4.5": "#0c6fa6",
  "Gemini 3 Flash": "#697386",
  "DeepSeek V4 Pro": "#0a2540",
  "Grok 4.20": "#6b3fc8"
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

function drawBankruptcyMarker(parent, cx, cy, label) {
  const group = svgEl("g", {
    "aria-label": label,
    role: "img"
  }, parent);
  const title = svgEl("title", {}, group);
  title.textContent = label;

  const marker = svgEl("text", {
    x: cx,
    y: cy + 4,
    "text-anchor": "middle",
    "font-size": "14",
    "font-family": "\"Apple Color Emoji\",\"Segoe UI Emoji\",\"Noto Color Emoji\",sans-serif"
  }, group);
  marker.textContent = "☠️";
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

function drawCashPlot(runs) {
  const mount = document.getElementById("cash-plot");
  const legend = document.getElementById("cash-legend");
  if (!mount || !legend) return;

  mount.innerHTML = "";
  legend.innerHTML = "";
  legend.hidden = true;

  const W = 960;
  const H = 430;
  const pad = { left: 78, right: 28, top: 18, bottom: 58 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const xMin = 0;
  const xMax = 500;
  const yFloor = 100;
  const maxCash = Math.max(...runs.flatMap(run => run.points.map(point => point[1]).filter(v => v > 0)));
  const yCeil = Math.pow(10, Math.ceil(Math.log10(Math.max(maxCash, 1e7))));
  const yMinLog = Math.log10(yFloor);
  const yMaxLog = Math.log10(yCeil);

  const x = value => pad.left + ((value - xMin) / (xMax - xMin)) * innerW;
  const y = value => {
    const safe = Math.max(yFloor, value);
    return pad.top + innerH - ((Math.log10(safe) - yMinLog) / (yMaxLog - yMinLog)) * innerH;
  };
  const invX = value => xMin + ((value - pad.left) / innerW) * (xMax - xMin);

  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Cash on hand by day for each model's best run"
  }, mount);

  const tickStyle = {
    "font-family": "Inter, sans-serif",
    "font-size": "12",
    "font-weight": "600",
    fill: "#425466"
  };
  const labelStyle = {
    "font-family": "Inter, sans-serif",
    "font-size": "13",
    "font-weight": "800",
    fill: "#0a2540"
  };

  const yTicks = [100, 1000, 10000, 100000, 1000000, 10000000, 100000000]
    .filter(tick => tick <= yCeil);

  yTicks.forEach(tick => {
    const yy = y(tick);
    svgEl("line", {
      x1: pad.left,
      x2: W - pad.right,
      y1: yy,
      y2: yy,
      stroke: "#d6dde6",
      "stroke-width": "0.9",
      "stroke-dasharray": "3 4"
    }, svg);
    const label = svgEl("text", {
      x: pad.left - 8,
      y: yy + 4,
      "text-anchor": "end",
      ...tickStyle
    }, svg);
    label.textContent = formatCash(tick);
  });

  [0, 100, 200, 300, 400, 500].forEach(tick => {
    const xx = x(tick);
    svgEl("line", {
      x1: xx,
      x2: xx,
      y1: pad.top,
      y2: pad.top + innerH,
      stroke: "#eef1f5",
      "stroke-width": "0.8"
    }, svg);
    svgEl("line", {
      x1: xx,
      x2: xx,
      y1: pad.top + innerH,
      y2: pad.top + innerH + 5,
      stroke: "#0a2540",
      "stroke-width": "1"
    }, svg);
    const label = svgEl("text", {
      x: xx,
      y: H - 27,
      "text-anchor": "middle",
      ...tickStyle
    }, svg);
    label.textContent = String(tick);
  });

  svgEl("line", {
    x1: pad.left,
    x2: pad.left,
    y1: pad.top - 3,
    y2: pad.top + innerH + 2,
    stroke: "#0a2540",
    "stroke-width": "1.3"
  }, svg);
  svgEl("line", {
    x1: pad.left - 3,
    x2: W - pad.right + 2,
    y1: pad.top + innerH,
    y2: pad.top + innerH,
    stroke: "#0a2540",
    "stroke-width": "1.3"
  }, svg);

  const startY = y(1000000);
  svgEl("line", {
    x1: pad.left,
    x2: W - pad.right,
    y1: startY,
    y2: startY,
    stroke: "#0a2540",
    "stroke-width": "1",
    "stroke-dasharray": "5 4",
    opacity: "0.55"
  }, svg);
  const startingCashLabel = svgEl("text", {
    x: W - pad.right - 8,
    y: startY - 8,
    "text-anchor": "end",
    "font-family": "Inter, sans-serif",
    "font-size": "12",
    "font-weight": "700",
    fill: "#425466"
  }, svg);
  startingCashLabel.textContent = "$1M starting cash balance";

  const xLabel = svgEl("text", {
    x: pad.left + innerW / 2,
    y: H - 8,
    "text-anchor": "middle",
    ...labelStyle
  }, svg);
  xLabel.textContent = "Day";

  const yLabel = svgEl("text", {
    x: -(pad.top + innerH / 2),
    y: 17,
    transform: "rotate(-90)",
    "text-anchor": "middle",
    ...labelStyle
  }, svg);
  yLabel.textContent = "Cash on hand (USD, log)";

  const lineGroup = svgEl("g", {}, svg);
  runs.forEach(run => {
    const color = MODEL_COLORS[run.pretty] || "#0a2540";
    const pathData = run.points
      .map(([day, cash], index) => `${index === 0 ? "M" : "L"} ${x(day).toFixed(2)} ${y(cash).toFixed(2)}`)
      .join(" ");
    svgEl("path", {
      d: pathData,
      fill: "none",
      stroke: color,
      "stroke-width": run.pretty === "GPT-5.5" ? "3" : "2.2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      opacity: run.pretty === "GPT-5.5" ? "0.96" : "0.78"
    }, lineGroup);

    const last = run.points[run.points.length - 1];
    if (run.bankrupt) {
      drawBankruptcyMarker(
        lineGroup,
        x(last[0]),
        y(last[1]) - 6,
        `${run.pretty} bankrupt at day ${last[0]}`
      );
    } else {
      svgEl("circle", {
        cx: x(last[0]),
        cy: y(last[1]),
        r: "4.6",
        fill: color,
        stroke: color,
        "stroke-width": "2"
      }, lineGroup);
    }
  });

  const labelOffsets = {
    "GPT-5.5": { dx: -8, dy: -10, anchor: "end" },
    "Claude Opus 4.7": { dx: -8, dy: -10, anchor: "end" },
    "Claude Sonnet 4.6": { dx: -8, dy: -4, anchor: "end" },
    "Kimi K2.6": { dx: -8, dy: 12, anchor: "end" },
    "Claude Haiku 4.5": { dx: 8, dy: -34, anchor: "start" },
    "Gemini 3 Flash": { dx: -8, dy: -12, anchor: "end" },
    "DeepSeek V4 Pro": { dx: -8, dy: -28, anchor: "end" },
    "Grok 4.20": { dx: 8, dy: -12, anchor: "start" },
    "GLM 5.1": { dx: 8, dy: -18, anchor: "start" }
  };

  const labelsGroup = svgEl("g", { "aria-label": "Model labels" }, svg);
  runs.forEach(run => {
    const color = MODEL_COLORS[run.pretty] || "#0a2540";
    const last = run.points[run.points.length - 1];
    const offset = labelOffsets[run.pretty] || { dx: 8, dy: -8, anchor: "start" };
    const rawX = x(last[0]) + offset.dx;
    const rawY = y(last[1]) + offset.dy;
    const label = svgEl("text", {
      x: Math.max(pad.left + 6, Math.min(W - pad.right - 8, rawX)),
      y: Math.max(pad.top + 12, Math.min(pad.top + innerH + 13, rawY)),
      "text-anchor": offset.anchor,
      "font-family": "Inter, sans-serif",
      "font-size": "12",
      "font-weight": "800",
      fill: color,
      stroke: "#ffffff",
      "stroke-width": "3.5",
      "paint-order": "stroke fill",
      "pointer-events": "none"
    }, labelsGroup);
    label.textContent = run.pretty;
  });

  const hoverGroup = svgEl("g", { opacity: "0" }, svg);
  const hoverLine = svgEl("line", {
    y1: pad.top,
    y2: pad.top + innerH,
    stroke: "#0a2540",
    "stroke-width": "1",
    "stroke-dasharray": "3 3",
    opacity: "0.75"
  }, hoverGroup);
  const hoverDots = svgEl("g", {}, hoverGroup);

  const tooltip = document.createElement("div");
  tooltip.className = "plot-tooltip";
  mount.appendChild(tooltip);

  function updateTooltip(event) {
    const svgRect = svg.getBoundingClientRect();
    const mountRect = mount.getBoundingClientRect();
    const sx = W / svgRect.width;
    const rawX = (event.clientX - svgRect.left) * sx;
    const day = Math.max(0, Math.min(500, Math.round(invX(rawX))));
    const xx = x(day);

    hoverGroup.setAttribute("opacity", "1");
    hoverLine.setAttribute("x1", xx);
    hoverLine.setAttribute("x2", xx);
    hoverDots.innerHTML = "";

    const values = runs.map(run => ({
      name: run.pretty,
      color: MODEL_COLORS[run.pretty] || "#0a2540",
      value: valueAtDay(run.points, day)
    })).filter(item => item.value !== null);

    values.forEach(item => {
      svgEl("circle", {
        cx: xx,
        cy: y(item.value),
        r: "3.6",
        fill: item.color,
        stroke: "#ffffff",
        "stroke-width": "1.4"
      }, hoverDots);
    });

    values.sort((a, b) => b.value - a.value);
    tooltip.innerHTML = `
      <div class="tooltip-day">Day ${day}</div>
      ${values.map(item => `
        <div class="tooltip-row">
          <span class="tooltip-dot" style="background:${item.color}"></span>
          <span class="tooltip-name">${item.name}</span>
          <span class="tooltip-value">${formatCash(item.value)}</span>
        </div>
      `).join("")}
    `;

    const pointerX = event.clientX - mountRect.left;
    const maxLeft = Math.max(10, mountRect.width - tooltip.offsetWidth - 10);
    const left = Math.max(10, Math.min(pointerX + 16, maxLeft));
    tooltip.style.left = `${left}px`;
    tooltip.classList.add("visible");
  }

  svg.addEventListener("pointermove", updateTooltip);
  svg.addEventListener("pointerenter", updateTooltip);
  svg.addEventListener("pointerleave", () => {
    hoverGroup.setAttribute("opacity", "0");
    tooltip.classList.remove("visible");
  });

}

function fitFrame(frame) {
  const wrap = frame.closest(".frame-wrap");
  const baseW = Number(frame.dataset.width);
  const baseH = Number(frame.dataset.height);
  if (!wrap || !baseW || !baseH) return;

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
  return runs.slice().sort((a, b) => {
    if (a.pretty === "GPT-5.5") return -1;
    if (b.pretty === "GPT-5.5") return 1;
    return b.final_cash - a.final_cash;
  });
}

async function loadCashRuns() {
  if (Array.isArray(window.CEOBENCH_RUNS)) {
    return window.CEOBENCH_RUNS;
  }

  const response = await fetch("assets/runs.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

loadCashRuns()
  .then(runs => drawCashPlot(orderRuns(runs)))
  .catch(error => {
    const mount = document.getElementById("cash-plot");
    if (mount) {
      mount.innerHTML = `<div class="plot-error">Could not load cash data: ${error.message}</div>`;
    }
  });

window.addEventListener("load", fitAllFrames);
window.addEventListener("resize", fitAllFrames);
document.querySelectorAll("details").forEach(details => {
  details.addEventListener("toggle", fitAllFrames);
});
document.querySelectorAll(".frame-wrap iframe").forEach(frame => {
  frame.addEventListener("load", () => fitFrame(frame));
});
