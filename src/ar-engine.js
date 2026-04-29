/**
 * ar-engine.js – Khởi tạo & quản lý MindAR + Three.js
 */

import * as THREE from "three";
import { MindARThree } from "mind-ar/dist/mindar-image-three.prod.js";
import { ModelLoader } from "./model-loader.js";

export class AREngine {
  /**
   * @param {HTMLElement} container – DOM element chứa AR
   * @param {object} config – AR_CONFIG object
   */
  constructor(container, config) {
    this._container = container;
    this._config = config;
    this._modelLoader = new ModelLoader();
    this._clock = new THREE.Clock();
    this._mindarThree = null;
    this._anchors = [];
    this._running = false;
  }

  /**
   * Khởi tạo MindAR, Three.js scene, load models
   * @param {(msg: string) => void} onProgress – callback cập nhật tiến trình
   */
  async init(onProgress = () => {}) {
    onProgress("Đang khởi tạo camera & AR engine...");

    this._mindarThree = new MindARThree({
      container: this._container,
      imageTargetSrc: this._config.mindFile,
      filterMinCF: 0.001,
      filterBeta: 0.01,
      warmupTolerance: 5,
      missTolerance: 5,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",
    });

    const { renderer, scene, camera } = this._mindarThree;

    // Renderer settings
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    // Ánh sáng cơ bản
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(0.5, 1, 0.5);
    scene.add(dirLight);

    // Load từng target & model
    for (const target of this._config.targets) {
      onProgress(`Đang tải model: ${target.modelUrl}`);

      const anchor = this._mindarThree.addAnchor(target.targetIndex);

      try {
        const { scene: modelScene, animations } =
          await this._modelLoader.load(target.modelUrl);

        // Áp scale thủ công trước
        const { position: p, rotation: r, scale: s } = target;
        modelScene.position.set(p.x, p.y, p.z);
        modelScene.rotation.set(r.x, r.y, r.z);
        modelScene.scale.set(s.x, s.y, s.z);

        // Auto-fit: scale model theo bbox sao cho cạnh lớn nhất ≈ autoFitSize × marker
        const autoFitSize = this._config.autoFitSize ?? 0;
        if (autoFitSize > 0) {
          const box = new THREE.Box3().setFromObject(modelScene);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0) {
            modelScene.scale.multiplyScalar(autoFitSize / maxDim);
          }
        }

        anchor.group.add(modelScene);
        this._anchors.push({ anchor, modelScene, animations, target });

        // Animation nếu có
        if (target.animation != null) {
          this._modelLoader.playAnimation(
            modelScene,
            animations,
            target.animation
          );
        }
      } catch (err) {
        console.error(`Không thể tải model ${target.modelUrl}:`, err);
      }
    }

    // Animation loop
    renderer.setAnimationLoop(() => {
      const delta = this._clock.getDelta();
      this._modelLoader.update(delta);
      renderer.render(scene, camera);
    });

    onProgress("Sẵn sàng!");
  }

  /** Bắt đầu AR tracking */
  async start() {
    if (!this._mindarThree) {
      throw new Error("AREngine chưa được init().");
    }
    await this._mindarThree.start();
    this._running = true;
  }

  /** Dừng AR tracking */
  async stop() {
    if (this._mindarThree && this._running) {
      await this._mindarThree.stop();
      this._running = false;
    }
  }

  /** Trả về danh sách anchor để bên ngoài xử lý sự kiện */
  getAnchors() {
    return this._anchors;
  }

  /** Truy cập Three.js scene, camera, renderer */
  getThreeContext() {
    if (!this._mindarThree) return null;
    return {
      scene: this._mindarThree.scene,
      camera: this._mindarThree.camera,
      renderer: this._mindarThree.renderer,
    };
  }
}
