/**
 * src/models.js – Model registry cho CUSC-AR
 *
 * Mỗi model có thể có nhiều marker (floor + wall). `targetIndex` PHẢI khớp
 * với thứ tự PNG trong `scripts/compile-mind.mjs` (cùng index → cùng marker).
 *
 * Để thêm model mới:
 *   1. Bỏ ảnh marker .png vào `public/assets/targets/images/`.
 *   2. Thêm vào MARKERS trong scripts/compile-mind.mjs và lấy index mới.
 *   3. Thêm vào MODELS bên dưới với targets[].targetIndex tương ứng.
 *   4. Chạy `npm run compile-mind` để tái tạo `targets.mind`.
 */

/**
 * @typedef {Object} ModelTarget
 * @property {number} targetIndex             – index trong targets.mind
 * @property {"floor"|"wall"} surface         – marker đặt trên sàn hay tường
 *
 * @typedef {Object} ModelDef
 * @property {string} id
 * @property {string} name
 * @property {string} modelUrl                – URL GLB (relative tới public/)
 * @property {string[]=} ignoreNodes          – tên node trong GLB cần xoá khi load
 * @property {Object<string, number|string>=} animations
 * @property {string=} defaultAnimation
 * @property {Object<string, string>=} audio  – map name → URL
 * @property {number|null=} autoFitSize       – override toàn cục
 * @property {{x:number,y:number,z:number}=} position
 * @property {{x:number,y:number,z:number}|null=} rotation
 * @property {{x:number,y:number,z:number}=} scale
 * @property {{title:string, description:string}} info
 * @property {ModelTarget[]} targets
 */

/** @type {ModelDef[]} */
export const MODELS = [
  {
    id: "spinosaurus",
    name: "Spinosaurus",
    modelUrl: "assets/models/spinosaurus-idle.glb",
    ignoreNodes: [],
    animations: { idle: 0 },
    defaultAnimation: "idle",
    audio: {
      // roar: "assets/audio/spinosaurus/roar.mp3",
    },
    autoFitSize: 1.5,
    position: { x: 0, y: 0, z: 0 },
    rotation: null, // null → auto: floor=π/2 quanh X, wall=0
    scale: { x: 1, y: 1, z: 1 },
    info: {
      title: "Spinosaurus aegyptiacus",
      description:
        "Khủng long bán thuỷ sinh lớn nhất từng tồn tại, sống vào kỷ Phấn Trắng " +
        "(~99 triệu năm trước) tại Bắc Phi. Dài tới 15m, có cánh buồm trên lưng.",
    },
    targets: [
      { targetIndex: 0, surface: "floor" },
      { targetIndex: 1, surface: "wall"  },
    ],
  },
  {
    id: "triceratops",
    name: "Triceratops",
    modelUrl: "assets/models/Triceratops_idle.glb",
    // GLB từ Blender thường kèm 1 mesh "Plane" (shadow plane) — loại bỏ.
    ignoreNodes: ["Plane"],
    animations: { idle: 0 },
    defaultAnimation: "idle",
    audio: {},
    autoFitSize: 1.5,
    position: { x: 0, y: 0, z: 0 },
    rotation: null,
    scale: { x: 1, y: 1, z: 1 },
    info: {
      title: "Triceratops horridus",
      description:
        "Khủng long ăn cỏ cuối kỷ Phấn Trắng (~68 triệu năm trước) tại Bắc Mỹ. " +
        "Nặng tới 12 tấn, có 3 sừng và diềm cổ lớn.",
    },
    targets: [
      { targetIndex: 2, surface: "floor" },
      { targetIndex: 3, surface: "wall"  },
    ],
  },
];

/**
 * Helper: trả về danh sách flat {targetIndex, surface, modelDef} từ MODELS.
 * Engine duyệt qua list này để `addAnchor(targetIndex)` cho mỗi marker.
 */
export function flattenTargets(models = MODELS) {
  const out = [];
  for (const m of models) {
    for (const t of m.targets) {
      out.push({ ...t, modelDef: m });
    }
  }
  return out.sort((a, b) => a.targetIndex - b.targetIndex);
}

export default MODELS;
