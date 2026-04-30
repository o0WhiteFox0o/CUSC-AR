/**
 * ar-engine-hybrid.js – Image marker = "điểm spawn + auto-scale"
 *                      → tự bật Gyro sau khi lock để xoay nhìn quanh model
 *
 * Quy trình:
 *   1. MindAR nhận marker → tính world matrix.
 *   2. Lần đầu lock: copy matrix sang wrapper trong scene root.
 *   3. Trong khi marker còn nhìn thấy: lerp mượt (model tự phóng to/thu nhỏ).
 *   4. Khi đã lock: tự bật DeviceOrientation → camera Three.js xoay theo điện thoại.
 *      Từ đây bỏ qua cập nhật MindAR (vì user nhìn quanh, không hướng vào marker).
 *   5. Reset (nút ⟳) → tắt gyro, mở lại tracking để spawn lại.
 *
 * Lưu ý: iOS Safari yêu cầu user gesture để xin quyền gyro → nếu auto bật thất bại,
 * nút "Bật Gyro" sẽ hiện để user chạm vào.
 */

import * as THREE from "three";
import { MindARThree } from "mind-ar/dist/mindar-image-three.prod.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ModelLoader } from "./model-loader.js";
import { flattenTargets } from "./models.js";

export class HybridAREngine {
  constructor(container, config) {
    this._container = container;
    this._config = config;
    this._modelLoader = new ModelLoader();
    this._clock = new THREE.Clock();
    this._mindarThree = null;
    this._items = [];
    this._running = false;

    // Gyro state
    this._gyroEnabled = false;
    this._deviceOrientation = null;
    this._screenOrientation = 0;
    /** Offset áp lên thiết bị để giữ hướng nhìn không nhảy khi switch */
    this._gyroOffset = new THREE.Quaternion();
    this._needsGyroPermissionBtn = false;

    // Tap interaction
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._tapStart = null; // {x, y, t}
    this._onTapItem = null; // callback (item) => void

    // Status + console mirror cho debug overlay
    this._onStatus = null;
    this._currentStatus = "idle";
    this._logBuffer = []; // {ts, level, text}[]
    this._installConsoleMirror();

    // Force-show / manual-cycle (debug)
    this._forceShowAll = false;
  }

