/**
 * main.js – Entry point cho CUSC-AR
 *
 * Mode được chọn bởi AR_CONFIG.mode:
 *   - "image": MindAR image tracking (model bám vào ảnh marker)
 *   - "world": Gyro – model đặt cố định trong phòng ảo quanh user
 */

import AR_CONFIG from "./ar-config.js";
import { AREngine } from "./ar-engine.js";
import { HybridAREngine } from "./ar-engine-hybrid.js";
import { GyroAREngine } from "./ar-engine-gyro.js";

const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const uiOverlay = document.getElementById("ui-overlay");
const arContainer = document.getElementById("ar-container");

const setProgress = (msg) => {
  if (loadingText) loadingText.textContent = msg;
};

async function startImageMode() {
  // Mặc định dùng HybridAREngine: marker chỉ là "điểm spawn + scale".
  // Model được khoá vào không gian, không biến mất khi marker khuất / xiên.
  // Đặt AR_CONFIG.mode = "image-strict" để dùng AREngine cũ (model bám phẳng trên marker).
  const useHybrid = AR_CONFIG.mode !== "image-strict";
  const engine = useHybrid
    ? new HybridAREngine(arContainer, AR_CONFIG)
    : new AREngine(arContainer, AR_CONFIG);

  await engine.init(setProgress);
  await engine.start();

  // Bật debug overlay
  const debugEl = document.getElementById("debug-overlay");
  if (debugEl && engine.enableDebug) engine.enableDebug(debugEl);

  // Status pill
  const statusEl = document.getElementById("scan-status");
  if (statusEl && engine.setOnStatus) {
    engine.setOnStatus((s) => {
      statusEl.textContent = s;
      statusEl.classList.toggle("tracking", /Thấy/.test(s));
    });
  }

  // Debug panel: toggle + tabs + actions
  const debugPanel = document.getElementById("debug-panel");
  const btnDebug = document.getElementById("btn-debug");
  btnDebug?.addEventListener("click", () => {
    if (!debugPanel) return;
    debugPanel.hidden = !debugPanel.hidden;
  });
  document.querySelectorAll(".dbg-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".dbg-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      engine.setDebugMode?.(tab.dataset.mode);
    });
  });
  const dbgForce = document.getElementById("dbg-force");
  dbgForce?.addEventListener("click", () => {
    const on = engine.toggleForceShow?.();
    dbgForce.classList.toggle("active", !!on);
  });
  document.getElementById("dbg-cycle")?.addEventListener("click", () => {
    const txt = engine.cycleNextAnchor?.();
    if (txt) statusEl && (statusEl.textContent = `[debug] ${txt}`);
  });
  document.getElementById("dbg-snap")?.addEventListener("click", () => {
    engine.saveSnapshot?.();
  });

  loadingOverlay.style.display = "none";
  uiOverlay.style.display = "block";
  document.body.classList.add("mode-image");

  const anchors = engine.getAnchors();
  anchors.forEach(({ anchor }, index) => {
    const origFound = anchor.onTargetFound;
    const origLost = anchor.onTargetLost;
    anchor.onTargetFound = () => {
      origFound?.();
      const hint = document.getElementById("scan-hint");
      if (hint) hint.style.display = "none";
    };
    anchor.onTargetLost = () => {
      origLost?.();
      // Hybrid: KHÔNG hiện lại scan hint vì model vẫn còn đó
      if (!useHybrid) {
        const hint = document.getElementById("scan-hint");
        if (hint) hint.style.display = "flex";
      }
    };
  });

  // Reset = scan lại (chỉ áp dụng hybrid)
  if (useHybrid) {
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
      // Ẩn popup khi reset
      const popup = document.getElementById("info-popup");
      popup?.classList.remove("visible");
      popup?.setAttribute("aria-hidden", "true");
      // Ẩn cụm điều khiển model
      document.getElementById("model-controls")?.classList.remove("visible");
    });

    // Nút "Quan sát" – user chủ động bật gyro sau khi đã chỉnh xong góc nhìn
    const gyroBtn = document.getElementById("btn-gyro");
    if (gyroBtn) {
      gyroBtn.style.display = "block";
      gyroBtn.textContent = "Quan sát";
      gyroBtn.addEventListener("click", async () => {
        if (engine.isGyroEnabled?.()) return;
        gyroBtn.disabled = true;
        const ok = await engine.enableGyro();
        gyroBtn.disabled = false;
        if (ok) {
          gyroBtn.classList.add("active");
          gyroBtn.textContent = "Đang quan sát";
          document.getElementById("model-controls")?.classList.add("visible");
        } else {
          gyroBtn.textContent = "Gyro lỗi";
          // Vẫn cho điều khiển model thủ công
          document.getElementById("model-controls")?.classList.add("visible");
        }
      });
    }

    // Popup info: hiển thị khi tap vào model
    const popup = document.getElementById("info-popup");
    const popupTitle = document.getElementById("info-title");
    const popupDesc = document.getElementById("info-desc");
    const popupClose = document.getElementById("info-close");

    const showPopup = (item) => {
      const info = item?.def?.info;
      if (!info || !popup) return;
      popupTitle.textContent = info.title || "";
      popupDesc.textContent = info.description || "";
      popup.classList.add("visible");
      popup.setAttribute("aria-hidden", "false");
    };
    const hidePopup = () => {
      popup?.classList.remove("visible");
      popup?.setAttribute("aria-hidden", "true");
    };

    engine.setOnTapItem?.(showPopup);
    popupClose?.addEventListener("click", hidePopup);

    // Cụm nút điều khiển model (xoay quanh up + zoom)
    const modelControls = document.getElementById("model-controls");
    if (modelControls) {
      const ROT_STEP = 0.06;          // rad/tick (~3.4°)
      const ZOOM_STEP = 1.04;         // /tick
      const TICK_MS = 30;
      const actMap = {
        "rot-left":  () => engine.rotateModel?.( ROT_STEP),
        "rot-right": () => engine.rotateModel?.(-ROT_STEP),
        "zoom-in":   () => engine.zoomModel?.(ZOOM_STEP),
        "zoom-out":  () => engine.zoomModel?.(1 / ZOOM_STEP),
      };
      modelControls.querySelectorAll(".ctrl-btn").forEach((btn) => {
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
  }

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) await engine.stop();
    else await engine.start();
  });
}

