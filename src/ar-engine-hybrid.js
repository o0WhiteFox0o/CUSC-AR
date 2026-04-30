/**
 * src/ar-engine-hybrid.js – CUSC-AR engine
 *
 * Kiến trúc "1 marker / 1 file .mind, cycle qua các file":
 *
 *   markers = [
 *     { id: "spinosaurus-floor",  mindFile: "...", modelDef, surface: "floor" },
 *     { id: "spinosaurus-wall",   mindFile: "...", modelDef, surface: "wall"  },
 *     { id: "triceratops-floor",  mindFile: "...", modelDef, surface: "floor" },
 *     { id: "triceratops-wall",   mindFile: "...", modelDef, surface: "wall"  },
 *   ]
 *
 *   Engine giữ DUY NHẤT 1 instance MindARThree. Khi marker hiện tại không
 *   được tracking → sau `cycleIntervalMs` sẽ stop + new instance khác.
 *   Khi marker tracking → dừng cycle. Khi mất tracking → resume sau
 *   `resumeDelayMs`.
 *
 * Lý do thiết kế: gộp nhiều marker QR-style giống nhau vào 1 file gây
 * false-positive (nhiều idx báo track=true cùng lúc → render lệch).
 * Tách thành 4 file riêng giải quyết triệt để.
 *
 * Có 2 chế độ:
 *   A. STRICT  – mặc định. Model là con anchor.group, MindAR tự ẩn/hiện.
 *   B. SNAPSHOT – khi user bấm "Quan sát". Dừng copy matrix → wrapper đông
 *      cứng tại transform hiện tại; bật gyro để xoay nhìn quanh.
 *      Reset (⟳) → teardown + rebuild marker hiện tại.
 */

import * as THREE from "three";
import { MindARThree } from "mind-ar/dist/mindar-image-three.prod.js";
import { ModelLoader } from "./model-loader.js";
import { AudioManager } from "./audio-manager.js";

export class HybridAREngine {
  /**
   * @param {HTMLElement} container
   * @param {object} arConfig
   * @param {import("./models.js").ModelDef[]} models
   */
  constructor(container, arConfig, models) {
    this._container = container;
    this._config = arConfig;
    this._modelDefs = models;
    this._modelLoader = new ModelLoader();
    this._audio = new AudioManager();
    this._clock = new THREE.Clock();

    // Build flat marker spec list
    /** @type {MarkerSpec[]} */
    this._markers = [];
    for (const def of models) {
      for (const t of def.targets ?? []) {
        if (!t.mindFile) {
          console.warn(`[HybridAR] target ${def.id}/${t.surface} thiếu mindFile, bỏ qua.`);
          continue;
        }
        this._markers.push({
          id: `${def.id}-${t.surface ?? "floor"}`,
          mindFile: t.mindFile,
          surface: t.surface ?? "floor",
          modelDef: def,
        });
      }
    }

    // Pre-loaded GLB caches (one per modelDef, cloned per cycle)
    /** @type {Map<string, {scene: THREE.Group, animations: THREE.AnimationClip[]}>} */
    this._glbCache = new Map();

    // Cycle state
    this._currentIdx = 0;
    this._cycleTimer = null;
    this._cycleIntervalMs = arConfig.cycleIntervalMs ?? 3000;
    this._resumeDelayMs = arConfig.resumeDelayMs ?? 1500;

    this._mindarThree = null;
    this._activeItem = null; // { anchor, modelScene, animations, mixer, def, surface }
    this._running = false;
    this._switching = false;
    this._stopRequested = false;

    // Snapshot mode (single shared Three context across cycles? No – per cycle.)
    this._snapshotData = null; // { matrixWorld, def, surface, modelScene clone }
    this._gyroEnabled = false;
    this._deviceOrientation = null;
    this._screenOrientation = 0;
    this._gyroOffset = new THREE.Quaternion();
    this._userZoom = 1;

    // Tap interaction
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._tapStart = null;
    this._onTapItem = null;

    // Status callback
    this._onStatus = null;
  }

  setOnStatus(cb) { this._onStatus = cb; }
  setOnTapItem(cb) { this._onTapItem = cb; }

