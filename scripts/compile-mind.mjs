/**
 * scripts/compile-mind.mjs
 *
 * Biên dịch từng PNG marker thành 1 file .mind RIÊNG BIỆT, chạy trong
 * msedge headless (playwright-core) để tránh phải build node-canvas trên Windows.
 *
 * Chạy:  npm run compile-mind
 */
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const MARKERS = [
  { png: "public/assets/targets/images/spinosaurus-floor.png",
    mind: "public/assets/targets/spinosaurus-floor.mind" },
  { png: "public/assets/targets/images/spinosaurus-wall.png",
    mind: "public/assets/targets/spinosaurus-wall.mind" },
  { png: "public/assets/targets/images/triceratops-floor.png",
    mind: "public/assets/targets/triceratops-floor.mind" },
  { png: "public/assets/targets/images/triceratops-wall.png",
    mind: "public/assets/targets/triceratops-wall.mind" },
];

const HTML = `<!doctype html><meta charset="utf-8">
<script type="module">
  import "/mindar-image.prod.js";
  window.__compile = async (b64) => {
    const blob = await (await fetch("data:image/png;base64," + b64)).blob();
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const compiler = new window.MINDAR.IMAGE.Compiler();
    await compiler.compileImageTargets([img], () => {});
    const buf = compiler.exportData();
    return Array.from(new Uint8Array(buf));
  };
<\/script>`;

const MIME = { ".js": "application/javascript", ".html": "text/html" };

(async () => {
  // Tiny static server: serve mindar bundle next to a synthesized HTML page.
  const distDir = resolve(ROOT, "node_modules/mind-ar/dist");
  const server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(HTML);
      return;
    }
    // serve any file under mind-ar/dist by basename
    try {
      const safe = req.url.replace(/^\/+/, "").split("?")[0];
      if (!/^[\w.\-]+\.js$/.test(safe)) throw new Error("bad");
      const data = readFileSync(resolve(distDir, safe));
      res.writeHead(200, { "content-type": "application/javascript" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  console.log("[compile] static server :", port);

  console.log("[compile] launching msedge headless...");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning")
      console.log("  [page-" + msg.type() + "]", msg.text());
  });
  page.on("pageerror", (err) => console.log("  [page-throw]", err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction(
    () => window.MINDAR && window.MINDAR.IMAGE && typeof window.__compile === "function",
    { timeout: 60000 }
  );

  for (const m of MARKERS) {
    const pngAbs = resolve(ROOT, m.png);
    const mindAbs = resolve(ROOT, m.mind);
    console.log(`\n[compile] ${m.png}`);
    const b64 = readFileSync(pngAbs).toString("base64");
    const arr = await page.evaluate(async (b) => await window.__compile(b), b64);
    const buf = Buffer.from(arr);
    mkdirSync(dirname(mindAbs), { recursive: true });
    writeFileSync(mindAbs, buf);
    console.log(`  → ${m.mind} (${(buf.byteLength / 1024).toFixed(1)} KB)`);
  }

  await browser.close();
  server.close();
  console.log("\nDone.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
