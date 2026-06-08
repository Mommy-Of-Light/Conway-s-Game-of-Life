// client.js
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

/* =========================================================
   DPI FIX
   ========================================================= */
function resize() {
  const dpr = window.devicePixelRatio || 1;

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

let panning = false;
let painting = false;

let pinchDistance = null;
let lastCenter = null;

let mouse = { x: 0, y: 0 };

/* =========================================================
   TOOL SYSTEM
   ========================================================= */
let tool = "draw"; // draw | erase

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

let patterns = [];
let ghost = null;

/* =========================================================
   NEW: GHOST PLACEMENT STATE FIX
   ========================================================= */
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
  }
};

/* =========================================================
   POINTER INPUT
   ========================================================= */
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("pointerdown", (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {}

  activePointers.set(e.pointerId, {
    x: e.clientX,
    y: e.clientY,
  });

  mouse = screenToWorld(e.clientX, e.clientY);

  /* SAVE MODE */
  if (saveMode && activePointers.size === 1) {
    handleSaveSelection(mouse);
    return;
  }

  /* SINGLE POINTER */
  if (activePointers.size === 1) {

    if (!paused) return;

    /* GHOST MODE → now only activates, does NOT place */
    if (ghost) {
      placingGhost = true;
      return;
    }

    painting = true;

    const value = tool === "erase" ? false : true;
    paint(mouse.x, mouse.y, value);
  }

  /* PINCH / PAN */
  if (activePointers.size === 2) {
    painting = false;
    panning = true;

    const pts = [...activePointers.values()];

    pinchDistance = Math.hypot(
      pts[1].x - pts[0].x,
      pts[1].y - pts[0].y
    );

    lastCenter = {
      x: (pts[0].x + pts[1].x) / 2,
      y: (pts[0].y + pts[1].y) / 2,
    };
  }
});

function stopPointer(id) {
  activePointers.delete(id);

  if (activePointers.size < 2) {
    panning = false;
    pinchDistance = null;
  }

  /* =========================================================
     FIX: PLACE GHOST ON RELEASE ONLY
     ========================================================= */
  if (activePointers.size === 0) {
    painting = false;

    if (placingGhost && ghost) {
      placeGhost(mouse);
      ghost = null;
      placingGhost = false;
    }
  }
}

canvas.addEventListener("pointerup", (e) => stopPointer(e.pointerId));
canvas.addEventListener("pointercancel", (e) => stopPointer(e.pointerId));

canvas.addEventListener("pointermove", (e) => {
  if (!activePointers.has(e.pointerId)) return;

  activePointers.set(e.pointerId, {
    x: e.clientX,
    y: e.clientY,
  });

  mouse = screenToWorld(e.clientX, e.clientY);

  /* PAINT */
  if (activePointers.size === 1 && painting && paused) {
    const value = tool === "erase" ? false : true;
    paint(mouse.x, mouse.y, value);
  }

  /* PAN / PINCH */
  if (activePointers.size === 2 && panning) {
    const pts = [...activePointers.values()];

    const center = {
      x: (pts[0].x + pts[1].x) / 2,
      y: (pts[0].y + pts[1].y) / 2,
    };

    const before = screenToWorld(center.x, center.y);

    const dist = Math.hypot(
      pts[1].x - pts[0].x,
      pts[1].y - pts[0].y
    );

    zoom *= dist / pinchDistance;
    zoom = Math.max(0.05, Math.min(80, zoom));

    const after = screenToWorld(center.x, center.y);

    cameraX += before.x - after.x;
    cameraY += before.y - after.y;

    pinchDistance = dist;
    lastCenter = center;
  }
});

/* =========================================================
   LEGACY MOUSE SYSTEM (KEPT)
   ========================================================= */
/*
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
  if (tool === "erase") {
    for (const p of ghost) {
      paint(pos.x + p.x, pos.y + p.y, false);
    }
  } else {
    for (const p of ghost) {
      paint(pos.x + p.x, pos.y + p.y, true);
    }
  }
}

/* =========================================================
   SAVE SYSTEM
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
    selectionStart = null;
    selectionEnd = null;
    return;
  }

  finishPatternSave();
}

async function finishPatternSave() {
  const minX = Math.min(selectionStart.x, selectionEnd.x);
  const maxX = Math.max(selectionStart.x, selectionEnd.x);
  const minY = Math.min(selectionStart.y, selectionEnd.y);
  const maxY = Math.max(selectionStart.y, selectionEnd.y);

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

  if (!selected.length) {
    alert("No cells in selection!");
    saveMode = false;
    return;
  }

  await fetch("/savePattern", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: pendingPatternName,
      cells: selected,
    }),
  });

  saveMode = false;
  selectionStart = null;
  selectionEnd = null;

  refreshPatterns();
}

/* =========================================================
   PATTERNS
   ========================================================= */
async function refreshPatterns() {
  const res = await fetch("/patterns");
  patterns = await res.json();

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
pauseBtn.onclick = () =>
  ws.send(JSON.stringify({ type: "pause" }));

resetBtn.onclick = () =>
  ws.send(JSON.stringify({ type: "reset" }));

stepBtn.onclick = () =>
  ws.send(JSON.stringify({ type: "step" }));

clearBtn.onclick = () =>
  ws.send(JSON.stringify({ type: "reset" }));

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
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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

  if (saveMode && selectionStart) {
    const p1 = worldToScreen(selectionStart.x, selectionStart.y);
    const p2 = worldToScreen(mouse.x, mouse.y);

    ctx.strokeStyle = "#00ffff";
    ctx.lineWidth = 2;

    ctx.strokeRect(
      Math.min(p1.x, p2.x),
      Math.min(p1.y, p2.y),
      Math.abs(p2.x - p1.x),
      Math.abs(p2.y - p1.y),
    );
  }

  if (ghost && paused) {
    ctx.fillStyle = "rgba(0,255,255,0.4)";

    for (const p of ghost) {
      const s = worldToScreen(mouse.x + p.x, mouse.y + p.y);
      ctx.fillRect(s.x, s.y, Math.max(1, zoom), Math.max(1, zoom));
    }
  }

  ctx.fillStyle = "#00ff88";
  for (const c of cells) {
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