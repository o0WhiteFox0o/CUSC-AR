/**
 * ar-config.js – Cấu hình runtime cho CUSC-AR
 *
 * Toàn bộ model + marker được khai báo trong `src/models.js`.
 * File này chỉ chứa setting toàn cục.
 */
const AR_CONFIG = {
  /** File .mind đa-target (4 markers — xem scripts/compile-mind.mjs). */
  mindFile: "assets/targets/targets.mind",

  /**
   * Auto-fit: scale model sao cho cạnh lớn nhất = `autoFitSize` lần
   * chiều rộng marker. 1.5 = gấp 1.5 lần. Có thể override per-model.
   */
  autoFitSize: 1.5,

  /** MindAR tracking tuning. */
  tracking: {
    filterMinCF: 0.0001,
    filterBeta: 0.001,
    warmupTolerance: 2,
    missTolerance: 30,
  },
};

export default AR_CONFIG;
