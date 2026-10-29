import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import os from "node:os";
import { AUTOFIT_SCRIPT_TAG } from "./autofit.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf"
};

const LIVE_RELOAD_SCRIPT = `
<script>
(() => {
  const source = new EventSource('/__posterframes_reload');
  source.onmessage = (event) => {
    if (event.data === 'reload') {
      console.log('[posterframes] File changed, reloading...');
      window.location.reload();
    }
  };
  source.onerror = () => {
    setTimeout(() => {
      source.close();
      window.location.reload();
    }, 1500);
  };
})();
</script>
`;

function getStudioWorkbenchHtml(mainFile, width, height) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Posterframes Studio — Live Viewport Workbench</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Space+Mono:wght@700&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #09090b;
      color: #f4f4f5;
      margin: 0;
      padding: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .workbench-stage {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
      overflow: auto;
      background: radial-gradient(circle at 50% 50%, #18181b 0%, #09090b 100%);
      padding: 40px;
    }
    .artboard-container {
      width: ${width}px;
      height: ${height}px;
      transform-origin: center center;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1);
      transition: transform 0.15s ease-out;
      background: #fff;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    }
  </style>
</head>
<body>
  
  <!-- Studio Top Toolbar -->
  <header class="h-14 border-b border-white/10 px-6 flex items-center justify-between bg-zinc-950/80 backdrop-blur-md z-50">
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2">
        <span class="w-3 h-3 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="font-extrabold tracking-tight text-white text-lg">Posterframes Studio</span>
      </div>
      <span class="text-xs px-2.5 py-1 rounded-full bg-white/10 text-zinc-300 font-mono font-semibold">
        ${width} × ${height} px
      </span>
    </div>

    <!-- Zoom & Viewport Controls -->
    <div class="flex items-center gap-2">
      <button onclick="setZoomMode('fit')" id="btn-fit" class="px-3 py-1 rounded-lg text-xs font-bold bg-white text-black transition-all">
        Fit Viewport
      </button>
      <button onclick="setZoomMode('100')" id="btn-100" class="px-3 py-1 rounded-lg text-xs font-bold bg-white/10 text-zinc-300 hover:bg-white/20 transition-all">
        100% Actual
      </button>
      <button onclick="setZoomMode('75')" id="btn-75" class="px-3 py-1 rounded-lg text-xs font-bold bg-white/10 text-zinc-300 hover:bg-white/20 transition-all">
        75%
      </button>
      <button onclick="setZoomMode('50')" id="btn-50" class="px-3 py-1 rounded-lg text-xs font-bold bg-white/10 text-zinc-300 hover:bg-white/20 transition-all">
        50%
      </button>
      <div class="h-4 w-px bg-white/15 mx-2"></div>
      <a href="/__raw/${mainFile}" target="_blank" class="px-3 py-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex items-center gap-1.5">
        Raw HTML ↗
      </a>
    </div>
  </header>

  <!-- Interactive Studio Artboard Workbench -->
  <main class="workbench-stage" id="stage">
    <div class="artboard-container" id="artboard">
      <iframe src="/__raw/${mainFile}" id="posterFrame" title="Poster Preview"></iframe>
    </div>
  </main>

  <script>
    const artboard = document.getElementById('artboard');
    const stage = document.getElementById('stage');
    const posterWidth = ${width};
    const posterHeight = ${height};
    let currentMode = 'fit';

    function calculateFitScale() {
      const stageW = stage.clientWidth - 80;
      const stageH = stage.clientHeight - 80;
      const scaleX = stageW / posterWidth;
      const scaleY = stageH / posterHeight;
      return Math.min(scaleX, scaleY, 1);
    }

    function applyScale(scale) {
      artboard.style.transform = \`scale(\${scale})\`;
    }

    function setZoomMode(mode) {
      currentMode = mode;
      document.querySelectorAll('#btn-fit, #btn-100, #btn-75, #btn-50').forEach(btn => {
        btn.className = 'px-3 py-1 rounded-lg text-xs font-bold bg-white/10 text-zinc-300 hover:bg-white/20 transition-all';
      });
      document.getElementById('btn-' + mode).className = 'px-3 py-1 rounded-lg text-xs font-bold bg-white text-black transition-all';

      if (mode === 'fit') {
        applyScale(calculateFitScale());
      } else if (mode === '100') {
        applyScale(1);
      } else if (mode === '75') {
        applyScale(0.75);
      } else if (mode === '50') {
        applyScale(0.5);
      }
    }

    window.addEventListener('resize', () => {
      if (currentMode === 'fit') {
        applyScale(calculateFitScale());
      }
    });

    // Auto-fit on initial load
    window.addEventListener('DOMContentLoaded', () => {
      setZoomMode('fit');
    });

    // Live reload listener
    const source = new EventSource('/__posterframes_reload');
    source.onmessage = (event) => {
      if (event.data === 'reload') {
        console.log('[studio] Live reloading poster frame...');
        document.getElementById('posterFrame').contentWindow.location.reload();
      }
    };
  </script>
</body>
</html>`;
}

/**
 * Start a live-reloading static preview server for a poster directory or file.
 */
export function startPreviewServer(targetPath, port = 3000, autoOpen = true) {
  const stat = fs.statSync(targetPath);
  const rootDir = stat.isDirectory() ? path.resolve(targetPath) : path.dirname(path.resolve(targetPath));
  const mainFile = stat.isDirectory() ? "poster.html" : path.basename(targetPath);

  const clients = new Set();

  // Watch root directory for changes
  let debounceTimer = null;
  fs.watch(rootDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const ext = path.extname(filename).toLowerCase();
    if (ext === ".png" || ext === ".pdf" || ext === ".jpg" || filename.includes(".git")) {
      return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log(`[posterframes] Change detected in ${filename}. Refreshing preview...`);
      for (const client of clients) {
        client.write("data: reload\n\n");
      }
    }, 150);
  });

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://localhost:${port}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // Live reload SSE endpoint
    if (pathname === "/__posterframes_reload") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      res.write("data: connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    // Default route: Serve the Studio Workbench with auto-fitting viewport!
    if (pathname === "/" || pathname === "" || pathname === "/studio") {
      const fullPath = path.join(rootDir, mainFile);
      let content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf-8") : "";
      const matchVarW = content.match(/--W:\s*(\d+)px/);
      const matchVarH = content.match(/--H:\s*(\d+)px/);
      const matchW = matchVarW || content.match(/data-width=["'](\d+)["']/) || content.match(/width:\s*(\d+)px/);
      const matchH = matchVarH || content.match(/data-height=["'](\d+)["']/) || content.match(/height:\s*(\d+)px/);
      const w = matchW ? parseInt(matchW[1], 10) : 1131;
      const h = matchH ? parseInt(matchH[1], 10) : 1600;

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getStudioWorkbenchHtml(mainFile, w, h));
      return;
    }

    // Raw file route for iframe and renderer
    let isRaw = false;
    if (pathname.startsWith("/__raw/")) {
      pathname = pathname.replace("/__raw/", "/");
      isRaw = true;
    }

    const filePath = path.join(rootDir, pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`Not found: ${pathname}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    if (ext === ".html") {
      let content = fs.readFileSync(filePath, "utf-8");
      const injectedScripts = `${AUTOFIT_SCRIPT_TAG}\n${LIVE_RELOAD_SCRIPT}`;
      if (content.includes("</body>")) {
        content = content.replace("</body>", `${injectedScripts}</body>`);
      } else {
        content += injectedScripts;
      }
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}/`;
    console.log(`\n🎨 [posterframes] Studio Preview Workbench running at:`);
    console.log(`👉 ${url}`);
    console.log(`Press Ctrl+C to stop the server.\n`);

    if (autoOpen) {
      const startCmd =
        os.platform() === "win32"
          ? `start "" "${url}"`
          : os.platform() === "darwin"
            ? `open "${url}"`
            : `xdg-open "${url}"`;
      exec(startCmd, () => {});
    }
  });

  return server;
}
