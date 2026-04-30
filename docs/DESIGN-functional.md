# Thiết kế chức năng – CUSC-AR

**Ngày tổng hợp:** 30/04/2026  
**Tác giả:** Tổng hợp từ session làm việc (Sinh viên + GitHub Copilot)  
**Nguồn:** Thảo luận và thực thi trong ngày 30/04/2026

---

## 1. Mục tiêu sản phẩm

Ứng dụng Web AR phục vụ trưng bày khủng long tại CUSC. Người xem dùng điện thoại quét mã/ảnh marker dán trên **sàn** hoặc **tường** ⇒ model 3D khủng long xuất hiện đúng tư thế, cho phép xoay – zoom – chạm để xem thông tin.

**Đặc trưng:**
- Không cài app, chạy trên trình duyệt mobile (Chrome / Safari iOS).
- Mỗi loài có 2 marker: **sàn** (model đứng thẳng) và **tường** (model nằm phẳng).
- Chế độ "Quan sát" (gyro) cho phép user di chuyển quanh model sau khi đã lock.
- Hỗ trợ nhiều loài bằng kiến trúc multi-target (xem `REPORT-multi-target-merge.md`).

---

## 2. Kiến trúc tổng quan

```
┌─────────────────────────────────────────────────┐
│            Trình duyệt mobile (HTTPS)            │
│  ┌───────────────────────────────────────────┐  │
│  │              index.html (UI)              │  │
│  │  - #scan-status pill                      │  │
│  │  - #btn-debug (☰)  → #debug-panel         │  │
│  │  - #btn-reset / #btn-gyro                 │  │
│  │  - #info-popup / #model-controls          │  │
│  └───────────────────────────────────────────┘  │
│                       ▲                          │
│  ┌───────────────────────────────────────────┐  │
│  │              src/main.js                  │  │
│  │  Wire UI ↔ engine (status, debug, popup)  │  │
│  └───────────────────────────────────────────┘  │
│                       ▲                          │
│  ┌───────────────────────────────────────────┐  │
│  │       src/ar-engine-hybrid.js             │  │
│  │  - 1 MindARThree instance                 │  │
│  │  - N anchors (addAnchor(targetIndex))     │  │
│  │  - N items {wrapper, modelScene, ...}     │  │
│  │  - Wrapper-in-scene-root pattern          │  │
│  │  - Gyro takeover + tap raycast            │  │
│  │  - Console mirror (logs) + force-show     │  │
│  └───────────────────────────────────────────┘  │
│         ▲                          ▲             │
│  ┌────────────┐          ┌──────────────────┐   │
│  │ models.js  │          │ model-loader.js  │   │
│  │ (registry) │          │ (GLB + ignoreNd) │   │
│  └────────────┘          └──────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## 3. Module breakdown

### 3.1. `src/models.js` – Registry

Định nghĩa danh sách model + marker theo schema:

```js
{
  id, name, modelUrl,
  ignoreNodes: ["Plane"],     // node bỏ khi load
  animations: { idle: 0 },
  defaultAnimation: "idle",
  audio: { ... },
  autoFitSize: 1.5,
  position, rotation, scale,
  info: { title, description },
  targets: [
    { targetIndex: 0, surface: "floor" },
    { targetIndex: 1, surface: "wall" },
  ],
}
```

Helper `flattenTargets()` ⇒ trả về list phẳng đã sort theo `targetIndex`.

### 3.2. `src/ar-config.js` – Config tracking

```js
{
  mindFile: "assets/targets/targets.mind",
  autoFitSize: 1.5,
  tracking: { filterMinCF, filterBeta, warmupTolerance, missTolerance },
}
```

Tách khỏi danh sách model ⇒ gọn, không chồng chéo.

### 3.3. `src/ar-engine-hybrid.js` – Engine

**Trạng thái mỗi item:**
```ts
{
  targetIndex, surface, def,        // tĩnh
  anchor, wrapper, modelScene,      // Three.js objects
  locked: boolean,                  // đã snap chưa
  tracking: boolean,                // marker đang được nhìn
  userZoom: number,                 // hệ số zoom thủ công
  glbInfo: { meshCount, totalTris, meshes, bbox },
  animations, mixer, currentClipIndex,
}
```

**Frame loop:**
1. Nếu `_gyroEnabled` → áp `_applyDeviceOrientation()` lên camera.
2. Ngược lại: với mỗi item đang tracking → copy `anchor.group.matrixWorld` → `wrapper.matrix`, decompose, **lerp 0.25** (frame đầu copy thẳng).
3. `_modelLoader.update(delta)` cho mixer animation.
4. `renderer.render(scene, camera)`.
5. Nếu có `_debugEl` → `_updateDebug()` (3 mode: stats / logs / glb).

**API public:**
- `init(onProgress)` / `start()` / `stop()` / `resetLock()`
- `setOnStatus(cb)` – callback nhận text trạng thái.
- `setOnTapItem(cb)` – callback khi user tap vào model.
- `enableGyro()` / `isGyroEnabled()`
- `rotateModel(rad)` / `zoomModel(factor)`
- `setDebugMode("stats" | "logs" | "glb")`
- `toggleForceShow()` – debug: hiện toàn bộ wrapper trước camera.
- `cycleNextAnchor()` – debug: lần lượt hiện từng anchor.
- `saveSnapshot()` – tải PNG canvas hiện tại.
- `getAnchors()` (legacy compat).

### 3.4. `src/model-loader.js` – GLB loader

- `load(url, { ignoreNodes })`: GLTFLoader + DRACOLoader, traverse và remove node theo tên (case-insensitive).
- `playAnimation(scene, clips, nameOrIndex)`: tạo `AnimationMixer`, play clip theo tên hoặc index.
- `update(delta)`: cập nhật mọi mixer.

### 3.5. `scripts/compile-mind.mjs` – Build marker

Headless Playwright (msedge) → load `MindARCompiler` → `compileImageTargets([img1..imgN])` → ghi `public/assets/targets/targets.mind`.

Thứ tự `MARKERS[]` = `targetIndex` trong runtime.

---

## 4. Trao đổi & quyết định trong ngày

### 4.1. Vấn đề khởi điểm
- Sáng: tách 4 marker thành 4 file `.mind` riêng + cycle ⇒ model không hiện, false-positive matching.
- User yêu cầu: **trả về phiên bản ổn định ngày hôm trước** (commit `09f93ce`), sau đó mới điều chỉnh cấu trúc.

### 4.2. Quyết định kiến trúc
- **1 file `targets.mind` chứa 4 marker** thay vì 4 file riêng (xem `REPORT-multi-target-merge.md`).
- **1 instance MindARThree + 4 anchor** (không cycle, không multi-instance).
- **Cache GLB theo `def.id`** ⇒ Spinosaurus floor + wall dùng chung 1 GLB clone qua `SkeletonUtils.clone`.
- **`ignoreNodes`** trong `ModelDef` để bỏ node `"Plane"` (shadow plane) ở GLB Triceratops.

### 4.3. UI debug cho mobile (5 nút)
User OK với plan: **Logs / GLB info / Snapshot / Force / Next**.
- Status pill `#scan-status` (cam = đang quét, xanh = đã thấy).
- Nút `☰` mở `#debug-panel` (3 tab: Stats / Logs / GLB + 3 action: Force / Next / Snap).
- Console mirror lưu 30 entry log gần nhất ⇒ xem trên phone không cần USB debug.

