/**
 * ar-engine-webxr.js – Markerless World-Tracking AR (WebXR)
 *
 * Yêu cầu: Trình duyệt hỗ trợ WebXR `immersive-ar` (Chrome / Edge / Samsung Internet
 * trên Android có ARCore). iOS Safari KHÔNG hỗ trợ.
 *
 * Tính năng:
 *  - Hit-test: phát hiện mặt phẳng (sàn / bàn) → vẽ reticle
 *  - Tap-to-place: chạm màn hình để đặt model
 *  - XRAnchor: model "bám dính" vào không gian thật, không trôi khi camera di chuyển
 *  - Hỗ trợ nhiều model trong cấu hình; chuyển đổi model bằng phương thức selectModel()
 */

import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { ModelLoader } from "./model-loader.js";

export class WebXRAREngine {
  /**
   * @param {HTMLElement} container
   * @param {object} config – AR_CONFIG (dùng phần `worldTracking`)
   */
  constructor(container, config) {
    this._container = container;
    this._config = config;
    this._modelLoader = new ModelLoader();
    this._clock = new THREE.Clock();

    /** Cache model gốc theo URL: { scene, animations } */
    this._modelCache = new Map();
    /** Các instance đã đặt: [{ object, anchor, mixer }] */
    this._placedObjects = [];

    /** Model đang được chọn để đặt tiếp theo */
    this._selectedModelDef = null;

    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._reticle = null;
    this._hitTestSource = null;
    this._localSpace = null;
    this._viewerSpace = null;
    this._anchorsSupported = false;
  }

  /**
   * Kiểm tra trình duyệt có hỗ trợ WebXR AR không
   * @returns {Promise<boolean>}
   */
  static async isSupported() {
    if (!("xr" in navigator)) return false;
    try {
      return await navigator.xr.isSessionSupported("immersive-ar");
    } catch {
      return false;
    }
  }

  async init(onProgress = () => {}) {
    onProgress("Đang khởi tạo WebXR...");

    // ==== Three.js cơ bản ====
    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      40
    );

    this._renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.xr.enabled = true;
    this._container.appendChild(this._renderer.domElement);