  _emitStatus(stage) {
    const m = this._markers[this._currentIdx];
    this._onStatus?.({
      stage,                     // "scanning" | "tracking" | "snapshot" | "switching"
      markerId: m?.id ?? null,
      markerName: m ? `${m.modelDef.name} (${m.surface === "wall" ? "tường" : "sàn"})` : null,
      tracking: !!this._activeItem?.tracking,
    });
  }

  // ===== Init =======================================================
  async init(onProgress = () => {}) {
    onProgress("Đang tải các model...");
    if (this._markers.length === 0) {
      throw new Error("Không có marker nào trong models.js");
    }

    // Pre-load every GLB once
    const seen = new Set();
    for (const m of this._markers) {
      if (seen.has(m.modelDef.id)) continue;
      seen.add(m.modelDef.id);
      try {
        const gltf = await this._modelLoader.load(m.modelDef.modelUrl, {
          ignoreNodes: m.modelDef.ignoreNodes,
        });
        this._glbCache.set(m.modelDef.id, {
          scene: gltf.scene,
          animations: gltf.animations,
        });
        this._audio.preload(m.modelDef.id, m.modelDef.audio);
      } catch (err) {
        console.error(`[HybridAR] Không tải được ${m.modelDef.modelUrl}:`, err);
      }
    }

    window.addEventListener("orientationchange", () => this._updateScreenOrient());
    this._updateScreenOrient();

    onProgress("Sẵn sàng!");
  }

  async start() {
    if (this._running) return;
    this._running = true;
    this._stopRequested = false;
    this._currentIdx = 0;
    await this._activateCurrent();
  }

  async stop() {
    this._stopRequested = true;
    this._running = false;
    this._clearCycleTimer();
    await this._teardownInstance();
  }

  /** Switch to next marker spec; rebuild MindARThree fresh. */
  async _activateCurrent() {
    if (!this._running || this._switching) return;
    this._switching = true;
    this._emitStatus("switching");
    try {
      await this._teardownInstance();
      if (this._stopRequested) return;
      await this._buildInstanceForCurrent();
      this._emitStatus("scanning");
      // schedule rotate to next if no detection
      this._scheduleCycleAdvance();
    } catch (err) {
      console.error("[HybridAR] activate failed:", err);
    } finally {
      this._switching = false;
    }
  }

  async _teardownInstance() {
    this._clearCycleTimer();
    if (this._mindarThree) {
      try { await this._mindarThree.stop(); } catch {}
      try { this._mindarThree.renderer?.setAnimationLoop(null); } catch {}
      try { this._mindarThree.renderer?.dispose(); } catch {}
      this._mindarThree = null;
    }
    // mind-ar.stop() chỉ bỏ <video>, KHÔNG bỏ canvas/cssRenderer.
    // Don dẹp container để tránh stack canvas gây đen màn hình.
    if (this._container) {
      while (this._container.firstChild) {
        this._container.removeChild(this._container.firstChild);
      }
    }
    this._activeItem = null;
    this._scene = null;
    this._camera = null;
    this._renderer = null;
  }

  async _buildInstanceForCurrent() {
    const spec = this._markers[this._currentIdx];
    if (!spec) throw new Error("currentIdx out of range");

    const t = this._config.tracking ?? {};
    const m = new MindARThree({
      container: this._container,
      imageTargetSrc: spec.mindFile,
      filterMinCF: t.filterMinCF ?? 0.001,
      filterBeta: t.filterBeta ?? 0.01,
      warmupTolerance: t.warmupTolerance ?? 1,
      missTolerance: t.missTolerance ?? 60,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",
    });
    this._mindarThree = m;
    this._scene = m.scene;
    this._camera = m.camera;
    this._renderer = m.renderer;

    m.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    m.renderer.outputColorSpace = THREE.SRGBColorSpace;
    m.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    // Mở rộng far plane: marker scale ~markerWidth (px) nên model có thể
    // nằm ở z hàng nghìn nếu pivot lệch.
    if (m.camera) {
      m.camera.far = Math.max(m.camera.far, 10000);
      m.camera.updateProjectionMatrix();
    }

    m.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(0.5, 1, 0.25);
    m.scene.add(dir);

    const anchor = m.addAnchor(0); // single-target file
    const cached = this._glbCache.get(spec.modelDef.id);
    if (!cached) throw new Error(`GLB chưa load cho ${spec.modelDef.id}`);

    const def = spec.modelDef;
    const surface = spec.surface;
    const modelScene = cached.scene.clone(true);
    const animations = cached.animations;

    const p = def.position ?? { x: 0, y: 0, z: 0 };
    const s = def.scale ?? { x: 1, y: 1, z: 1 };
    const r = def.rotation;
    const defaultRotX = surface === "wall" ? 0 : Math.PI / 2;
    modelScene.position.set(p.x, p.y, p.z);
    modelScene.rotation.set(r?.x ?? defaultRotX, r?.y ?? 0, r?.z ?? 0);
    modelScene.scale.set(s.x, s.y, s.z);

    const autoFit = def.autoFitSize ?? this._config.autoFitSize ?? 0;
    if (autoFit > 0) {
      const box = new THREE.Box3().setFromObject(modelScene);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) modelScene.scale.multiplyScalar(autoFit / maxDim);
    }