### 4.4. Bug `SkinnedMesh.clone()`
- Triệu chứng: cả 2 model không hiển thị dù tracking báo "Thấy: ...".
- Nguyên nhân: `cached.scene.clone(true)` không clone đúng skeleton.
- Sửa: `import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"`.

---

## 5. Các bước đã thực hiện (30/04/2026)

| # | Việc | Kết quả |
|---|---|---|
| 1 | Revert `main` về commit ổn định `09f93ce` | ✅ |
| 2 | Backup nhánh thử nghiệm cũ vào `backup/today-restructure` | ✅ |
| 3 | Khôi phục PNG marker + GLB Triceratops | ✅ |
| 4 | Viết lại `scripts/compile-mind.mjs` (multi-target Playwright) | ✅ |
| 5 | Compile `public/assets/targets/targets.mind` (4 markers, 1.3 MB) | ✅ |
| 6 | Tạo `src/models.js` registry mới | ✅ |
| 7 | Refactor `src/ar-engine-hybrid.js`: single instance + N anchor + cache + glbInfo | ✅ |
| 8 | Đơn giản hoá `src/ar-config.js` (bỏ targets, chỉ giữ tracking) | ✅ |
| 9 | Cập nhật `src/main.js` wire status/debug | ✅ |
| 10 | Thêm `#scan-status`, `#btn-debug`, `#debug-panel` vào `index.html` + CSS | ✅ |
| 11 | Sửa bug `SkinnedMesh.clone()` ⇒ dùng `SkeletonUtils.clone` | ✅ |
| 12 | Test trên phone: 2 model hiện đúng | ✅ |

