# Life Editor

**Version:** 1.0.1.1  
A real-time, touch-friendly Conway’s Game of Life editor with live WebSocket synchronization, pattern saving/loading, and advanced canvas interaction (pan, zoom, and pinch support).

---

## 🚀 Overview

Life Editor is an interactive simulation of Conway’s Game of Life built with a Node.js backend and a canvas-based frontend. It supports real-time editing, pattern management, and responsive controls designed for both desktop and mobile devices.

The simulation runs on a shared WebSocket state, meaning all connected clients see updates instantly.

---

## ✨ Features

### 🧬 Simulation
- Classic Conway’s Game of Life rules
- Real-time updates via WebSocket
- Play / Pause / Step control
- Adjustable simulation speed

### 🎨 Interactive Editor
- Draw and erase live cells
- Pan and zoom large grids smoothly
- Pinch-to-zoom support on mobile
- Ghost pattern preview placement
- Grid overlay at higher zoom levels

### 📦 Pattern System
- Save selected regions as reusable patterns
- Load patterns from local storage (server filesystem)
- Delete saved patterns
- Pattern selection dropdown UI

### 📱 Mobile Support
- Touch-first interaction system
- Multi-touch pan + pinch zoom
- Large touch targets for controls
- Responsive UI layout

### ⚙️ Advanced Controls
- Random generation tool
- Clear / reset grid
- Adjustable simulation speed slider
- Tool toggle (draw / erase mode)

---

## 🧱 Tech Stack

- **Backend:** Node.js, Express
- **Realtime:** WebSockets (`ws`)
- **Frontend:** Vanilla JavaScript
- **Rendering:** HTML5 Canvas
- **Storage:** File system (JSON pattern files)

---

## 📂 Project Structure

```

Conway-s-Game-of-Life/
|-- Exemples-images/
|  +-- SpaceShip.png
|-- patterns*/
|  |-- 1-2-3.json
|  |-- 1-2-3-4.json
|  |-- 101.json
|  |-- 119P4H1V0.json
|  |-- 135-degree MWSS-to-G.json
|  +-- 180-degree kickback.json
|-- public/
|  |-- client.js
|  |-- index.html
|  +-- style.css
|-- .gitignore
|-- LICENSE
|-- package.json
|-- package-lock.json
|-- README.md
+-- server.js
```

---

## ⚡ Installation & Run

### 1. Install dependencies
```bash
npm install express ws
```

### 2. Start server

```bash
node server.js
```

### 3. Open in browser

```
http://localhost:3000
```

---

## 🖱 Controls

### Mouse / Touch

* **Drag (single finger / mouse):** draw or erase cells
* **Two fingers:** pan + zoom
* **Tap (ghost mode):** place pattern preview
* **Pinch:** zoom in/out

### UI Buttons

* ▶ Play / Pause simulation
* ⏭ Step forward one generation
* ⟲ Reset grid
* ✏️ / 🧹 Toggle draw & erase mode
* Load / Save / Delete patterns
* Random generation
* Speed slider

---

## ⚠️ Performance Notice

This project performs best on desktop browsers.

On **mobile devices**, especially older or low-power phones:

* Rendering large grids may become slow
* Pinch/zoom + canvas updates can cause frame drops
* High-density simulations may reduce responsiveness

For best results:

* Reduce active cell count on mobile
* Use moderate zoom levels
* Avoid rapid random generation

---

## 🧠 Future Improvements

* GPU-accelerated rendering (WebGL)
* Chunked simulation updates for performance
* IndexedDB pattern storage (client-side persistence)
* Infinite world optimization (spatial hashing improvements)
* Multi-user collaborative editing

---

## 📜 License

MIT License — feel free to use, modify, and extend.

## Version History

- **V1.0.1.1**: Mobile performance optimizations, including reduced rendering load and improved touch responsiveness. Removed the bug causing slowdowns on mobile devices when many cells are active. Security patch for WebSocket handling to prevent potential vulnerabilities.
- **V1.0.1.0**: Added pinch-to-zoom support on mobile devices, improved pattern management UI, and optimized WebSocket synchronization for better performance.
- **V1.0.0.2**: Initial release with core simulation, interactive editor, pattern saving/loading, and basic mobile support.
- **V1.0.0.1**: Initial development phase with basic simulation logic and WebSocket setup (not released).
- **V1.0.0.0**: Project initialization and setup (not released).