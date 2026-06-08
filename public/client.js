const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

/* =========================================================
   DEVICE FLAGS
   ========================================================= */
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

let frame = 0;
let dirty = false;
let started = false;

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
   FIX: AUTHORITATIVE DRAG CURSOR
   ========================================================= */
let dragMouse = { x: 0, y: 0 };

/* =========================================================
   TOOL SYSTEM
   ========================================================= */
let tool = "draw"; // draw | erase | move

const drawEraseBtn = document.getElementById("drawEraseBtn");

drawEraseBtn.onclick = () => {
  if (tool === "draw") tool = "erase";
  else if (tool === "erase") tool = "move";
  else tool = "draw";

  drawEraseBtn.textContent =
    tool === "draw" ? "✏️ Draw" : tool === "erase" ? "🧹 Erase" : "🧭 Move";
};

function isMoveMode() {
  return tool === "move";
}

/* =========================================================
   SAVE / PATTERNS
   ========================================================= */
let saveMode = false;
let selectionStart = null;
let selectionEnd = null;

let ghost = null;
let placingGhost = false;
let placingPattern = false;

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
   POINTER DOWN
   ========================================================= */
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("pointerdown", (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {}

  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  mouse = screenToWorld(e.clientX, e.clientY);
  dragMouse = mouse; // ✅ FIX

  /* SAVE MODE */
  if (saveMode && activePointers.size === 1) {
    handleSaveSelection(mouse);
    return;
  }

  /* ================================
     START PATTERN PLACEMENT
     ================================ */
  if (ghost && paused && activePointers.size === 1) {
    placingPattern = true;
    return;
  }

  if (activePointers.size === 1) {
    if (!paused) return;

    if (isMoveMode()) {
      painting = false;
      return;
    }

    painting = true;

    const value = tool === "erase" ? false : true;
    paint(mouse.x, mouse.y, value);

    dirty = true;
  }

  /* PINCH */
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
   POINTER MOVE
   ========================================================= */
canvas.addEventListener("pointermove", (e) => {
  if (!activePointers.has(e.pointerId)) return;

  const prev = activePointers.get(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  mouse = screenToWorld(e.clientX, e.clientY);
  dragMouse = mouse; // ✅ FIX: ALWAYS TRACK LATEST CURSOR

  if (isMoveMode() && activePointers.size === 1) {
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;

    cameraX -= dx / zoom;
    cameraY -= dy / zoom;

    dirty = true;
  }

  if (!isMoveMode() && activePointers.size === 1 && painting && paused) {
    paint(mouse.x, mouse.y, tool === "erase" ? false : true);
    dirty = true;
  }

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

  if (activePointers.size === 0) {
    painting = false;

    /* ================================
       PLACE PATTERN ON RELEASE
       ================================ */
    if (placingPattern && ghost) {
      placeGhost(dragMouse); // ✅ FIX

      ghost = null;
      placingPattern = false;
      placingGhost = false;
    }

    dirty = true;
  }
}

canvas.addEventListener("pointerup", (e) => stopPointer(e.pointerId));
canvas.addEventListener("pointercancel", (e) => stopPointer(e.pointerId));

/* =========================================================
   WHEEL ZOOM
   ========================================================= */
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();

    const before = screenToWorld(e.clientX, e.clientY);

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    zoom *= zoomFactor;

    zoom = Math.max(0.05, Math.min(80, zoom));

    const after = screenToWorld(e.clientX, e.clientY);

    cameraX += before.x - after.x;
    cameraY += before.y - after.y;

    dirty = true;
  },
  { passive: false }
);

/* =========================================================
   CORE ACTIONS
   ========================================================= */
function paint(x, y, value) {
  ws.send(JSON.stringify({ type: "set", x, y, value }));
}

/* =========================================================
   GHOST
   ========================================================= */
function placeGhost(pos) {
  for (const p of ghost) {
    paint(pos.x + p.x, pos.y + p.y, tool !== "erase");
  }
}

/* =========================================================
   SAVE SYSTEM
   ========================================================= */
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
    .filter((c) => c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY)
    .map((c) => ({
      x: c.x - minX,
      y: c.y - minY,
    }));

  await fetch("/savePattern", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, cells: selected }),
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

  const minX = Math.min(...data.map((p) => p.x));
  const minY = Math.min(...data.map((p) => p.y));

  ghost = data.map((p) => ({
    x: p.x - minX,
    y: p.y - minY,
  }));

  placingGhost = true;
  placingPattern = false;

  paused = true;
};

/* =========================================================
   ROTATE + DELETE
   ========================================================= */
window.rotatePattern = function () {
  if (!ghost) return;

  ghost = ghost.map((p) => ({
    x: -p.y,
    y: p.x,
  }));
};

window.deletePattern = async function () {
  const name = select.value;
  if (!name) return;

  await fetch(`/deletePattern?name=${name}`, {
    method: "DELETE",
  });

  refreshPatterns();
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
   BUTTONS
   ========================================================= */
pauseBtn.onclick = () => ws.send(JSON.stringify({ type: "pause" }));
resetBtn.onclick = () => ws.send(JSON.stringify({ type: "reset" }));
stepBtn.onclick = () => ws.send(JSON.stringify({ type: "step" }));
clearBtn.onclick = () => ws.send(JSON.stringify({ type: "reset" }));

randomBtn.onclick = () => {
  for (let i = 0; i < 300; i++) {
    ws.send(
      JSON.stringify({
        type: "set",
        x: Math.floor(cameraX + (Math.random() - 0.5) * 60),
        y: Math.floor(cameraY + (Math.random() - 0.5) * 60),
        value: true,
      })
    );
  }
};

/* =========================================================
   SPEED
   ========================================================= */
speedRange.addEventListener("change", () => {
  fetch("/changeRefreshTime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ time: speedRange.value }),
  });
});

/* =========================================================
   RENDER LOOP
   ========================================================= */
function startRender() {
  if (started) return;
  started = true;
  requestAnimationFrame(render);
}

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
  if (ghost && paused && placingPattern) {
    ctx.fillStyle = "rgba(0,255,255,0.4)";

    for (const p of ghost) {
      const s = worldToScreen(dragMouse.x + p.x, dragMouse.y + p.y);
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

setTimeout(startRender, isMobile ? 200 : 0);

/* =========================================================
   LEGACY (UNCHANGED)
   ========================================================= */
// window.addEventListener("mousemove", (e) => {
//   mouse = screenToWorld(e.clientX, e.clientY);
// });

// canvas.addEventListener("mousedown", (e) => {
//   mouse = screenToWorld(e.clientX, e.clientY);

//   if (e.button === 0) paint(mouse.x, mouse.y, true);
//   if (e.button === 2) paint(mouse.x, mouse.y, false);
// });y