async function startWorldMode() {
  const engine = new GyroAREngine(arContainer, AR_CONFIG);
  await engine.init(setProgress);
  engine.start();

  const models = AR_CONFIG.worldTracking?.models ?? [];
  const picker = document.getElementById("model-picker");
  if (picker && models.length > 1) {
    models.forEach((m, i) => {
      const btn = document.createElement("button");
      btn.className = "picker-btn" + (i === 0 ? " active" : "");
      btn.textContent = m.name || m.id;
      btn.addEventListener("click", () => {
        picker.querySelectorAll(".picker-btn").forEach((b) =>
          b.classList.remove("active")
        );
        btn.classList.add("active");
        engine.lookAtModel(i);
      });
      picker.appendChild(btn);
    });
  } else if (picker) {
    picker.style.display = "none";
  }

  document
    .getElementById("btn-reset")
    ?.addEventListener("click", () => engine.lookAtModel(0));

  const gyroBtn = document.getElementById("btn-gyro");
  gyroBtn?.addEventListener("click", async () => {
    const ok = await engine.enableGyro();
    if (ok) {
      gyroBtn.classList.add("active");
      gyroBtn.textContent = "Gyro ✓";
    }
  });

  window.addEventListener("pagehide", () => engine.dispose());

  loadingOverlay.style.display = "none";
  uiOverlay.style.display = "block";
  document.body.classList.add("mode-world");
}

async function bootstrap() {
  try {
    const mode = AR_CONFIG.mode === "world" ? "world" : "image";
    console.log("[CUSC-AR] mode =", mode);
    if (mode === "world") await startWorldMode();
    else await startImageMode();
  } catch (err) {
    console.error("CUSC-AR init failed:", err);
    setProgress("Lỗi: " + err.message);
  }
}

bootstrap();