  async init(onProgress = () => {}) {
    onProgress("Đang khởi tạo camera & AR engine...");

    const t = this._config.tracking ?? {};
    this._mindarThree = new MindARThree({
      container: this._container,
      imageTargetSrc: this._config.mindFile,
      filterMinCF: t.filterMinCF ?? 0.0001,
      filterBeta: t.filterBeta ?? 0.001,
      warmupTolerance: t.warmupTolerance ?? 2,
      missTolerance: t.missTolerance ?? 30,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",
    });

    const { renderer, scene, camera } = this._mindarThree;
    this._scene = scene;
    this._camera = camera;
    this._renderer = renderer;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(0.5, 1, 0.25);
    scene.add(dir);

    const globalAutoFit = this._config.autoFitSize ?? 0;
    const targets = flattenTargets();

    // Cache GLB theo modelDef.id để model 1 marker đầu tiên load, các marker
    // sau dùng `cached.scene.clone()` (tiết kiệm băng thông + RAM).
    const glbCache = new Map();

    for (const tgt of targets) {
      const def = tgt.modelDef;
      onProgress(`Đang tải model: ${def.name} (target ${tgt.targetIndex})`);
      const anchor = this._mindarThree.addAnchor(tgt.targetIndex);

      try {
        let cached = glbCache.get(def.id);
        if (!cached) {
          cached = await this._modelLoader.load(def.modelUrl, {
            ignoreNodes: def.ignoreNodes,
          });
          glbCache.set(def.id, cached);
        }
        const modelScene = cloneSkinned(cached.scene);
        const animations = cached.animations;

        // Default rotation: floor → đứng thẳng (π/2 quanh X), wall → giữ nguyên
        const defaultRotX = tgt.surface === "wall" ? 0 : Math.PI / 2;
        const p = def.position ?? { x: 0, y: 0, z: 0 };
        const r = def.rotation;
        const s = def.scale ?? { x: 1, y: 1, z: 1 };
        modelScene.position.set(p.x, p.y, p.z);
        modelScene.rotation.set(
          r?.x ?? defaultRotX,
          r?.y ?? 0,
          r?.z ?? 0
        );
        modelScene.scale.set(s.x, s.y, s.z);

        const autoFit = def.autoFitSize ?? globalAutoFit;
        if (autoFit > 0) {
          const box = new THREE.Box3().setFromObject(modelScene);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0) modelScene.scale.multiplyScalar(autoFit / maxDim);
        }

        // Inspect mesh để debug + ép DoubleSide
        const meshSummary = [];
        let meshCount = 0, totalTris = 0;
        modelScene.traverse((o) => {
          if (o.isMesh) {
            meshCount++;
            const g = o.geometry;
            const tris = g?.index
              ? g.index.count / 3
              : (g?.attributes?.position?.count ?? 0) / 3;
            totalTris += tris | 0;
            const mat = Array.isArray(o.material) ? o.material[0] : o.material;
            meshSummary.push(`${o.name}|${tris | 0}|${mat?.type ?? "?"}`);
            if (mat) {
              mat.side = THREE.DoubleSide;
              mat.needsUpdate = true;
            }
            o.frustumCulled = false;
          }
        });
        const bbox = new THREE.Box3().setFromObject(modelScene);
        const bsize = bbox.getSize(new THREE.Vector3());

        const wrapper = new THREE.Group();
        wrapper.add(modelScene);
        wrapper.visible = false;
        scene.add(wrapper);

        const item = {
          targetIndex: tgt.targetIndex,
          surface: tgt.surface,
          def,
          anchor,
          wrapper,
          modelScene,
          locked: false,
          tracking: false,
          userZoom: 1,
          glbInfo: {
            meshCount,
            totalTris,
            meshes: meshSummary,
            bbox: `${bsize.x.toFixed(2)}x${bsize.y.toFixed(2)}x${bsize.z.toFixed(2)}`,
          },
        };

        anchor.onTargetFound = () => {
          item.tracking = true;
          item.wrapper.visible = true;
          this._setStatus(`Thấy: ${def.name} (${tgt.surface === "floor" ? "sàn" : "tường"})`);
        };
        anchor.onTargetLost = () => {
          item.tracking = false;
          if (!this._items.some((i) => i.tracking)) {
            this._setStatus("Đang quét marker…");
          }
        };

        item.animations = animations;
        const animKey = def.defaultAnimation;
        const animRef = animKey && def.animations ? def.animations[animKey] : null;
        item.currentClipIndex = typeof animRef === "number" ? animRef : 0;

        if (animRef != null && animations.length > 0) {
          item.mixer = this._modelLoader.playAnimation(
            modelScene,
            animations,
            animRef
          );
        }

        this._items.push(item);
        console.log(
          `[HybridAR] +target ${tgt.targetIndex} ${def.id}/${tgt.surface} ` +
          `meshes=${meshCount} tris=${totalTris} bbox=${item.glbInfo.bbox}`
        );
      } catch (err) {
        console.error(`Không thể tải model ${def.modelUrl}:`, err);
      }
    }

    // Resize listener cho gyro
    window.addEventListener("orientationchange", () => this._updateScreenOrient());
    this._updateScreenOrient();

    // Tap-to-interact (chỉ kích hoạt khi đã lock & sang chế độ quan sát)
    this._setupTapHandler();

    renderer.setAnimationLoop(() => this._frame());

