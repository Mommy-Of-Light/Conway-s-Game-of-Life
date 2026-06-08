const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

/* =========================================================
   DEVICE DETECTION
   ========================================================= */
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
let frame = 0;
let dirty = true;

/* =========================================================
   DPI FIX
   ========================================================= */
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);

  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;

  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

resize();
window.addEventListener("resize", resize);

/* =========================================================
   WEBSOCKET
   ========================================================= */
const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${wsProtocol}//${location.host}`);

/* =========================================================
   STATE
   ========================================================= */
let cells = [];
let paused = false;

let zoom = 20;
let cameraX = 0;
let cameraY = 0;

let activePointers = new Map();

let painting = false;
let panning = false;

let pinchDistance = null;

let mouse = { x: 0, y: 0 };

/* =========================================================
   CROSS-PLATFORM PAN (NEW UNIFIED SYSTEM)
   ========================================================= */
let panActive = false;
let panPointerId = null;
let lastPan = null;

/* =========================================================
   TOOL SYSTEM
   ========================================================= */
let tool = "draw";

const drawEraseBtn = document.getElementById("drawEraseBtn");

drawEraseBtn.onclick = () => {
  tool = tool === "draw" ? "erase" : "draw";
  drawEraseBtn.textContent = tool === "draw" ? "✏️ Draw" : "🧹 Erase";
};

/* =========================================================
   SAVE / PATTERNS
   ========================================================= */
let saveMode = false;
let selectionStart = null;
let selectionEnd = null;
let pendingPatternName = null;

let ghost = null;
let placingGhost = false;

/* =========================================================
   UI
   ========================================================= */
const select = document.getElementById("patternSelect");

const pauseBtn = document.getElementById("playPauseBtn");
const stepBtn = document.getElementById("stepBtn");
const resetBtn = document.getElementById("resetBtn");
const clearBtn = document.getElementById("clearBtn");
const randomBtn = document.getElementById("randomBtn");
const speedRange = document.getElementById("speedRange");
const hud = document.getElementById("hud");

/* =========================================================
   WEBSOCKET STATE
   ========================================================= */
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);

  if (msg.type === "state") {
    cells = msg.cells;
    paused = msg.paused;
    pauseBtn.textContent = paused ? "▶" : "❚❚";
    dirty = true;
  }
};

/* =========================================================
   POINTER INPUT (UNIFIED)
   ========================================================= */
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("pointerdown", (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {}

  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  mouse = screenToWorld(e.clientX, e.clientY);

  /* SAVE MODE */
  if (saveMode && activePointers.size === 1) {
    handleSaveSelection(mouse);
    return;
  }

  /* =========================
     PAN (ALL PLATFORMS)
     ========================= */
  if (activePointers.size === 1) {

    if (!paused) return;

    // 🖱️ Desktop modifier-based pan
    if (e.ctrlKey || e.metaKey || e.button === 1) {
      panActive = true;
      panPointerId = e.pointerId;
      lastPan = { x: e.clientX, y: e.clientY };
      return;
    }

    if (ghost) {
      placingGhost = true;
      return;
    }

    painting = true;
    paint(mouse.x, mouse.y, tool === "erase" ? false : true);
    dirty = true;
  }

  /* =========================
     PINCH ZOOM
     ========================= */
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

/* =========================================================
   POINTER MOVE (PAN + PAINT + PINCH)
   ========================================================= */
canvas.addEventListener("pointermove", (e) => {
  if (!activePointers.has(e.pointerId)) return;

  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  mouse = screenToWorld(e.clientX, e.clientY);

  /* =========================
     UNIFIED PAN MOVEMENT
     ========================= */
  if (panActive && e.pointerId === panPointerId) {
    const dx = e.clientX - lastPan.x;
    const dy = e.clientY - lastPan.y;

    cameraX -= dx / zoom;
    cameraY -= dy / zoom;

    lastPan = { x: e.clientX, y: e.clientY };
    dirty = true;
  }

  /* PAINT */
  if (activePointers.size === 1 && painting && paused) {
    paint(mouse.x, mouse.y, tool === "erase" ? false : true);
    dirty = true;
  }

  /* PINCH */
  if (activePointers.size === 2 && panning) {
    const pts = [...activePointers.values()];

    const dist = Math.hypot(
      pts[1].x - pts[0].x,
      pts[1].y - pts[0].y
    );

    zoom *= dist / pinchDistance;
    zoom = Math.max(0.05, Math.min(80, zoom));

    pinchDistance = dist;
    dirty = true;
  }
});

/* =========================================================
   POINTER END
   ========================================================= */
function stopPointer(id) {
  activePointers.delete(id);

  if (activePointers.size < 2) {
    panning = false;
    pinchDistance = null;
  }

  /* STOP PAN */
  if (id === panPointerId) {
    panActive = false;
    panPointerId = null;
    lastPan = null;
  }

  if (activePointers.size === 0) {
    painting = false;

    if (placingGhost && ghost) {
      placeGhost(mouse);
      ghost = null;
      placingGhost = false;
    }

    dirty = true;
  }
}

canvas.addEventListener("pointerup", (e) => stopPointer(e.pointerId));
canvas.addEventListener("pointercancel", (e) => stopPointer(e.pointerId));

/* =========================================================
   CORE ACTIONS
   ========================================================= */
function paint(x, y, value) {
  ws.send(JSON.stringify({ type: "set", x, y, value }));
}

/* =========================================================
   GHOST PLACEMENT
   ========================================================= */
function placeGhost(pos) {
  for (const p of ghost) {
    paint(pos.x + p.x, pos.y + p.y, tool !== "erase");
  }
}

/* =========================================================
   SAVE SYSTEM (UNCHANGED)
   ========================================================= */
window.savePattern = () => {
  saveMode = true;
  selectionStart = null;
  selectionEnd = null;
  pendingPatternName = null;

  alert("Click FIRST corner, then SECOND corner.");
};

function handleSaveSelection(mouse) {
  if (!selectionStart) {
    selectionStart = mouse;
    return;
  }

  selectionEnd = mouse;

  pendingPatternName = prompt("Pattern name?");
  if (!pendingPatternName) {
    saveMode = false;
    return;
  }

  finishPatternSave();
}

async function finishPatternSave() {
  const minX = Math.min(selectionStart.x, selectionEnd.x);
  const maxX = Math.max(selectionStart.x, selectionEnd.x);
  const minY = Math.max(selectionStart.y, selectionEnd.y);

  const selected = cells
    .filter(c =>
      c.x >= minX &&
      c.x <= maxX &&
      c.y >= minY &&
      c.y <= maxY
    )
    .map(c => ({
      x: c.x - minX,
      y: c.y - minY,
    }));

  await fetch("/savePattern", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: pendingPatternName, cells: selected }),
  });

  saveMode = false;
  refreshPatterns();
}