---

## 6. Vấn đề còn tồn tại

| Vấn đề | Mức ưu tiên | Ghi chú |
|---|---|---|
| Hiển thị model còn lệch / scale chưa chuẩn cho từng marker (floor vs wall) | Trung bình | Cần tinh chỉnh `defaultRotX` và `autoFitSize` per surface. |
| Nhận diện marker còn nhầm vài chỗ | Trung bình | Có thể giảm bằng: tăng `warmupTolerance`, tăng tương phản ảnh marker, tránh marker đối xứng. |
| Tab Logs/GLB hiển thị chưa thân thiện (text mono, có thể scroll bị giới hạn) | Thấp | Polish UI sau. |
| Chưa có audio (file `audio: {}` trong models đang rỗng) | Thấp | Thêm khi có asset. |
| GLB Triceratops vẫn đang nặng | Thấp | Có thể nén Draco sau. |

---

## 7. Các bước cần chuẩn bị tiếp theo

### 7.1. Tinh chỉnh hiển thị (ưu tiên 1)
- [ ] Bật tab GLB trên phone, ghi lại `bbox` của 2 model ⇒ tinh chỉnh `autoFitSize` per surface.
- [ ] Thêm field `surfaceOverrides: { floor: {position, rotation, scale}, wall: {...} }` vào `ModelDef` để control độc lập 2 mặt.
- [ ] Test lại với người thật ở khoảng cách 50cm – 2m.

### 7.2. Tăng độ chính xác tracking
- [ ] Thử ảnh marker có nhiều chi tiết hơn, không đối xứng.
- [ ] Tăng `warmupTolerance: 5`, `missTolerance: 60` cho ổn định.
- [ ] Đo false-positive: chĩa vào marker A xem có bắn anchor B không.

### 7.3. Hoàn thiện nội dung
- [ ] Bổ sung `info.description` chính xác từ tài liệu CUSC.
- [ ] Thêm audio (tiếng kêu) cho mỗi loài.
- [ ] Thiết kế lại popup info (typography, hình minh hoạ phụ).

### 7.4. Mở rộng số loài
- [ ] Thêm 3-5 loài khác (ví dụ T-Rex, Stegosaurus, Brachiosaurus).
- [ ] Mỗi loài + 2 marker ⇒ tổng 14 marker, file `targets.mind` ~3 MB (vẫn chấp nhận được).
- [ ] Cần test giới hạn: MindAR khuyến nghị < 20 target/file.

### 7.5. Triển khai (production)
- [ ] Build static qua `npm run build` ⇒ Netlify / Vercel / GitHub Pages.
- [ ] Domain HTTPS thật (Let's Encrypt) thay cho cert tự ký.
- [ ] Lazy load GLB lớn (chỉ load khi marker tương ứng được nhìn lần đầu).
- [ ] Thêm Service Worker cache GLB + `targets.mind` cho offline.

### 7.6. UX / polish
- [ ] Loading screen có progress bar thật (tải GLB).
- [ ] Hint hướng dẫn user lần đầu (tutorial overlay).
- [ ] Nút share / chụp ảnh đẹp (tích hợp `saveSnapshot` thành nút chính thức).

---

## 8. Tham chiếu file

| File | Vai trò |
|---|---|
| `index.html` | UI + overlay |
| `src/main.js` | Wiring UI ↔ engine |
| `src/models.js` | Registry model + marker |
| `src/ar-config.js` | Config tracking |
| `src/ar-engine-hybrid.js` | Engine chính |
| `src/model-loader.js` | GLB loader |
| `scripts/compile-mind.mjs` | Build `targets.mind` |
| `public/assets/targets/targets.mind` | File marker đa-target |
| `public/assets/targets/images/` | PNG nguồn cho compile |
| `public/assets/models/` | File GLB |
| `docs/REPORT-multi-target-merge.md` | Báo cáo kỹ thuật gộp marker |
| `docs/DESIGN-functional.md` | File này |
