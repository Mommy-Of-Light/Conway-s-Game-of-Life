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

if (!fs.existsSync("patterns")) fs.mkdirSync("patterns");

// ---------------- STATE ----------------
const key = (x, y) => `${x},${y}`;

let liveCells = new Set();
let paused = false;
let refreshTime = 120;
let loop = null;

// ---------------- START PATTERN ----------------
[
  [1,0],[2,1],[0,2],[1,2],[2,2]
].forEach(([x,y]) => liveCells.add(key(x,y)));

// ---------------- GAME ----------------
function nextGeneration(cells) {
  const counts = new Map();

  for (const cell of cells) {
    const [x, y] = cell.split(",").map(Number);

    for (let dx=-1; dx<=1; dx++) {
      for (let dy=-1; dy<=1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const k = key(x+dx, y+dy);
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

// ---------------- THROTTLED BROADCAST ----------------
let lastBroadcast = 0;
function broadcast(force = false) {
  const now = Date.now();
  if (!force && now - lastBroadcast < 50) return;
  lastBroadcast = now;

  const cells = [...liveCells].map(c => {
    const [x,y] = c.split(",").map(Number);
    return { x, y };
  });

  const msg = JSON.stringify({ type:"state", cells, paused });

  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

// ---------------- LOOP ----------------
function tick() {
  if (!paused) {
    liveCells = nextGeneration(liveCells);
    broadcast();
  }
}

function startLoop() {
  if (loop) clearInterval(loop);
  loop = setInterval(tick, refreshTime);
}

// ---------------- API ----------------
app.get("/patterns", (req,res) => {
  const files = fs.readdirSync("patterns")
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json",""));
  res.json(files);
});

app.get("/load", (req,res) => {
  const name = req.query.name;
  const data = JSON.parse(fs.readFileSync(`patterns/${name}.json`));
  res.json(data);
});

app.post("/savePattern", (req,res) => {
  const { name, cells } = req.body;
  if (!name || !Array.isArray(cells)) return res.status(400).end();

  fs.writeFileSync(`patterns/${name}.json`, JSON.stringify(cells));
  res.json({ ok:true });
});

app.delete("/deletePattern", (req,res) => {
  const name = req.query.name;
  fs.unlinkSync(`patterns/${name}.json`);
  res.json({ ok:true });
});

app.post("/changeRefreshTime", (req,res) => {
  refreshTime = Math.max(20, Number(req.body.time));
  startLoop();
  res.json({ ok:true });
});

// ---------------- WS ----------------
wss.on("connection", ws => {
  broadcast(true);

  ws.on("message", raw => {
    const msg = JSON.parse(raw);

    if (msg.type === "set") {
      const k = key(msg.x, msg.y);
      msg.value ? liveCells.add(k) : liveCells.delete(k);
      broadcast();
    }

    if (msg.type === "pause") paused = !paused;
    if (msg.type === "step") liveCells = nextGeneration(liveCells);
    if (msg.type === "reset") { liveCells.clear(); paused = true; }

    broadcast(true);
  });
});

startLoop();

server.listen(3001, () => console.log("http://localhost:3001"));