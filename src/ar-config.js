/**
 * ar-config.js – Cấu hình trung tâm cho CUSC-AR
 *
 * Cấu trúc models[]:
 *   - Mỗi model có 1 modelUrl và N targets (floor / wall).
 *   - targetIndex PHẢI khớp thứ tự ảnh khi compile file .mind:
 *       Index 0 = ảnh đầu tiên upload lên compiler
 *       Index 1 = ảnh thứ hai, v.v.
 *   - Đặt ảnh nguồn vào assets/targets/images/ để dễ quản lý.
 *   - Compile tại: https://hiukim.github.io/mind-ar-js-doc/tools/compile
 */
const AR_CONFIG = {
  mode: "image",

  /* ====================================================================
   *  IMAGE TRACKING – MindAR
   * ==================================================================== */

  /** File .mind compiled từ TẤT CẢ ảnh target theo đúng thứ tự index */
  // targets.mind chứa 4 markers theo thứ tự:
  //   0 = spinosaurus-floor (658x669)
  //   1 = spinosaurus-wall  (657x668)
  //   2 = triceratops-floor (660x669)
  //   3 = triceratops-wall  (661x669)
  mindFile: "assets/targets/targets.mind",

  /**
   * Auto-fit toàn cục: scale sao cho cạnh lớn nhất = autoFitSize × chiều rộng marker.
   * Có thể override per-model.  0 / null = dùng scale thủ công.
   */
  autoFitSize: 1.5,

  /**
   * Tham số tracking MindAR.
   *   warmupTolerance: 1  → lock ngay frame đầu nhìn thấy
   *   missTolerance:   60 → bám lâu khi marker bị che thoáng
   */
  tracking: {
    filterMinCF: 0.001,
    filterBeta: 0.01,
    warmupTolerance: 1,
    missTolerance: 60,
  },

  /**
   * Danh sách model. Mỗi model có:
   *   id          – định danh duy nhất
   *   name        – tên hiển thị
   *   modelUrl    – đường dẫn file GLB
   *   animation   – index hoặc tên clip mặc định (null = không phát)
   *   autoFitSize – override global (tuỳ chọn)
   *   position    – offset local trong wrapper (thường {0,0,0})
   *   scale       – scale thủ công (bị override nếu autoFitSize > 0)
   *   info        – dữ liệu popup khi tap
   *   targets[]   – danh sách anchor:
   *       targetIndex  – index trong file .mind (= vị trí ảnh khi compile)
   *       surface      – "floor" (marker nằm ngang) | "wall" (marker đứng)
   *       targetImage  – đường dẫn ảnh nguồn (chú thích, không dùng runtime)
   */
  models: [
    {
      id: "spinosaurus",
      name: "Spinosaurus",
      modelUrl: "assets/models/spinosaurus-idle.glb",
      animation: 0,
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      info: {
        title: "Spinosaurus aegyptiacus",
        description:
          "Khủng long bán thuỷ sinh lớn nhất từng tồn tại, sống vào kỷ Phấn Trắng (~99 triệu năm trước) tại khu vực ngày nay là Bắc Phi. Dài tới 15m, có cánh buồm trên lưng và hàm dài như cá sấu để săn cá.",
      },
      targets: [
        {
          targetIndex: 0,
          surface: "floor",        // marker đặt nằm ngang trên bàn / sàn
          targetImage: "assets/targets/images/spinosaurus-floor.png",
        },
        {
          targetIndex: 1,
          surface: "wall",         // marker dán dọc trên tường
          targetImage: "assets/targets/images/spinosaurus-wall.png",
        },
      ],
    },
    {
      id: "triceratops",
      name: "Triceratops",
      modelUrl: "assets/models/triceratops_idle.glb",
      animation: 0,
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      info: {
        title: "Triceratops horridus",
        description:
          "Khủng long ăn cỏ lớn sống cuối kỷ Phấn Trắng (~68 triệu năm trước) tại Bắc Mỹ. Đặc trưng bởi 3 sừng trên đầu và diềm cổ lớn, nặng tới 12 tấn và dài 9m.",
      },
      targets: [
        {
          targetIndex: 2,
          surface: "floor",
          targetImage: "assets/targets/images/triceratops-floor.png",
        },
        {
          targetIndex: 3,
          surface: "wall",
          targetImage: "assets/targets/images/triceratops-wall.png",
        },
      ],
    },
  ],

  /* ====================================================================
   *  WORLD TRACKING (Gyro) – chế độ phụ, không dùng marker
   * ==================================================================== */
  worldTracking: {
    autoFitSize: 1.2,
    autoRingRadius: 2.5,
    faceCamera: false,
    models: [
      {
        id: "spinosaurus",
        name: "Spinosaurus",
        modelUrl: "assets/models/spinosaurus-idle.glb",
        position: { x: -2.0, y: -1.8, z: -2.5 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        animation: 0,
      },
    ],
  },
};

export default AR_CONFIG;

