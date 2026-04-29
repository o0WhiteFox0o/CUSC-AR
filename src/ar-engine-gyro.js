/**
 * ar-engine-gyro.js – AR cực nhẹ kiểu "phòng ảo quanh user"
 *
 * Hoạt động:
 *   1. getUserMedia → stream camera vào <video> nền
 *   2. Three.js scene transparent overlay
 *   3. DeviceOrientation API → xoay camera Three.js theo hướng điện thoại
 *   4. Tất cả model đặt ở vị trí CỐ ĐỊNH trong "phòng ảo" quanh user.
 *      Camera ở gốc tọa độ, chỉ xoay (không di chuyển).
 *
 * Auto-fit: tự scale model để cạnh lớn nhất ≈ `autoFitSize` mét.
 * Auto-ring: model thiếu `position` sẽ tự rải đều trên vòng tròn.
 */

import * as THREE from "three";
import { ModelLoader } from "./model-loader.js";

export class GyroAREngine {
  constructor(container, config) {
    this._container = container;
    this._config = config;
    this._modelLoader = new ModelLoader();
    this._clock = new THREE.Clock();

    this._video = null;
    this._stream = null;
    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._placed = [];

    this._deviceOrientation = null;
    this._screenOrientation = 0;
    this._gyroEnabled = false;

    this._dragYaw = 0;
    this._dragPitch = 0;
    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;
  }

  async init(onProgress = () => {}) {
    onProgress("Đang mở camera...");
    await this._setupCamera();

    onProgress("Đang khởi tạo 3D...");
    this._setupThree();

    const cfg = this._config.worldTracking ?? {};
    const models = cfg.models ?? [];
    if (models.length === 0) {
      throw new Error("Chưa cấu hình `worldTracking.models` trong ar-config.js");
    }

    const autoFitSize = cfg.autoFitSize ?? 0;
    const ringRadius = cfg.autoRingRadius ?? 2.5;
    const ringY = -0.5;

    for (let i = 0; i < models.length; i++) {
      const def = models[i];
      onProgress(`Đang tải: ${def.modelUrl}`);
      try {
        const { scene, animations } = await this._modelLoader.load(def.modelUrl);
        const object = scene;

        // Scale thủ công trước
        const s = def.scale ?? { x: 1, y: 1, z: 1 };
        object.scale.set(s.x, s.y, s.z);

        // Auto-fit theo bbox
        if (autoFitSize > 0) {
          const box = new THREE.Box3().setFromObject(object);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0) {
            object.scale.multiplyScalar(autoFitSize / maxDim);
          }
        }

        // Vị trí: dùng def.position hoặc rải đều quanh user
        let pos = def.position;
        if (!pos) {
          const angle = (i / models.length) * Math.PI * 2;
          pos = {
            x: Math.sin(angle) * ringRadius,
            y: ringY,
            z: -Math.cos(angle) * ringRadius,
          };
        }
        object.position.set(pos.x, pos.y, pos.z);

        const r = def.rotation ?? { x: 0, y: 0, z: 0 };
        object.rotation.set(r.x, r.y, r.z);

        this._scene.add(object);

        if (def.animation != null && animations.length > 0) {
          this._modelLoader.playAnimation(object, animations, def.animation);
        }

        this._placed.push({ object, def });
      } catch (err) {
        console.error(`Lỗi tải ${def.modelUrl}:`, err);
      }
    }