    // Wrapper trong scene root (KHÔNG gắn model vào anchor.group). Mỗi frame
    // sẽ copy anchor.group.matrixWorld → wrapper.matrix. Đây là kiến trúc
    // đã chứng minh hoạt động ổn định ở phiên bản trước.
    const wrapper = new THREE.Group();
    wrapper.add(modelScene);
    wrapper.visible = false;
    m.scene.add(wrapper);
    modelScene.visible = true;

    // Soi từng mesh trong GLB để chẩn đoán
    let meshCount = 0, visibleMeshes = 0, totalTris = 0;
    const meshSummary = [];
    modelScene.traverse((o) => {
      if (o.isMesh) {
        meshCount++;
        if (o.visible) visibleMeshes++;
        const g = o.geometry;
        const tris = g?.index ? g.index.count / 3 : (g?.attributes?.position?.count ?? 0) / 3;
        totalTris += tris | 0;
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        const matInfo = `${mat?.type ?? "?"} t=${mat?.transparent?1:0} o=${mat?.opacity ?? "?"} aT=${mat?.alphaTest ?? 0}`;
        meshSummary.push(`${o.name}|${tris|0}|${matInfo}`);
        console.log(
          `[GLB ${spec.modelDef.id}] mesh "${o.name}" vis=${o.visible} tris=${tris|0}` +
          ` mat=${mat?.type} transparent=${mat?.transparent} opacity=${mat?.opacity}` +
          ` side=${mat?.side} depthWrite=${mat?.depthWrite} alphaTest=${mat?.alphaTest}` +
          ` color=${mat?.color?.getHexString?.()}`
        );
        // FIX phổ biến: ép double-side + tắt frustumCull để loại trừ culling
        if (mat) {
          mat.side = THREE.DoubleSide;
          mat.transparent = false;
          mat.opacity = 1;
          mat.depthWrite = true;
          mat.needsUpdate = true;
        }
        o.frustumCulled = false;
      }
    });
    console.log(`[GLB ${spec.modelDef.id}] meshes=${meshCount} visible=${visibleMeshes} tris=${totalTris}`);

    // Bbox để tính autofit + lưu cho debug overlay
    const _box0 = new THREE.Box3().setFromObject(modelScene);
    const _size0 = _box0.getSize(new THREE.Vector3());
    this._lastGlbInfo = {
      id: spec.modelDef.id,
      meshCount, visibleMeshes, totalTris,
      bbox: `${_size0.x.toFixed(2)}x${_size0.y.toFixed(2)}x${_size0.z.toFixed(2)}`,
      meshes: meshSummary,
    };

    // Log vị trí/kích thước để debug
    const _box = new THREE.Box3().setFromObject(modelScene);
    const _size = _box.getSize(new THREE.Vector3());
    console.log(
      `[HybridAR] add ${spec.id} → wrapper | local pos(${modelScene.position.x.toFixed(2)},${modelScene.position.y.toFixed(2)},${modelScene.position.z.toFixed(2)}) ` +
      `scale(${modelScene.scale.x.toFixed(3)}) bbox(${_size.x.toFixed(2)}x${_size.y.toFixed(2)}x${_size.z.toFixed(2)}) ` +
      `anims=${animations.length}`
    );

