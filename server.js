// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static("public"));
app.use(express.json());

// ---------------- STORAGE ----------------
if (!fs.existsSync("patterns")) {
  fs.mkdirSync("patterns");
}

// ---------------- STATE ----------------
const key = (x, y) => `${x},${y}`;

let liveCells = new Set();
let paused = false;
let refreshTime = 100;
let loop = null;

// ---------------- INITIAL PATTERN ----------------
[
  [1, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
].forEach(([x, y]) => liveCells.add(key(x, y)));

// ---------------- GAME OF LIFE ----------------
function nextGeneration(cells) {
  const counts = new Map();

  for (const cell of cells) {
    const [x, y] = cell.split(",").map(Number);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const k = key(x + dx, y + dy);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
  }

  const next = new Set();

  for (const [cell, count] of counts) {
    const alive = cells.has(cell);

    if ((alive && (count === 2 || count === 3)) || (!alive && count === 3)) {
      next.add(cell);
    }
  }

  return next;
}

// ---------------- BROADCAST ----------------
function broadcast() {
  const cells = [...liveCells].map(c => {
    const [x, y] = c.split(",").map(Number);
    return { x, y };
  });

  const msg = JSON.stringify({
    type: "state",
    cells,
    paused,
  });

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

// ---------------- LOOP CONTROL ----------------
function tick() {
  if (paused) return;
  liveCells = nextGeneration(liveCells);
  broadcast();
}

function startLoop() {
  if (loop) clearInterval(loop);
  loop = setInterval(tick, refreshTime);
}

// ---------------- PATTERN API ----------------
app.get("/patterns", (req, res) => {
  const files = fs.readdirSync("patterns")
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json", ""));

  res.json(files);
});

app.get("/load", (req, res) => {
  const name = req.query.name;
  const data = JSON.parse(fs.readFileSync(`patterns/${name}.json`));
  res.json(data);
});

app.post("/savePattern", (req, res) => {
  const { name, cells } = req.body;

  if (!name || !Array.isArray(cells)) {
    return res.status(400).json({ error: "Invalid pattern format" });
  }

  fs.writeFileSync(
    `patterns/${name}.json`,
    JSON.stringify(cells, null, 2)
  );

  res.json({ ok: true });
});

// ---------------- SPEED CONTROL ----------------
app.post("/changeRefreshTime", (req, res) => {
  const time = Number(req.body.time);

  if (!Number.isFinite(time) || time < 10) {
    return res.status(400).json({
      error: "Invalid time (must be >= 10)"
    });
  }

  refreshTime = Math.floor(time);
  startLoop();

  res.json({ ok: true, refreshTime });
});

app.delete("/deletePattern", (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: "Missing name" });

  const path = `patterns/${name}.json`;

  if (!fs.existsSync(path)) {
    return res.status(404).json({ error: "Pattern not found" });
  }

  fs.unlinkSync(path);

  res.json({ ok: true });
});

// ---------------- WEBSOCKET ----------------
wss.on("connection", ws => {
  broadcast();

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "set") {
      const k = key(msg.x, msg.y);

      if (msg.value) liveCells.add(k);
      else liveCells.delete(k);

      broadcast();
    }

    if (msg.type === "pause") {
      paused = !paused;
      broadcast();
    }

    if (msg.type === "step") {
      liveCells = nextGeneration(liveCells);
      broadcast();
    }

    if (msg.type === "reset") {
      liveCells.clear();
      paused = true;
      broadcast();
    }
  });
});

// ---------------- START ----------------
startLoop();

server.listen(3000, () => {
  console.log("http://localhost:3000");
});