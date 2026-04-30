/**
 * scripts/compile-mind.mjs
 *
 * Biên dịch nhiều PNG marker thành MỘT file `targets.mind` đa-target,
 * dùng playwright-core (msedge headless).
 *
 * Mỗi index trong MARKERS = `targetIndex` mà engine sẽ `addAnchor(index)`.
 *
 *   npm run compile-mind
 */
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// THỨ TỰ Ở ĐÂY = targetIndex trong code. Giữ trùng với src/models.js.
const MARKERS = [
  "public/assets/targets/images/spinosaurus-floor.png", // index 0
  "public/assets/targets/images/spinosaurus-wall.png",  // index 1
  "public/assets/targets/images/triceratops-floor.png", // index 2
  "public/assets/targets/images/triceratops-wall.png",  // index 3
];

const OUT = "public/assets/targets/targets.mind";

const HTML = `<!doctype html><meta charset="utf-8">
<script type="module">
  import "/mindar-image.prod.js";
  window.__compile = async (b64Array) => {
    const imgs = [];
    for (const b64 of b64Array) {
      const blob = await (await fetch("data:image/png;base64," + b64)).blob();
      const url = URL.createObjectURL(blob);
      imgs.push(await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      }));
    }
    const compiler = new window.MINDAR.IMAGE.Compiler();
    await compiler.compileImageTargets(imgs, () => {});
    return Array.from(new Uint8Array(compiler.exportData()));
  };
<\/script>`;

(async () => {
  const distDir = resolve(ROOT, "node_modules/mind-ar/dist");
  const server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(HTML);
      return;
    }
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

  console.log("[compile] reading PNGs:");
  const b64s = MARKERS.map((rel, i) => {
    const abs = resolve(ROOT, rel);
    const b64 = readFileSync(abs).toString("base64");
    console.log(`  [${i}] ${rel}  (${(b64.length / 1024).toFixed(1)}KB b64)`);
    return b64;
  });

  console.log("[compile] compiling multi-target .mind ...");
  const arr = await page.evaluate(async (bs) => await window.__compile(bs), b64s);
  const buf = Buffer.from(arr);
  const outAbs = resolve(ROOT, OUT);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, buf);
  console.log(`\nWrote ${OUT}  (${(buf.byteLength / 1024).toFixed(1)} KB, ${MARKERS.length} targets)`);

  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
