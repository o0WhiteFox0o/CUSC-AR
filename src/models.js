/**
 * src/models.js – Model registry
 *
 * Mỗi model có thể có nhiều target marker (floor + wall).
 * Để thêm model mới: xem docs/ARCHITECTURE.md §7.
 */

/**
 * @typedef {Object} ModelTarget
 * @property {string} mindFile      – đường dẫn .mind RIÊNG cho marker này
 * @property {"floor"|"wall"} surface
 *
 * @typedef {Object} ModelDef
 * @property {string} id
 * @property {string} name
 * @property {string} modelUrl
 * @property {string[]=} ignoreNodes        – tên node trong GLB cần xoá sau khi load
 * @property {Object<string, number|string>=} animations
 *                                         – map name → index/clipName trong GLB
 * @property {string=} defaultAnimation     – key trong `animations` phát khi spawn
 * @property {Object<string, string>=} audio – map name → URL (vd. `{ roar: "..." }`)
 * @property {number|null=} autoFitSize     – override toàn cục
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
      // roar: "assets/audio/spinosaurus/roar.mp3",   // bỏ comment khi có file
    },
    autoFitSize: null,
    position: { x: 0, y: 0, z: 0 },
    rotation: null,
    scale: { x: 1, y: 1, z: 1 },
    info: {
      title: "Spinosaurus aegyptiacus",
      description:
        "Khủng long bán thuỷ sinh lớn nhất từng tồn tại, sống vào kỷ Phấn Trắng " +
        "(~99 triệu năm trước) tại khu vực ngày nay là Bắc Phi. Dài tới 15m, " +
        "có cánh buồm trên lưng và hàm dài như cá sấu để săn cá.",
    },
    targets: [
      { mindFile: "assets/targets/spinosaurus-floor.mind", surface: "floor" },
      { mindFile: "assets/targets/spinosaurus-wall.mind",  surface: "wall"  },
    ],
  },
  {
    id: "triceratops",
    name: "Triceratops",
    modelUrl: "assets/models/triceratops_idle.glb",
    // File GLB từ Blender có kèm 1 mesh "Plane" (shadow plane) nền đen
    // → loại khỏi scene, nếu không sẽ phủ đen lên model sau auto-fit.
    ignoreNodes: ["Plane"],
    animations: { idle: 0 },
    defaultAnimation: "idle",
    audio: {
      // roar: "assets/audio/triceratops/roar.mp3",
    },
    autoFitSize: null,
    position: { x: 0, y: 0, z: 0 },
    rotation: null,
    scale: { x: 1, y: 1, z: 1 },
    info: {
      title: "Triceratops horridus",
      description:
        "Khủng long ăn cỏ lớn sống cuối kỷ Phấn Trắng (~68 triệu năm trước) " +
        "tại Bắc Mỹ. Đặc trưng bởi 3 sừng trên đầu và diềm cổ lớn, nặng tới " +
        "12 tấn và dài 9m.",
    },
    targets: [
      { mindFile: "assets/targets/triceratops-floor.mind", surface: "floor" },
      { mindFile: "assets/targets/triceratops-wall.mind",  surface: "wall"  },
    ],
  },

  // Thêm model mới TẠI ĐÂY. Mỗi marker = 1 file .mind riêng (xem scripts/compile-mind.mjs).
];

export default MODELS;
