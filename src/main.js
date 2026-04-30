/**
 * src/main.js – Entry point CUSC-AR
 *
 * Chỉ còn 1 chế độ: image marker + hybrid (lock + gyro).
 * Mọi data model nằm ở src/models.js, mọi tham số engine ở src/ar-config.js.
 */

import AR_CONFIG from "./ar-config.js";
import MODELS from "./models.js";
import { HybridAREngine } from "./ar-engine-hybrid.js";

const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const uiOverlay = document.getElementById("ui-overlay");
const arContainer = document.getElementById("ar-container");

const setProgress = (msg) => {
  if (loadingText) loadingText.textContent = msg;
};

async function bootstrap() {
  console.log("[CUSC-AR] models =", MODELS.map((m) => m.id).join(", "));

  const engine = new HybridAREngine(arContainer, AR_CONFIG, MODELS);

  try {
    await engine.init(setProgress);
    await engine.start();
  } catch (err) {
    console.error("[CUSC-AR] init failed:", err);
    setProgress("Lỗi: " + (err?.message ?? err));
    return;
  }

  // Debug overlay (ẩn mặc định, toggle bằng nút #btn-debug)
  const debugEl = document.getElementById("debug-overlay");
  if (debugEl && engine.enableDebug) engine.enableDebug(debugEl);
  const debugBtn = document.getElementById("btn-debug");
  if (debugBtn && debugEl) {
    debugBtn.addEventListener("click", () => {
      const willShow = debugEl.hasAttribute("hidden");
      if (willShow) debugEl.removeAttribute("hidden");
      else debugEl.setAttribute("hidden", "");
      debugBtn.classList.toggle("active", willShow);
    });
  }

  loadingOverlay.style.display = "none";
  uiOverlay.style.display = "block";
  document.body.classList.add("mode-image");

  // Scan status hiển thị marker hiện tại đang quét
  const scanStatus = document.getElementById("scan-status");
  engine.setOnStatus?.((s) => {
    if (!scanStatus) return;
    if (s.stage === "scanning" || s.stage === "switching") {
      scanStatus.textContent = `Đang quét: ${s.markerName ?? "…"}`;
      scanStatus.classList.remove("tracking");
    } else if (s.stage === "tracking") {
      scanStatus.textContent = `Thấy: ${s.markerName ?? ""}`;
      scanStatus.classList.add("tracking");
    } else if (s.stage === "snapshot") {
      scanStatus.textContent = `Quan sát: ${s.markerName ?? ""}`;
      scanStatus.classList.add("tracking");
    }
  });

  // ===== Reset =====
  document.getElementById("btn-reset")?.addEventListener("click", async () => {
    await engine.resetLock();
    const hint = document.getElementById("scan-hint");
    if (hint) hint.style.display = "flex";
    const gyroBtn = document.getElementById("btn-gyro");
    if (gyroBtn) {
      gyroBtn.classList.remove("active");
      gyroBtn.textContent = "Quan sát";
      gyroBtn.disabled = false;
    }
    document.getElementById("info-popup")?.classList.remove("visible");
    document.getElementById("model-controls")?.classList.remove("visible");
  });

  // ===== Quan sát (gyro) =====
  const gyroBtn = document.getElementById("btn-gyro");
  if (gyroBtn) {
    gyroBtn.style.display = "block";
    gyroBtn.addEventListener("click", async () => {
      if (engine.isGyroEnabled?.()) return;
      // Yêu cầu phải có marker đang được tracking trước khi snapshot
      if (!engine.hasTracking?.()) {
        gyroBtn.textContent = "Cần quét marker trước";
        setTimeout(() => (gyroBtn.textContent = "Quan sát"), 1800);
        return;
      }
      gyroBtn.disabled = true;
      const ok = await engine.enableGyro();
      gyroBtn.disabled = false;
      if (ok) {
        gyroBtn.classList.add("active");
        gyroBtn.textContent = "Đang quan sát";
        document.getElementById("model-controls")?.classList.add("visible");
      } else {
        gyroBtn.textContent = "Gyro lỗi";
        setTimeout(() => (gyroBtn.textContent = "Quan sát"), 1800);
      }
    });
  }

  // ===== Popup info khi tap vào model =====
  const popup = document.getElementById("info-popup");
  const popupTitle = document.getElementById("info-title");
  const popupDesc = document.getElementById("info-desc");
  const popupClose = document.getElementById("info-close");

  engine.setOnTapItem?.((item) => {
    const info = item?.def?.info;
    if (!info || !popup) return;
    popupTitle.textContent = info.title || "";
    popupDesc.textContent = info.description || "";
    popup.classList.add("visible");
    popup.setAttribute("aria-hidden", "false");
  });
  popupClose?.addEventListener("click", () => {
    popup?.classList.remove("visible");
    popup?.setAttribute("aria-hidden", "true");
  });

  // ===== Cụm điều khiển model (xoay + zoom) =====
  const controls = document.getElementById("model-controls");
  if (controls) {
    const ROT_STEP = 0.06;
    const ZOOM_STEP = 1.04;
    const TICK_MS = 30;
    const actMap = {
      "rot-left":  () => engine.rotateModel?.( ROT_STEP),
      "rot-right": () => engine.rotateModel?.(-ROT_STEP),
      "zoom-in":   () => engine.zoomModel?.(ZOOM_STEP),
      "zoom-out":  () => engine.zoomModel?.(1 / ZOOM_STEP),
    };
    controls.querySelectorAll(".ctrl-btn").forEach((btn) => {
      const fn = actMap[btn.dataset.act];
      if (!fn) return;
      let timer = null;
      const start = (e) => {
        e.preventDefault();
        if (timer) return;
        fn();
        timer = setInterval(fn, TICK_MS);
      };
      const stop = () => {
        if (timer) { clearInterval(timer); timer = null; }
      };
      btn.addEventListener("pointerdown", start);
      btn.addEventListener("pointerup", stop);
      btn.addEventListener("pointerleave", stop);
      btn.addEventListener("pointercancel", stop);
    });
  }

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) await engine.stop();
    else await engine.start();
  });
}

bootstrap();
