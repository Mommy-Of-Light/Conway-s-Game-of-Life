const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

/* =========================
   DEVICE FLAGS
========================= */
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/* =========================
   STATE
========================= */
let cells = [];
let paused = false;

let zoom = 18;
let cameraX = 0;
let cameraY = 0;

let mouse = { x: 0, y: 0 };

let activePointers = new Map();
let painting = false;
let panning = false;
let pinchDistance = null;

/* =========================
   DIRTY FLAG
========================= */
let viewDirty = true;

/* =========================
   TOOL
========================= */
let tool = "draw";

const drawEraseBtn = document.getElementById("drawEraseBtn");

drawEraseBtn.onclick = () => {
  tool = tool === "draw"
    ? "erase"
    : tool === "erase"
      ? "move"
      : "draw";

  drawEraseBtn.textContent =
    tool === "draw" ? "✏️ Draw" :
    tool === "erase" ? "🧹 Erase" :
    "🧭 Move";
};

const isMoveMode = () => tool === "move";

/* =========================
   PATTERNS
========================= */
let saveMode = false;
let selectionStart = null;
let selectionEnd = null;

let ghost = null;
let placingPattern = false;

/* =========================
   UI
========================= */
const select = document.getElementById("patternSelect");
const pauseBtn = document.getElementById("playPauseBtn");
const stepBtn = document.getElementById("stepBtn");
const resetBtn = document.getElementById("resetBtn");
const clearBtn = document.getElementById("clearBtn");
const randomBtn = document.getElementById("randomBtn");
const speedRange = document.getElementById("speedRange");
const hud = document.getElementById("hud");

