/**
 * model-loader.js – Tải model GLTF/GLB và quản lý animation
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

export class ModelLoader {
  constructor() {
    this._loader = new GLTFLoader();

    // Draco decoder cho model nén (tùy chọn)
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.6/"
    );
    this._loader.setDRACOLoader(dracoLoader);

    /** @type {Map<string, THREE.AnimationMixer>} */
    this._mixers = new Map();
  }

  /**
   * Tải model từ URL
   * @param {string} url
   * @param {{ ignoreNodes?: string[] }=} opts
   * @returns {Promise<{scene: THREE.Group, animations: THREE.AnimationClip[]}>}
   */
  load(url, opts = {}) {
    const ignore = new Set((opts.ignoreNodes ?? []).map((s) => s.toLowerCase()));
    return new Promise((resolve, reject) => {
      this._loader.load(
        url,
        (gltf) => {
          if (ignore.size > 0) {
            const toRemove = [];
            gltf.scene.traverse((obj) => {
              const name = (obj.name || "").toLowerCase();
              if (ignore.has(name)) toRemove.push(obj);
            });
            for (const obj of toRemove) {
              console.log(`[ModelLoader] ${url}: removed node "${obj.name}"`);
              obj.parent?.remove(obj);
            }
          }
          resolve({ scene: gltf.scene, animations: gltf.animations });
        },
        undefined,
        (err) => reject(err)
      );
    });
  }

  /**
   * Phát animation clip theo tên hoặc index
   * @param {THREE.Group} scene
   * @param {THREE.AnimationClip[]} clips
   * @param {string|number|null} nameOrIndex
   * @returns {THREE.AnimationMixer|null}
   */
  playAnimation(scene, clips, nameOrIndex) {
    if (nameOrIndex == null || clips.length === 0) return null;

    const mixer = new THREE.AnimationMixer(scene);

    let clip;
    if (typeof nameOrIndex === "number") {
      clip = clips[nameOrIndex];
    } else {
      clip = THREE.AnimationClip.findByName(clips, nameOrIndex);
    }

    if (clip) {
      mixer.clipAction(clip).play();
    } else if (clips.length > 0) {
      // Fallback: phát clip đầu tiên
      mixer.clipAction(clips[0]).play();
    }

    this._mixers.set(scene.uuid, mixer);
    return mixer;
  }

  /**
   * Cập nhật tất cả mixer (gọi mỗi frame)
   * @param {number} delta – thời gian giữa 2 frame (giây)
   */
  update(delta) {
    for (const mixer of this._mixers.values()) {
      mixer.update(delta);
    }
  }

  /**
   * Xóa mixer khi không cần nữa
   * @param {string} uuid
   */
  disposeMixer(uuid) {
    const mixer = this._mixers.get(uuid);
    if (mixer) {
      mixer.stopAllAction();
      this._mixers.delete(uuid);
    }
  }
}
