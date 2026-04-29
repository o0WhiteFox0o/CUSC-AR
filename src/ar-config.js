/**
 * ar-config.js – Cấu hình trung tâm cho CUSC-AR
 */
const AR_CONFIG = {
  /**
   * Mode:
   *   - "image" (mặc định): MindAR – model bám vào ảnh marker (Shrimp.mind),
   *     tự động phóng to/thu nhỏ theo khoảng cách camera.
   *   - "world": Gyro mode – model đặt trong "phòng ảo" quanh user (không marker).
   */
  mode: "image",

  /* ====================================================================
   *  IMAGE TRACKING – MindAR (model bám vào marker)
   * ==================================================================== */
  mindFile: "assets/targets/Shrimp.mind",

  /**
   * Auto-fit: scale model sao cho cạnh lớn nhất = `autoFitSize` lần
   * chiều rộng marker. Đặt null/0 để dùng `scale` thủ công.
   *   1.0 = bằng chiều rộng marker
   *   1.5 = gấp 1.5 lần
   */
  autoFitSize: 1.5,

  targets: [
    {
      targetIndex: 0,
      modelUrl: "assets/models/spinosaurus-idle.glb",
      position: { x: 0, y: 0, z: 0 },
      // MindAR: marker nằm trên mặt phẳng XY (Z hướng ra khỏi mặt giấy).
      // Xoay 90° quanh X để model đứng thẳng trên mặt giấy.
      rotation: { x: Math.PI / 2, y: 0, z: 0 },
      // Scale sẽ bị override nếu autoFitSize > 0
      scale: { x: 1, y: 1, z: 1 },
      animation: 0,
      info: {
        title: "Spinosaurus aegyptiacus",
        description:
          "Khủng long bán thuỷ sinh lớn nhất từng tồn tại, sống vào kỷ Phấn Trắng (~99 triệu năm trước) tại khu vực ngày nay là Bắc Phi. Dài tới 15m, có cánh buồm trên lưng và hàm dài như cá sấu để săn cá.",
      },
    },
    // Ví dụ ảnh thứ 2 (cần biên dịch lại file .mind với nhiều ảnh):
    // {
    //   targetIndex: 1,
    //   modelUrl: "assets/models/AM_Shrimp.glb",
    //   position: { x: 0, y: 0, z: 0 },
    //   rotation: { x: Math.PI / 2, y: 0, z: 0 },
    //   scale: { x: 1, y: 1, z: 1 },
    //   animation: 0,
    // },
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
        rotation: { x: 0, y: 90, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        animation: 0,
      },
    ],
  },
};

export default AR_CONFIG;
