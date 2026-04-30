/**
 * src/ar-config.js – Cấu hình ENGINE (không chứa data model)
 *
 * Data model (model + danh sách .mind per marker) nằm ở `src/models.js`.
 */
const AR_CONFIG = {
  /**
   * Auto-fit toàn cục: cạnh lớn nhất của model = `autoFitSize` × chiều rộng marker.
   * Có thể override per-model (`models.js` → autoFitSize).
   */
  autoFitSize: 1.5,

  /**
   * Cycle giữa các .mind:
   *   – Nếu sau `cycleIntervalMs` mà marker hiện tại không tracking →
   *     teardown và load .mind kế tiếp.
   *   – Khi mất tracking sau khi đã thấy → đợi `resumeDelayMs` rồi mới cycle.
   */
  cycleIntervalMs: 2000,
  resumeDelayMs: 1500,

  /** Tham số tracking MindAR (xem doc MindAR) */
  tracking: {
    filterMinCF: 0.001,
    filterBeta: 0.01,
    warmupTolerance: 1, // 1 = lock ngay frame đầu detect được
    missTolerance: 60,  // bám lâu khi marker bị che thoáng
  },
};

export default AR_CONFIG;