    const item = {
      spec,
      anchor,
      wrapper,
      modelScene,
      def,
      surface,
      animations,
      mixer: null,
      tracking: false,
      locked: false,
    };

    anchor.onTargetFound = () => {
      item.tracking = true;
      item.wrapper.visible = true;
      this._handleFound(item);
    };
    anchor.onTargetLost = () => {
      item.tracking = false;
      this._handleLost(item);
    };

    const animKey = def.defaultAnimation;
    const animRef = animKey && def.animations ? def.animations[animKey] : null;
    if (animRef != null && animations.length > 0) {
      item.mixer = this._modelLoader.playAnimation(modelScene, animations, animRef);
    }

    this._activeItem = item;

    this._setupTapHandler(m.renderer.domElement);

    await m.start();

    m.renderer.setAnimationLoop(() => this._frame());
  }

  _frame() {
    const delta = this._clock.getDelta();

    // Copy anchor.group.matrixWorld → wrapper.matrix (chỉ khi tracking & chưa snapshot)
    if (!this._gyroEnabled && !this._snapshotData) {
      const item = this._activeItem;
      if (item && item.tracking && item.anchor.group.visible) {
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
    } else if (this._gyroEnabled) {
      this._applyDeviceOrientation();
    }

    this._modelLoader.update(delta);
    if (this._renderer && this._scene && this._camera) {
      this._renderer.render(this._scene, this._camera);
    }
    if (this._debugEl) this._updateDebug();
  }

  _handleFound(item) {
    item.tracking = true;
    this._clearCycleTimer();
    this._emitStatus("tracking");
    const hint = document.getElementById("scan-hint");
    if (hint) hint.style.display = "none";
  }

  _handleLost(item) {
    item.tracking = false;
    if (this._gyroEnabled || this._snapshotData) return;
    // Resume cycle after small delay
    this._clearCycleTimer();
    this._cycleTimer = setTimeout(() => this._advanceCycle(), this._resumeDelayMs);
    this._emitStatus("scanning");
  }

  _scheduleCycleAdvance() {
    this._clearCycleTimer();
    this._cycleTimer = setTimeout(() => {
      // If still not tracking, advance
      if (!this._activeItem?.tracking && !this._gyroEnabled && !this._snapshotData) {
        this._advanceCycle();
      }
    }, this._cycleIntervalMs);
  }

  _clearCycleTimer() {
    if (this._cycleTimer) {
      clearTimeout(this._cycleTimer);
      this._cycleTimer = null;
    }
  }

  async _advanceCycle() {
    if (!this._running || this._gyroEnabled || this._snapshotData) return;
    this._currentIdx = (this._currentIdx + 1) % this._markers.length;
    await this._activateCurrent();
  }

  // ===== Debug =====================================================
  enableDebug(el) { this._debugEl = el; }

  _updateDebug() {
    const lines = [];
    const m = this._markers[this._currentIdx];
    const it = this._activeItem;
    lines.push(`[CUSC-AR] ${this._currentIdx + 1}/${this._markers.length}  ${m?.id ?? "—"}`);
    lines.push(`mind: ${m?.mindFile ?? "—"}`);
    lines.push(`tracking: ${it?.tracking ? "YES" : "no"}   anchor.visible: ${it?.anchor?.group?.visible ? "yes" : "no"}`);
    lines.push(`gyro: ${this._gyroEnabled}   snapshot: ${this._snapshotData ? "yes" : "no"}   locked: ${it?.locked ? "yes" : "no"}`);
    if (it?.wrapper) {
      const w = it.wrapper;
      lines.push(`wrapper.local pos=(${w.position.x.toFixed(2)}, ${w.position.y.toFixed(2)}, ${w.position.z.toFixed(2)})`);
      lines.push(`wrapper.local scale=(${w.scale.x.toFixed(2)}, ${w.scale.y.toFixed(2)}, ${w.scale.z.toFixed(2)})`);
      lines.push(`wrapper.visible=${w.visible}`);
    }
    if (it?.modelScene) {
      const ms = it.modelScene;
      ms.updateMatrixWorld(true);
      const wp = new THREE.Vector3();
      const wq = new THREE.Quaternion();
      const ws = new THREE.Vector3();
      ms.matrixWorld.decompose(wp, wq, ws);
      lines.push(`model.local pos=(${ms.position.x.toFixed(2)}, ${ms.position.y.toFixed(2)}, ${ms.position.z.toFixed(2)})`);
      lines.push(`model.local scale=(${ms.scale.x.toFixed(3)}, ${ms.scale.y.toFixed(3)}, ${ms.scale.z.toFixed(3)})`);
      lines.push(`model.world pos=(${wp.x.toFixed(1)}, ${wp.y.toFixed(1)}, ${wp.z.toFixed(1)})`);
      lines.push(`model.world scale=(${ws.x.toFixed(2)}, ${ws.y.toFixed(2)}, ${ws.z.toFixed(2)})`);
      lines.push(`model.visible=${ms.visible}  parent=${ms.parent?.type ?? "none"}`);
    }
    if (this._camera) {
      const cp = this._camera.position;
      lines.push(`camera pos=(${cp.x.toFixed(1)}, ${cp.y.toFixed(1)}, ${cp.z.toFixed(1)})`);
      lines.push(`camera near=${this._camera.near.toFixed(1)} far=${this._camera.far.toFixed(0)} fov=${this._camera.fov?.toFixed(1)}`);
    }
    if (this._renderer) {
      const sz = this._renderer.getSize(new THREE.Vector2());
      lines.push(`renderer ${sz.x}x${sz.y}  pr=${this._renderer.getPixelRatio().toFixed(2)}`);
    }
    if (this._lastGlbInfo) {
      const g = this._lastGlbInfo;
      lines.push(`GLB ${g.id}: ${g.visibleMeshes}/${g.meshCount} mesh, ${g.totalTris} tris`);
      lines.push(`GLB bbox: ${g.bbox}`);
      g.meshes.slice(0, 4).forEach((s) => lines.push(`  ${s}`));
      if (g.meshes.length > 4) lines.push(`  ... +${g.meshes.length - 4} more`);
    }
    this._debugEl.textContent = lines.join("\n");
  }

  // ===== Tap handler ===============================================
  _setupTapHandler(el) {
    if (el._cuscTapBound) return;
    el._cuscTapBound = true;
    const TAP_MAX_DIST = 12;
    const TAP_MAX_DUR = 350;
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
      this._audio.unlock();
      const rect = el.getBoundingClientRect();
      this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (!this._camera) return;
      this._raycaster.setFromCamera(this._pointer, this._camera);

      const target = this._snapshotData ? this._snapshotData.modelScene
                   : this._activeItem?.tracking ? this._activeItem.modelScene
                   : null;
      if (!target) return;
      const hits = this._raycaster.intersectObject(target, true);
      if (hits.length > 0) this._handleItemTap(this._activeItem || this._snapshotData);
    });
    el.addEventListener("pointercancel", () => (this._tapStart = null));
  }

  _handleItemTap(item) {
    const mixer = item.mixer;
    if (mixer && item.animations?.length > 0) {
      mixer.stopAllAction();
      const animKey = item.def.defaultAnimation;
      const ref = animKey && item.def.animations
        ? item.def.animations[animKey]
        : 0;
      let clip;
      if (typeof ref === "number") clip = item.animations[ref];
      else clip = THREE.AnimationClip.findByName(item.animations, ref);
      if (clip) {
        const action = mixer.clipAction(clip);
        action.reset();
        action.play();
      }
    }
    this._audio.play(item.def.id, "roar");
    this._onTapItem?.(item);
  }

  // ===== Manual rotate / zoom (snapshot mode) ======================
  rotateModel(deltaAngle = 0) {
    if (!deltaAngle || !this._snapshotData) return;
    const w = this._activeItem?.wrapper;
    if (!w) return;
    if (this._snapshotData.surface === "wall") w.rotateY(deltaAngle);
    else w.rotateZ(deltaAngle);
  }

  zoomModel(factor = 1) {
    if (factor === 1 || factor <= 0 || !this._snapshotData) return;
    const w = this._activeItem?.wrapper;
    if (!w) return;
    const MIN = 0.3, MAX = 3.0;
    const next = Math.max(MIN, Math.min(MAX, this._userZoom * factor));
    const apply = next / this._userZoom;
    w.scale.multiplyScalar(apply);
    this._userZoom = next;
  }

  // ===== Gyro / snapshot ===========================================
  _updateScreenOrient() {
    this._screenOrientation = (screen.orientation?.angle ?? window.orientation ?? 0) || 0;
  }

  async enableGyro() {
    if (this._gyroEnabled) return true;
    if (!this._activeItem?.tracking) {
      console.warn("[HybridAR] Chưa tracking marker → không snapshot được.");
      return false;
    }

    try {
      if (typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function") {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== "granted") return false;
      }
      window.addEventListener("deviceorientation",
        (e) => (this._deviceOrientation = e), true);
      await new Promise((resolve) => {
        const t0 = performance.now();
        const wait = () => {
          if (this._deviceOrientation || performance.now() - t0 > 1000) resolve();
          else requestAnimationFrame(wait);
        };
        wait();
      });

      this._clearCycleTimer();

      // Snapshot = đơn giản dừng copy matrix (đã gated bằng _snapshotData).
      // Wrapper giữ nguyên transform hiện tại làm "đông cứng".
      const item = this._activeItem;
      this._snapshotData = {
        modelScene: item.modelScene,
        animations: item.animations,
        mixer: item.mixer,
        def: item.def,
        surface: item.surface,
      };
      // Giữ wrapper.visible = true (model vẫn render)

      // Bảo toàn camera hiện tại + bật gyro
      this._camera.updateMatrixWorld(true);
      const cp = new THREE.Vector3(), cq = new THREE.Quaternion(), cs = new THREE.Vector3();
      this._camera.matrixWorld.decompose(cp, cq, cs);
      this._camera.matrixAutoUpdate = true;
      this._camera.position.copy(cp);
      this._camera.quaternion.copy(cq);
      this._camera.scale.copy(cs);

      const devQ = this._computeDeviceQuat();
      this._gyroOffset.copy(cq).multiply(devQ.invert());

      this._gyroEnabled = true;
      this._userZoom = 1;
      this._emitStatus("snapshot");
      return true;
    } catch (err) {
      console.warn("[HybridAR] Gyro lỗi:", err);
      return false;
    }
  }

  _computeDeviceQuat() {
    const e = this._deviceOrientation;
    if (!e) return new THREE.Quaternion();
    const alpha = THREE.MathUtils.degToRad(e.alpha || 0);
    const beta  = THREE.MathUtils.degToRad(e.beta  || 0);
    const gamma = THREE.MathUtils.degToRad(e.gamma || 0);
    const orient = THREE.MathUtils.degToRad(this._screenOrientation || 0);
    const euler = new THREE.Euler(beta, alpha, -gamma, "YXZ");
    const q = new THREE.Quaternion().setFromEuler(euler);
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    q.multiply(q1);
    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient);
    q.multiply(q2);
    return q;
  }

  _applyDeviceOrientation() {
    if (!this._deviceOrientation || !this._camera) return;
    const devQ = this._computeDeviceQuat();
    this._camera.quaternion.copy(this._gyroOffset).multiply(devQ);
  }

  // ===== Reset =====================================================
  async resetLock() {
    this._gyroEnabled = false;
    this._gyroOffset.identity();
    this._snapshotData = null;
    this._userZoom = 1;
    // Trả lại đời cycling: rebuild current marker từ đầu
    await this._activateCurrent();
    const hint = document.getElementById("scan-hint");
    if (hint) hint.style.display = "flex";
  }

  // ===== Misc ======================================================
  /** Tổng số marker trong cycle. */
  getMarkerCount() { return this._markers.length; }
  isGyroEnabled() { return this._gyroEnabled; }
  hasTracking() { return !!this._activeItem?.tracking; }
}

/**
 * @typedef {Object} MarkerSpec
 * @property {string} id
 * @property {string} mindFile
 * @property {"floor"|"wall"} surface
 * @property {import("./models.js").ModelDef} modelDef
 */