    onProgress("Sẵn sàng!");
  }

  async _setupCamera() {
    this._video = document.createElement("video");
    this._video.setAttribute("playsinline", "");
    this._video.setAttribute("autoplay", "");
    this._video.setAttribute("muted", "");
    this._video.muted = true;
    Object.assign(this._video.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      objectFit: "cover",
      zIndex: "0",
    });
    this._container.appendChild(this._video);

    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    this._video.srcObject = this._stream;
    await this._video.play();
  }

  _setupThree() {
    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      100
    );
    this._camera.position.set(0, 0, 0);
    this._scene.add(this._camera);

    this._renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.setClearColor(0x000000, 0);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    Object.assign(this._renderer.domElement.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      zIndex: "1",
    });
    this._container.appendChild(this._renderer.domElement);

    this._scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(0.5, 1, 0.25);
    this._scene.add(dir);

    window.addEventListener("resize", () => this._onResize());
    window.addEventListener("orientationchange", () => this._onResize());

    this._setupDragControls();
  }

  _onResize() {
    this._camera.aspect = window.innerWidth / window.innerHeight;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._screenOrientation =
      (screen.orientation?.angle ?? window.orientation ?? 0) || 0;
  }

  _setupDragControls() {
    const el = this._renderer.domElement;
    const onDown = (x, y) => {
      this._dragging = true;
      this._lastX = x;
      this._lastY = y;
    };
    const onMove = (x, y) => {
      if (!this._dragging || this._gyroEnabled) return;
      const dx = x - this._lastX;
      const dy = y - this._lastY;
      this._lastX = x;
      this._lastY = y;
      this._dragYaw -= dx * 0.005;
      this._dragPitch -= dy * 0.005;
      const lim = Math.PI / 2 - 0.01;
      this._dragPitch = Math.max(-lim, Math.min(lim, this._dragPitch));
    };
    const onUp = () => (this._dragging = false);

    el.addEventListener("mousedown", (e) => onDown(e.clientX, e.clientY));
    window.addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));
    window.addEventListener("mouseup", onUp);
    el.addEventListener("touchstart", (e) => {
      if (this._gyroEnabled) return;
      onDown(e.touches[0].clientX, e.touches[0].clientY);
    });
    window.addEventListener("touchmove", (e) => {
      if (this._gyroEnabled) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    });
    window.addEventListener("touchend", onUp);
  }

  async enableGyro() {
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
      this._gyroEnabled = true;
      this._onResize();
      return true;
    } catch (err) {
      console.warn("Gyro không khả dụng:", err);
      return false;
    }
  }

  start() {
    this._renderer.setAnimationLoop(() => this._frame());
  }

  stop() {
    this._renderer.setAnimationLoop(null);
  }

  dispose() {
    this.stop();
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
  }

  /** Xoay (drag mode) để hướng về model thứ index */
  lookAtModel(index) {
    const item = this._placed[index];
    if (!item) return;
    const p = item.object.position;
    this._dragYaw = Math.atan2(p.x, -p.z);
    this._dragPitch = 0;
  }

  _frame() {
    const delta = this._clock.getDelta();

    if (this._gyroEnabled && this._deviceOrientation) {
      this._applyDeviceOrientation();
    } else {
      this._camera.rotation.set(this._dragPitch, this._dragYaw, 0, "YXZ");
    }

    if (this._config.worldTracking?.faceCamera) {
      const camPos = this._camera.getWorldPosition(new THREE.Vector3());
      for (const { object } of this._placed) {
        const dx = camPos.x - object.position.x;
        const dz = camPos.z - object.position.z;
        object.rotation.y = Math.atan2(dx, dz);
      }
    }

    this._modelLoader.update(delta);
    this._renderer.render(this._scene, this._camera);
  }

  _applyDeviceOrientation() {
    const e = this._deviceOrientation;
    const alpha = THREE.MathUtils.degToRad(e.alpha || 0);
    const beta = THREE.MathUtils.degToRad(e.beta || 0);
    const gamma = THREE.MathUtils.degToRad(e.gamma || 0);
    const orient = THREE.MathUtils.degToRad(this._screenOrientation || 0);

    const euler = new THREE.Euler();
    const q = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    const q2 = new THREE.Quaternion();

    euler.set(beta, alpha, -gamma, "YXZ");
    q.setFromEuler(euler);
    q.multiply(q1);
    q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient);
    q.multiply(q2);

    this._camera.quaternion.copy(q);
  }
}