    this._setStatus("Đang quét marker…");
    onProgress("Sẵn sàng!");
  }

  _frame() {
    const delta = this._clock.getDelta();

    // Cập nhật model từ marker (chỉ khi gyro CHƯA take over)
    if (!this._gyroEnabled) {
      for (const item of this._items) {
        if (item.tracking && item.anchor.group.visible) {
          item.anchor.group.updateMatrixWorld(true);
          const m = item.anchor.group.matrixWorld;

          if (!item.locked) {
            item.wrapper.matrix.copy(m);
            item.wrapper.matrix.decompose(
              item.wrapper.position,
              item.wrapper.quaternion,
              item.wrapper.scale
            );
            item.locked = true;
          } else {
            const tp = new THREE.Vector3();
            const tq = new THREE.Quaternion();
            const ts = new THREE.Vector3();
            m.decompose(tp, tq, ts);
            item.wrapper.position.lerp(tp, 0.25);
            item.wrapper.quaternion.slerp(tq, 0.25);
            item.wrapper.scale.lerp(ts, 0.25);
          }
        }
      }
    } else {
      // Gyro đã take over: cập nhật quaternion camera theo cảm biến
      this._applyDeviceOrientation();
    }

    this._modelLoader.update(delta);
    this._renderer.render(this._scene, this._camera);

    // Debug overlay
    if (this._debugEl) this._updateDebug();
  }

  /** Bật overlay debug hiển thị global/local transform */
  enableDebug(el) {
    this._debugEl = el;
  }

  /** Đăng ký callback nhận status text (cho UI pill). */
  setOnStatus(cb) { this._onStatus = cb; this._setStatus(this._currentStatus); }
  _setStatus(s) {
    this._currentStatus = s;
    this._onStatus?.(s);
  }

  /** Capture console.log/warn/error vào _logBuffer (max 30 entries). */
  _installConsoleMirror() {
    const orig = {};
    ["log", "warn", "error", "info"].forEach((lvl) => {
      orig[lvl] = console[lvl].bind(console);
      console[lvl] = (...args) => {
        try {
          const text = args
            .map((a) => {
              if (typeof a === "string") return a;
              try { return JSON.stringify(a); } catch { return String(a); }
            })
            .join(" ");
          this._logBuffer.push({ ts: performance.now() | 0, level: lvl, text });
          if (this._logBuffer.length > 30) this._logBuffer.shift();
        } catch (_) {}
        orig[lvl](...args);
      };
    });
  }

  /** Mode hiển thị overlay debug: "stats" | "logs" | "glb" */
  setDebugMode(mode) { this._debugMode = mode; }

  _updateDebug() {
    if (!this._debugEl) return;
    const mode = this._debugMode || "stats";
    const lines = [];

    if (mode === "logs") {
      lines.push(`[LOGS] (${this._logBuffer.length} entries)`);
      const recent = this._logBuffer.slice(-20);
      for (const e of recent) {
        const t = (e.ts / 1000).toFixed(1);
        lines.push(`${t}s ${e.level.toUpperCase()}  ${e.text.slice(0, 80)}`);
      }
      this._debugEl.textContent = lines.join("\n");
      return;
    }

    if (mode === "glb") {
      lines.push(`[GLB INFO]`);
      for (const it of this._items) {
        lines.push(`--- ${it.def.id}/${it.surface} (idx ${it.targetIndex}) ---`);
        lines.push(`  meshes=${it.glbInfo.meshCount}  tris=${it.glbInfo.totalTris}`);
        lines.push(`  bbox=${it.glbInfo.bbox}`);
        it.glbInfo.meshes.slice(0, 3).forEach((s) => lines.push(`  · ${s}`));
        if (it.glbInfo.meshes.length > 3) {
          lines.push(`  · …+${it.glbInfo.meshes.length - 3}`);
        }
      }
      this._debugEl.textContent = lines.join("\n");
      return;
    }

    // mode === "stats" (default): tracking + transform stats
    const fmt = (v) => `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
    lines.push(
      `gyro=${this._gyroEnabled} force=${this._forceShowAll}  status=${this._currentStatus}`
    );
    if (this._camera) {
      lines.push(
        `cam pos=${fmt(this._camera.position)}  near=${this._camera.near.toFixed(0)} far=${this._camera.far.toFixed(0)}`
      );
    }
    if (this._renderer) {
      const sz = this._renderer.getSize(new THREE.Vector2());
      lines.push(
        `renderer ${sz.x}x${sz.y}  pr=${this._renderer.getPixelRatio().toFixed(2)}`
      );
    }
    for (const it of this._items) {
      const tag = it.tracking ? "✓" : "·";
      lines.push(
        `${tag} idx${it.targetIndex} ${it.def.id}/${it.surface}  locked=${it.locked} vis=${it.wrapper.visible}`
      );
      if (it.tracking || it.locked || it.wrapper.visible) {
        it.wrapper.updateMatrixWorld(true);
        const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
        it.wrapper.matrixWorld.decompose(wp, wq, ws);
        lines.push(`   wrap.world pos=${fmt(wp)} scale=${fmt(ws)}`);
      }
    }
    this._debugEl.textContent = lines.join("\n");
  }

  // ===== Mobile test helpers =======================================
  /** Bật/tắt force-show: hiện toàn bộ wrapper bất kể tracking. */
  toggleForceShow() {
    this._forceShowAll = !this._forceShowAll;
    if (this._forceShowAll) {
      // Đặt mỗi wrapper ở trước camera, cách 1 marker-width, để dễ thấy
      this._items.forEach((it, i) => {
        it.wrapper.visible = true;
        it.wrapper.position.set((i - (this._items.length - 1) / 2) * 0.5, 0, -1);
        it.wrapper.quaternion.identity();
        it.wrapper.scale.set(0.3, 0.3, 0.3);
        it.locked = true; // ngăn frame loop ghi đè
      });
    } else {
      // Trả về scan mode
      this._items.forEach((it) => {
        it.wrapper.visible = false;
        it.locked = false;
        it.tracking = false;
      });
    }
    return this._forceShowAll;
  }

  /** Quét vòng anchor: hiện 1 model duy nhất ở vị trí giữa camera (debug). */
  cycleNextAnchor() {
    if (!this._items.length) return;
    this._cycleIdx = (this._cycleIdx ?? -1) + 1;
    if (this._cycleIdx >= this._items.length) this._cycleIdx = 0;
    this._items.forEach((it, i) => {
      const active = i === this._cycleIdx;
      it.wrapper.visible = active;
      it.locked = active;
      if (active) {
        it.wrapper.position.set(0, 0, -1);
        it.wrapper.quaternion.identity();
        it.wrapper.scale.set(0.3, 0.3, 0.3);
      }
    });
    const it = this._items[this._cycleIdx];
    return `${it.def.id}/${it.surface} (idx ${it.targetIndex})`;
  }

  /** Tải snapshot canvas hiện tại về máy (PNG). */
  saveSnapshot() {
    if (!this._renderer) return;
    // Lấy canvas của MindAR (bao gồm video bg) thay vì chỉ renderer
    const canvases = this._container.querySelectorAll("canvas");
    if (!canvases.length) return;
    // Compose tất cả canvas vào 1 canvas tạm
    const main = canvases[canvases.length - 1];
    const w = main.width, h = main.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d");
    canvases.forEach((c) => {
      try { ctx.drawImage(c, 0, 0, w, h); } catch (_) {}
    });
    const a = document.createElement("a");
    a.download = `cusc-ar-${Date.now()}.png`;
    a.href = out.toDataURL("image/png");
    a.click();
  }

  _updateDebugLegacy() {
    const fmt = (v) =>
      `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}`;
    const fmtQ = (q) =>
      `${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)}, ${q.w.toFixed(3)}`;

    const lines = [];
    lines.push(`gyro: ${this._gyroEnabled}  |  matrixAutoUpdate: ${this._camera.matrixAutoUpdate}`);

    // Camera
    this._camera.updateMatrixWorld(true);
    const cp = new THREE.Vector3();
    const cq = new THREE.Quaternion();
    const cs = new THREE.Vector3();
    this._camera.matrixWorld.decompose(cp, cq, cs);
    lines.push(`--- CAMERA ---`);
    lines.push(`local pos:  ${fmt(this._camera.position)}`);
    lines.push(`local quat: ${fmtQ(this._camera.quaternion)}`);
    lines.push(`world pos:  ${fmt(cp)}`);
    lines.push(`world quat: ${fmtQ(cq)}`);

    // Items
    for (let i = 0; i < this._items.length; i++) {
      const it = this._items[i];
      lines.push(`--- ITEM ${i} (locked=${it.locked}, tracking=${it.tracking}) ---`);

      // Wrapper
      it.wrapper.updateMatrixWorld(true);
      const wp = new THREE.Vector3();
      const wq = new THREE.Quaternion();
      const ws = new THREE.Vector3();
      it.wrapper.matrixWorld.decompose(wp, wq, ws);
      lines.push(`wrapper local pos:   ${fmt(it.wrapper.position)}`);
      lines.push(`wrapper local scale: ${fmt(it.wrapper.scale)}`);
      lines.push(`wrapper world pos:   ${fmt(wp)}`);
      lines.push(`wrapper world scale: ${fmt(ws)}`);

      // Model scene
      it.modelScene.updateMatrixWorld(true);
      const mp = new THREE.Vector3();
      const mq = new THREE.Quaternion();
      const ms = new THREE.Vector3();
      it.modelScene.matrixWorld.decompose(mp, mq, ms);
      lines.push(`model local pos:   ${fmt(it.modelScene.position)}`);
      lines.push(`model local rot:   ${fmt(it.modelScene.rotation)}`);
      lines.push(`model world pos:   ${fmt(mp)}`);
      lines.push(`model world scale: ${fmt(ms)}`);

      // Anchor (nếu còn update)
      if (it.anchor?.group) {
        const ap = new THREE.Vector3();
        const aq = new THREE.Quaternion();
        const as = new THREE.Vector3();
        it.anchor.group.matrixWorld.decompose(ap, aq, as);
        lines.push(`anchor world pos:  ${fmt(ap)}  (visible=${it.anchor.group.visible})`);
      }
    }

    this._debugEl.textContent = lines.join("\n");
  }

  _setupTapHandler() {
    const el = this._renderer.domElement;
    const TAP_MAX_DIST = 12; // px
    const TAP_MAX_DUR = 350; // ms

    el.addEventListener("pointerdown", (e) => {
      this._tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    });

    el.addEventListener("pointerup", (e) => {
      if (!this._tapStart) return;
      const dx = e.clientX - this._tapStart.x;
      const dy = e.clientY - this._tapStart.y;
      const dt = performance.now() - this._tapStart.t;
      this._tapStart = null;
      if (dx * dx + dy * dy > TAP_MAX_DIST * TAP_MAX_DIST) return;
      if (dt > TAP_MAX_DUR) return;

      // Convert sang NDC
      const rect = el.getBoundingClientRect();
      this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this._raycaster.setFromCamera(this._pointer, this._camera);

      // Test mỗi item đã được lock
      for (const item of this._items) {
        if (!item.locked || !item.wrapper.visible) continue;
        const hits = this._raycaster.intersectObject(item.modelScene, true);
        if (hits.length > 0) {
          this._handleItemTap(item);
          return;
        }
      }
    });

    el.addEventListener("pointercancel", () => (this._tapStart = null));
  }

  _handleItemTap(item) {
    // Replay animation từ đầu (visual feedback)
    if (item.mixer && item.animations?.length > 0) {
      const clip = item.animations[item.currentClipIndex] || item.animations[0];
      if (clip) {
        const action = item.mixer.clipAction(clip);
        action.reset();
        action.play();
      }
    }

    // Báo cho UI hiện popup
    this._onTapItem?.(item);
  }

  /** Đăng ký callback nhận event tap vào model */
  setOnTapItem(cb) {
    this._onTapItem = cb;
  }

  /**
   * Xoay model đã lock quanh trục UP **vật lý** (= pháp tuyến marker
   * = trục Z local của wrapper, vì wrapper inherit matrix của marker).
   * @param {number} deltaAngle  – radians
   */
  rotateModel(deltaAngle = 0) {
    if (!deltaAngle) return;
    for (const item of this._items) {
      if (!item.locked) continue;
      item.wrapper.rotateZ(deltaAngle);
    }
  }

  /**
   * Zoom model đã lock (nhân với scale hiện tại, có giới hạn).
   * @param {number} factor  – >1 phóng to, <1 thu nhỏ
   */
  zoomModel(factor = 1) {
    if (factor === 1 || factor <= 0) return;
    const MIN = 0.3, MAX = 3.0;
    for (const item of this._items) {
      if (!item.locked) continue;
      const cur = item.userZoom || 1;
      const next = Math.max(MIN, Math.min(MAX, cur * factor));
      const apply = next / cur;
      item.wrapper.scale.multiplyScalar(apply);
      item.userZoom = next;
    }
  }

  _updateScreenOrient() {
    this._screenOrientation =
      (screen.orientation?.angle ?? window.orientation ?? 0) || 0;
  }

  /**
   * Bật DeviceOrientation. Trên iOS phải gọi từ user gesture.
   * @returns {Promise<boolean>}
   */
  async enableGyro() {
    if (this._gyroEnabled) return true;
    try {
      if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
      ) {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== "granted") return false;
      }

      window.addEventListener(
        "deviceorientation",
        (e) => (this._deviceOrientation = e),
        true
      );

      // Đợi event đầu để có dữ liệu
      await new Promise((resolve) => {
        const tStart = performance.now();
        const wait = () => {
          if (this._deviceOrientation || performance.now() - tStart > 1000) {
            resolve();
          } else {
            requestAnimationFrame(wait);
          }
        };
        wait();
      });

      // QUAN TRỌNG: MindAR đặt camera.matrixAutoUpdate=false và ghi thẳng vào
      // camera.matrix mỗi frame. Trước khi chuyển sang gyro, ta phải:
      //   1. Đọc rotation HIỆN TẠI từ matrixWorld (vì .quaternion bị "stale")
      //   2. Bật lại matrixAutoUpdate để Three tự dựng matrix từ position/quat
      //   3. Tính offset sao cho camera GIỮ NGUYÊN hướng hiện tại
      //      → tránh bị "nhảy" khi switch
      this._camera.updateMatrixWorld(true);

      // KHÔNG snap wrapper sang anchor nữa → giữ nguyên giá trị lerp
      // hiện tại để tránh "nhảy vị trí" khi user bấm Quan sát đúng lúc
      // đang di chuyển điện thoại.
      const currentCamQuat = new THREE.Quaternion();
      const currentCamPos = new THREE.Vector3();
      const currentCamScale = new THREE.Vector3();
      this._camera.matrixWorld.decompose(
        currentCamPos,
        currentCamQuat,
        currentCamScale
      );

      this._camera.matrixAutoUpdate = true;
      this._camera.position.copy(currentCamPos);
      this._camera.quaternion.copy(currentCamQuat);
      this._camera.scale.copy(currentCamScale);

      // Tính offset: camQ_target = offset × devQ → offset = camQ × inverse(devQ)
      const devQ = this._computeDeviceQuat();
      this._gyroOffset.copy(currentCamQuat).multiply(devQ.invert());

      this._gyroEnabled = true;

      // Tắt scan hint
      const hint = document.getElementById("scan-hint");
      if (hint) hint.style.display = "none";

      // KHÔNG stop MindAR (sẽ tắt luôn video) — frame loop tự bỏ qua
      // việc cập nhật model từ marker khi `_gyroEnabled = true`.

      return true;
    } catch (err) {
      console.warn("Gyro không khả dụng:", err);
      return false;
    }
  }

  _computeDeviceQuat() {
    const e = this._deviceOrientation;
    if (!e) return new THREE.Quaternion();
    const alpha = THREE.MathUtils.degToRad(e.alpha || 0);
    const beta = THREE.MathUtils.degToRad(e.beta || 0);
    const gamma = THREE.MathUtils.degToRad(e.gamma || 0);
    const orient = THREE.MathUtils.degToRad(this._screenOrientation || 0);

    const euler = new THREE.Euler(beta, alpha, -gamma, "YXZ");
    const q = new THREE.Quaternion().setFromEuler(euler);
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    q.multiply(q1);
    const q2 = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      -orient
    );
    q.multiply(q2);
    return q;
  }

  _applyDeviceOrientation() {
    if (!this._deviceOrientation) return;
    const devQ = this._computeDeviceQuat();
    // camQ = offset * devQ
    this._camera.quaternion.copy(this._gyroOffset).multiply(devQ);
  }

  async start() {
    if (!this._mindarThree) throw new Error("HybridAREngine chưa được init().");
    await this._mindarThree.start();
    this._running = true;
  }

  async stop() {
    if (this._mindarThree && this._running) {
      await this._mindarThree.stop();
      this._running = false;
    }
  }

  /** Quên vị trí đã lock, scan lại từ đầu */
  async resetLock() {
    this._gyroEnabled = false;
    this._gyroOffset.identity();

    for (const item of this._items) {
      item.locked = false;
      item.tracking = false;
      item.wrapper.visible = false;
      // Xóa mọi xoay/zoom user đã áp → lần lock sau bắt đầu sạch
      item.wrapper.position.set(0, 0, 0);
      item.wrapper.quaternion.identity();
      item.wrapper.scale.set(1, 1, 1);
      item.wrapper.matrix.identity();
      item.wrapper.matrixWorld.identity();
      item.userZoom = 1;
    }

    // Trả quyền camera matrix cho MindAR
    this._camera.matrixAutoUpdate = false;
    this._camera.position.set(0, 0, 0);
    this._camera.quaternion.identity();
    this._camera.scale.set(1, 1, 1);
    // Reset cả matrix + matrixWorld (nếu không, giá trị gyro cũ vẫn tồn tại
    // đến khi MindAR detect anchor mới và ghi đè → model render sai chỗ)
    this._camera.matrix.identity();
    this._camera.matrixWorld.identity();

    const hint = document.getElementById("scan-hint");
    if (hint) hint.style.display = "flex";
  }

  getAnchors() {
    return this._items.map((i) => ({ anchor: i.anchor }));
  }

  isGyroEnabled() {
    return this._gyroEnabled;
  }
}