/* =========================
   WS
========================= */
const ws = new WebSocket(
  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`
);

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);

  if (msg.type === "state") {
    cells = msg.cells;
    paused = msg.paused;

    pauseBtn.textContent = paused ? "▶" : "❚❚";
    viewDirty = true;
  }
};

/* =========================
   RESIZE
========================= */
function resize() {
  const dpr = isMobile ? 1.25 : 2;

  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;

  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  viewDirty = true;
}
resize();
addEventListener("resize", resize);

/* =========================
   COORDS
========================= */
function screenToWorld(x, y) {
  return {
    x: Math.floor(cameraX + (x - canvas.width / 2) / zoom),
    y: Math.floor(cameraY + (y - canvas.height / 2) / zoom),
  };
}

function worldToScreen(x, y) {
  return {
    x: (x - cameraX) * zoom + canvas.width / 2,
    y: (y - cameraY) * zoom + canvas.height / 2,
  };
}

/* =========================
   CORE
========================= */
function paint(x, y, value) {
  ws.send(JSON.stringify({ type: "set", x, y, value }));
}

/* =========================
   GHOST
========================= */
function placeGhost(pos) {
  for (const p of ghost) {
    paint(pos.x + p.x, pos.y + p.y, tool !== "erase");
  }
}

/* =========================
   POINTER INPUT
========================= */
canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture?.(e.pointerId);

  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  mouse = screenToWorld(e.clientX, e.clientY);

  if (saveMode && activePointers.size === 1) {
    handleSaveSelection(mouse);
    return;
  }

  if (ghost && paused && activePointers.size === 1) {
    placingPattern = true;
    return;
  }

  /* ❌ NO DRAWING HERE ANYMORE */

  if (activePointers.size === 1) {
    if (!paused || isMoveMode()) return;
    painting = true;
  }

  if (activePointers.size === 2) {
    painting = false;
    panning = true;

    const pts = [...activePointers.values()];
    pinchDistance = Math.hypot(
      pts[1].x - pts[0].x,
      pts[1].y - pts[0].y
    );
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!activePointers.has(e.pointerId)) return;

  const prev = activePointers.get(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  mouse = screenToWorld(e.clientX, e.clientY);

  if (isMoveMode() && activePointers.size === 1) {
    cameraX -= (e.clientX - prev.x) / zoom;
    cameraY -= (e.clientY - prev.y) / zoom;
    viewDirty = true;
  }

  if (!isMoveMode() && painting && activePointers.size === 1 && paused) {
    paint(mouse.x, mouse.y, tool !== "erase");
    viewDirty = true;
  }

  if (activePointers.size === 2 && panning) {
    const pts = [...activePointers.values()];
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);

    zoom *= dist / pinchDistance;
    zoom = Math.max(0.05, Math.min(80, zoom));

    pinchDistance = dist;
    viewDirty = true;
  }
});

function stopPointer(id) {
  activePointers.delete(id);

  if (activePointers.size < 2) {
    panning = false;
    pinchDistance = null;
  }

  if (activePointers.size === 0) {
    painting = false;

    if (placingPattern && ghost) {
      placeGhost(mouse);
      ghost = null;
      placingPattern = false;
    }

    viewDirty = true;
  }
};

canvas.addEventListener("pointerup", e => stopPointer(e.pointerId));
canvas.addEventListener("pointercancel", e => stopPointer(e.pointerId));

/* =========================
   ZOOM
========================= */
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();

  const before = screenToWorld(e.clientX, e.clientY);

  zoom *= e.deltaY > 0 ? 0.9 : 1.1;
  zoom = Math.max(0.05, Math.min(80, zoom));

  const after = screenToWorld(e.clientX, e.clientY);

  cameraX += before.x - after.x;
  cameraY += before.y - after.y;

  viewDirty = true;
}, { passive: false });

/* =========================
   BUTTONS
========================= */
pauseBtn.onclick = () => ws.send(JSON.stringify({ type: "pause" }));
resetBtn.onclick = () => ws.send(JSON.stringify({ type: "reset" }));
stepBtn.onclick = () => ws.send(JSON.stringify({ type: "step" }));
clearBtn.onclick = () => ws.send(JSON.stringify({ type: "reset" }));

randomBtn.onclick = () => {
  for (let i = 0; i < 300; i++) {
    ws.send(JSON.stringify({
      type: "set",
      x: Math.floor(cameraX + (Math.random() - 0.5) * 60),
      y: Math.floor(cameraY + (Math.random() - 0.5) * 60),
      value: true
    }));
  }
};

/* =========================
   SPEED
========================= */
speedRange.addEventListener("change", () => {
  fetch("/changeRefreshTime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ time: speedRange.value })
  });
});

/* =========================
   PATTERNS
========================= */
async function refreshPatterns() {
  const res = await fetch("/patterns");
  const patterns = await res.json();

  select.innerHTML = "";
  for (const p of patterns) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  }
}
refreshPatterns();

window.loadPattern = async () => {
  const name = select.value;
  if (!name) return;

  const res = await fetch(`/load?name=${name}`);
  const data = await res.json();

  const minX = Math.min(...data.map(p => p.x));
  const minY = Math.min(...data.map(p => p.y));

  ghost = data.map(p => ({
    x: p.x - minX,
    y: p.y - minY
  }));

  placingPattern = false;
  paused = true;
};

window.rotatePattern = () => {
  if (!ghost) return;

  ghost = ghost.map(p => ({
    x: -p.y,
    y: p.x
  }));
};

window.deletePattern = async () => {
  const name = select.value;
  if (!name) return;

  await fetch(`/deletePattern?name=${name}`, { method: "DELETE" });
  refreshPatterns();
};

/* =========================
   SAVE PATTERN
========================= */
window.savePattern = () => {
  saveMode = true;
  selectionStart = null;
  selectionEnd = null;
  alert("Click FIRST corner, then SECOND corner.");
};

function handleSaveSelection(mouse) {
  if (!selectionStart) {
    selectionStart = mouse;
    return;
  }

  selectionEnd = mouse;

  const name = prompt("Pattern name?");
  if (!name) {
    saveMode = false;
    return;
  }

  finishPatternSave(name);
}

async function finishPatternSave(name) {
  const minX = Math.min(selectionStart.x, selectionEnd.x);
  const maxX = Math.max(selectionStart.x, selectionEnd.x);
  const minY = Math.min(selectionStart.y, selectionEnd.y);

  const selected = cells
    .filter(c =>
      c.x >= minX && c.x <= maxX &&
      c.y >= minY && c.y <= maxY
    )
    .map(c => ({
      x: c.x - minX,
      y: c.y - minY
    }));

  await fetch("/savePattern", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, cells: selected })
  });

  saveMode = false;
  refreshPatterns();
}

/* =========================
   LEGACY CONTROLS (RESTORED)
========================= */
// addEventListener("mousemove", (e) => {
//   mouse = screenToWorld(e.clientX, e.clientY);
// });

// addEventListener("mousedown", (e) => {
//   mouse = screenToWorld(e.clientX, e.clientY);

//   if (e.button === 0) paint(mouse.x, mouse.y, true);
//   if (e.button === 2) paint(mouse.x, mouse.y, false);
// });

/* =========================
   RENDER LOOP
========================= */
function render() {
  requestAnimationFrame(render);

  if (!viewDirty && isMobile) return;
  viewDirty = false;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawGrid();
  drawCells();
  drawGhost();
  drawHUD();
}

function drawGrid() {
  if (zoom < 6) return;

  ctx.strokeStyle = "#222";
  ctx.beginPath();

  const left = cameraX - canvas.width / (2 * zoom);
  const right = cameraX + canvas.width / (2 * zoom);
  const top = cameraY - canvas.height / (2 * zoom);
  const bottom = cameraY + canvas.height / (2 * zoom);

  for (let x = Math.floor(left); x <= Math.ceil(right); x++) {
    const sx = worldToScreen(x, 0).x;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, canvas.height);
  }

  for (let y = Math.floor(top); y <= Math.ceil(bottom); y++) {
    const sy = worldToScreen(0, y).y;
    ctx.moveTo(0, sy);
    ctx.lineTo(canvas.width, sy);
  }

  ctx.stroke();
}

function drawCells() {
  ctx.fillStyle = "#00ff88";

  for (const c of cells) {
    const p = worldToScreen(c.x, c.y);
    ctx.fillRect(p.x, p.y, Math.max(1, zoom), Math.max(1, zoom));
  }
}

function drawGhost() {
  if (!ghost || !paused || !placingPattern) return;

  ctx.fillStyle = "rgba(0,255,255,0.4)";

  for (const p of ghost) {
    const s = worldToScreen(mouse.x + p.x, mouse.y + p.y);
    ctx.fillRect(s.x, s.y, Math.max(1, zoom), Math.max(1, zoom));
  }
}

function drawHUD() {
  hud.textContent =
`Tool: ${tool}
Mouse: (${mouse.x}, ${mouse.y})
Camera: (${cameraX.toFixed(1)}, ${cameraY.toFixed(1)})
Zoom: ${zoom.toFixed(2)}x`;
}

requestAnimationFrame(render);