/* =========================================================
   PATTERNS
   ========================================================= */
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
    y: p.y - minY,
  }));
};

/* =========================================================
   COORDS
   ========================================================= */
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

/* =========================================================
   UI BUTTONS
   ========================================================= */
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
      value: true,
    }));
  }
};

/* =========================================================
   SPEED CONTROL
   ========================================================= */
speedRange.addEventListener("change", () => {
  fetch("/changeRefreshTime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ time: speedRange.value }),
  });
});

/* =========================================================
   RENDER LOOP (OPTIMIZED)
   ========================================================= */
function render() {
  frame++;

  if (!dirty && isMobile && frame % 2 === 0) {
    requestAnimationFrame(render);
    return;
  }

  dirty = false;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  /* GRID */
  if (zoom > 4) {
    ctx.strokeStyle = "#222";

    const left = cameraX - canvas.width / (2 * zoom);
    const right = cameraX + canvas.width / (2 * zoom);
    const top = cameraY - canvas.height / (2 * zoom);
    const bottom = cameraY + canvas.height / (2 * zoom);

    for (let x = Math.floor(left); x <= Math.ceil(right); x++) {
      const sx = worldToScreen(x, 0).x;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
      ctx.stroke();
    }

    for (let y = Math.floor(top); y <= Math.ceil(bottom); y++) {
      const sy = worldToScreen(0, y).y;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
      ctx.stroke();
    }
  }

  /* GHOST */
  if (ghost && paused) {
    ctx.fillStyle = "rgba(0,255,255,0.4)";

    for (const p of ghost) {
      const s = worldToScreen(mouse.x + p.x, mouse.y + p.y);
      ctx.fillRect(s.x, s.y, Math.max(1, zoom), Math.max(1, zoom));
    }
  }

  /* CELLS */
  const renderCells = isMobile ? cells.slice(0, 4000) : cells;

  ctx.fillStyle = "#00ff88";

  for (const c of renderCells) {
    const p = worldToScreen(c.x, c.y);
    ctx.fillRect(p.x, p.y, Math.max(1, zoom), Math.max(1, zoom));
  }

  hud.innerHTML = `
    Tool: ${tool}<br/>
    Mouse: (${mouse.x}, ${mouse.y})<br/>
    Camera: (${cameraX.toFixed(1)}, ${cameraY.toFixed(1)})<br/>
    Zoom: ${zoom.toFixed(2)}x
  `;

  requestAnimationFrame(render);
}

render();

/* =========================================================
   LEGACY (KEPT EXACTLY AS REQUESTED)
   ========================================================= */

/*
OLD MOUSE SYSTEM (replaced by pointer events)

window.addEventListener("mousemove", (e) => {
  mouse = screenToWorld(e.clientX, e.clientY);

  if (panning) {
    cameraX -= (e.clientX - lastX) / zoom;
    cameraY -= (e.clientY - lastY) / zoom;

    lastX = e.clientX;
    lastY = e.clientY;
  }

  if (painting && paused) {
    paint(mouse.x, mouse.y, true);
  }
});

canvas.addEventListener("mousedown", (e) => {
  mouse = screenToWorld(e.clientX, e.clientY);

  if (e.button === 0) {
    paint(mouse.x, mouse.y, true);
  }

  if (e.button === 2) {
    paint(mouse.x, mouse.y, false);
  }
});
*/