    // ==== Ánh sáng ====
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444466, 0.9);
    this._scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(0.5, 1, 0.25);
    this._scene.add(dir);

    // ==== Reticle (vòng tròn đánh dấu mặt phẳng) ====
    const reticleGeo = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(
      -Math.PI / 2
    );
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0x33ff88,
      transparent: true,
      opacity: 0.9,
    });
    this._reticle = new THREE.Mesh(reticleGeo, reticleMat);
    this._reticle.matrixAutoUpdate = false;
    this._reticle.visible = false;
    this._scene.add(this._reticle);

    // ==== Resize ====
    window.addEventListener("resize", () => {
      this._camera.aspect = window.innerWidth / window.innerHeight;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ==== Pre-load tất cả model trong worldTracking config ====
    const models = this._config.worldTracking?.models ?? [];
    if (models.length === 0) {
      throw new Error("Chưa cấu hình `worldTracking.models` trong ar-config.js");
    }

    for (const def of models) {
      onProgress(`Đang tải model: ${def.modelUrl}`);
      try {
        const { scene, animations } = await this._modelLoader.load(def.modelUrl);
        this._modelCache.set(def.modelUrl, { scene, animations, def });
      } catch (err) {
        console.error(`Lỗi tải ${def.modelUrl}:`, err);
      }
    }

    // Mặc định chọn model đầu tiên
    this._selectedModelDef = models[0];

    onProgress("Sẵn sàng!");
  }

  /**
   * Tạo nút "Start AR" và nhúng vào DOM. Trả về element để CSS tùy biến.
   * @param {HTMLElement} parent
   */
  mountARButton(parent = document.body) {
    const button = ARButton.createButton(this._renderer, {
      requiredFeatures: ["hit-test", "local"],
      optionalFeatures: ["anchors", "dom-overlay", "light-estimation"],
      domOverlay: { root: document.body },
    });
    button.id = "ar-start-button";
    parent.appendChild(button);

    // Khi session bắt đầu / kết thúc
    this._renderer.xr.addEventListener("sessionstart", () =>
      this._onSessionStart()
    );
    this._renderer.xr.addEventListener("sessionend", () =>
      this._onSessionEnd()
    );

    return button;
  }

  /** Đổi model đang được chọn (cho lần đặt tiếp theo) */
  selectModel(modelUrl) {
    const cached = this._modelCache.get(modelUrl);
    if (cached) this._selectedModelDef = cached.def;
  }

  /** Xóa toàn bộ model đã đặt */
  clearPlaced() {
    for (const item of this._placedObjects) {
      if (item.anchor && item.anchor.delete) {
        try {
          item.anchor.delete();
        } catch (e) {}
      }
      this._scene.remove(item.object);
      this._modelLoader.disposeMixer(item.object.uuid);
    }
    this._placedObjects = [];
  }

  /* ============================================================
   *   Internals
   * ============================================================ */

  async _onSessionStart() {
    const session = this._renderer.xr.getSession();

    // Anchors API (optional)
    this._anchorsSupported =
      typeof XRFrame !== "undefined" &&
      typeof XRFrame.prototype.createAnchor === "function";

    // Hit-test source từ viewer space
    this._viewerSpace = await session.requestReferenceSpace("viewer");
    this._hitTestSource = await session.requestHitTestSource({
      space: this._viewerSpace,
    });

    // Tap-to-place: dùng `select` event của XR controller (chạm màn hình)
    const controller = this._renderer.xr.getController(0);
    controller.addEventListener("select", () => this._onSelect());
    this._scene.add(controller);

    // Animation loop XR
    this._renderer.setAnimationLoop((time, frame) =>
      this._onXRFrame(time, frame)
    );

    // Cập nhật UI
    document.getElementById("xr-overlay")?.classList.add("xr-active");
  }

  _onSessionEnd() {
    this._hitTestSource = null;
    this._reticle.visible = false;
    this._renderer.setAnimationLoop(null);
    document.getElementById("xr-overlay")?.classList.remove("xr-active");
  }

  _onXRFrame(time, frame) {
    const refSpace = this._renderer.xr.getReferenceSpace();
    const delta = this._clock.getDelta();

    // Cập nhật reticle theo hit-test
    if (frame && this._hitTestSource) {
      const hits = frame.getHitTestResults(this._hitTestSource);
      if (hits.length > 0) {
        const pose = hits[0].getPose(refSpace);
        this._reticle.visible = true;
        this._reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        this._reticle.visible = false;
      }
    }

    // Đồng bộ vị trí object với XRAnchor (model bám dính vào không gian thật)
    if (frame && this._anchorsSupported) {
      for (const item of this._placedObjects) {
        if (!item.anchor) continue;
        const pose = frame.getPose(item.anchor.anchorSpace, refSpace);
        if (pose) {
          item.object.matrix.fromArray(pose.transform.matrix);
          item.object.matrix.decompose(
            item.object.position,
            item.object.quaternion,
            item.object.scale
          );
          // Áp lại scale từ definition
          const s = item.def.scale;
          item.object.scale.set(s.x, s.y, s.z);
        }
      }
    }

    this._modelLoader.update(delta);
    this._renderer.render(this._scene, this._camera);
  }

  async _onSelect() {
    if (!this._reticle.visible || !this._selectedModelDef) return;

    const cached = this._modelCache.get(this._selectedModelDef.modelUrl);
    if (!cached) return;

    // Clone model để có thể đặt nhiều instance
    const object = cached.scene.clone(true);
    const def = this._selectedModelDef;

    object.matrix.copy(this._reticle.matrix);
    object.matrix.decompose(object.position, object.quaternion, object.scale);

    // Áp transform user-config (offset + rotation + scale)
    object.position.x += def.position.x;
    object.position.y += def.position.y;
    object.position.z += def.position.z;
    object.rotation.x += def.rotation.x;
    object.rotation.y += def.rotation.y;
    object.rotation.z += def.rotation.z;
    object.scale.set(def.scale.x, def.scale.y, def.scale.z);

    this._scene.add(object);

    // Animation
    if (def.animation != null && cached.animations.length > 0) {
      this._modelLoader.playAnimation(object, cached.animations, def.animation);
    }

    // Tạo XRAnchor để model "bám dính" vào không gian
    let anchor = null;
    if (this._anchorsSupported) {
      const session = this._renderer.xr.getSession();
      const refSpace = this._renderer.xr.getReferenceSpace();
      const frame = session.requestAnimationFrame
        ? null
        : null; /* anchor sẽ được tạo trong frame hiện tại bằng API mới */

      try {
        // API mới: frame.createAnchor(pose, space) – cần frame hiện tại.
        // Workaround: dùng requestAnimationFrame để có frame.
        anchor = await new Promise((resolve, reject) => {
          session.requestAnimationFrame((t, f) => {
            const hits = f.getHitTestResults(this._hitTestSource);
            if (hits.length > 0 && hits[0].createAnchor) {
              hits[0].createAnchor().then(resolve).catch(reject);
            } else if (f.createAnchor) {
              const pose = new XRRigidTransform(
                {
                  x: object.position.x,
                  y: object.position.y,
                  z: object.position.z,
                },
                {
                  x: object.quaternion.x,
                  y: object.quaternion.y,
                  z: object.quaternion.z,
                  w: object.quaternion.w,
                }
              );
              f.createAnchor(pose, refSpace).then(resolve).catch(reject);
            } else {
              resolve(null);
            }
          });
        });
      } catch (e) {
        console.warn("Không tạo được XRAnchor, fallback world-fixed:", e);
        anchor = null;
      }
    }

    this._placedObjects.push({ object, anchor, def });

    // Ẩn hint sau lần đặt đầu tiên
    document.getElementById("place-hint")?.classList.add("hidden");
  }
}
