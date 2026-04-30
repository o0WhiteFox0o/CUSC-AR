# Session notes — 2026-04-30

Ghi chép lại quá trình thử nghiệm tái cấu trúc CUSC-AR sang multi-marker
cycle. Phiên này KHÔNG merge vào main; toàn bộ code được lưu ở branch
`backup/today-restructure` để tham khảo / cherry-pick sau.

## 1. Yêu cầu ban đầu của user
- Hỗ trợ nhiều model (≥15) → mỗi model 1+ marker (floor/wall).
- Mỗi marker tự chọn scale tốt nhất (compile nhiều phiên bản .mind theo scale).
- Chia .mind ra **từng file riêng** thay vì gộp 1 file (`hãy thiết kế lại cấu trúc với danh sách đường dẫn với 4 file .mind đi`).
- Thêm nút bật/tắt panel debug.

## 2. Những gì đã làm

### 2.1. Compile-mind script
- `scripts/compile-mind.mjs`: dùng playwright-core (msedge headless) +
  static HTTP server để serve `mind-ar/dist/mindar-image.prod.js`, expose
  `window.__compile(b64) → Uint8Array`.
- Output 4 file: `spinosaurus-{floor,wall}.mind`, `triceratops-{floor,wall}.mind`
  (mỗi file ~300–360KB, single-target).
- Đã bỏ ý tưởng "scale1..scale9" — chỉ giữ 1 scale gốc cho mỗi marker.

### 2.2. Models registry
- `src/models.js`: `MODELS = [{ id, name, modelUrl, ignoreNodes, animations,
  defaultAnimation, autoFitSize, position, rotation, scale, info, targets:[
  {mindFile, surface}, ... ] }]`.
- `Triceratops` có `ignoreNodes: ["Plane"]` để loại shadow plane đen.
- File: `public/assets/models/spinosaurus-idle.glb` (cũ, đã chạy tốt) +
  `triceratops_idle.glb` (mới, chưa kiểm chứng).

### 2.3. Engine `src/ar-engine-hybrid.js` (cycle architecture)
- 1 `MindARThree` instance / cycle iteration → start với 1 .mind, addAnchor(0).
- Cycle: `cycleIntervalMs: 3000`, đổi marker liên tục cho tới khi tracking.
- Khi `onTargetFound` → dừng cycle; khi `onTargetLost` + delay `resumeDelayMs`
  → tiếp tục cycle.
- Wrapper-in-scene-root (per-frame copy `anchor.group.matrixWorld → wrapper.matrix`,
  decompose, lerp 0.25). Đây là kiến trúc của commit `09f93ce`, đã làm việc.
- Snapshot mode = chỉ dừng copy matrix → wrapper "đông cứng" tại transform
  hiện tại; bật gyro xoay camera. Reset = teardown + activateCurrent().
- `_lastGlbInfo` trong debug overlay: hiển thị mesh/tris/bbox.

### 2.4. UI
- `index.html`: `#btn-debug` (☰), `#scan-status` pill (xanh/cam),
  `#debug-overlay` ẩn mặc định.
- `src/main.js`: `engine.setOnStatus(...)`, `btn-debug` toggle.
- CSS: scan-status pill top center, debug overlay top:3.4rem (dưới pill).

## 3. Bug đã gặp & nguyên nhân

| # | Triệu chứng | Nguyên nhân |
|---|---|---|
| 1 | Model invisible khi đặt làm con của `anchor.group` (STRICT mode) | MindAR đặt `anchor.group.matrixAutoUpdate=false` và copy raw matrix với scale ~markerWidth (656) → three.js auto-rebuild matrix làm sai. Dùng wrapper + per-frame decompose là đúng. |
| 2 | `camera.far=10000` bị reset | MindAR `resize()` tự tính `near/far` từ projection matrix mỗi lần resize → override không bền. |
| 3 | Bắt nhầm marker (chĩa Spinosaurus → báo Triceratops) | 4 marker cùng layout (khung vuông + vòng tròn). Mỗi cycle chỉ load 1 .mind → MindAR vẫn match đại. **Hướng giải đúng: gộp 4 marker vào 1 `targets.mind` với 4 anchor, mỗi anchor → 1 model — như commit `84f4c7e/09f93ce`**. |
| 4 | Spinosaurus.glb không hiện sau cấu trúc mới | Chưa rõ — debug overlay hiển thị mesh/tris/bbox bình thường (1 mesh, 22768 tris, bbox 0.65×1.50×0.92, MeshStandardMaterial), tracking YES, model.world ổn. Vẫn không render. Vẫn còn ẩn số. Có thể do thứ tự thao tác cycle teardown/rebuild làm renderer mất context. |
| 5 | Canvas stacking giữa các cycle | Đã fix bằng `while(container.firstChild) removeChild` trong `_teardownInstance`. |

## 4. Kết luận & kế hoạch tiếp theo

- **Revert main về `09f93ce`** (1 mind file, 1 model spinosaurus, đã chạy tốt).
- Backup nhánh `backup/today-restructure` lưu toàn bộ thử nghiệm hôm nay.
- Hướng restructure đúng cho lần sau:
  1. **GỘP** tất cả markers vào 1 `targets.mind` (compile multi-target).
     → MindAR tự match đúng anchor, không bắt nhầm.
  2. Mỗi anchor (`addAnchor(i)`) → 1 model riêng (vẫn pattern wrapper-in-scene-root).
  3. KHÔNG cycle qua nhiều `MindARThree` instance → chỉ 1 instance duy nhất.
  4. Marker bộ artwork phải khác biệt rõ ràng (không cùng template).
- Khi quay lại làm:
  - Bắt đầu từ `09f93ce`.
  - Thêm `models.js` registry → `targets[]` với targetIndex.
  - `compile-mind.mjs` đổi sang multi-target (truyền array `[img1, img2, ...]`
    vào `compiler.compileImageTargets`).

## 5. Files cần phục hồi từ backup khi quay lại
- `scripts/compile-mind.mjs` (đổi sang multi-target).
- `src/models.js` (đổi schema sang dùng targetIndex).
- `src/audio-manager.js` (nếu cần roar SFX).
- UI: `#scan-status` pill + `#btn-debug` toggle (CSS + main.js binding).
- `public/assets/models/triceratops_idle.glb` (đã copy từ ngoài).
- 4 PNG markers trong `public/assets/targets/images/`.

— end —
