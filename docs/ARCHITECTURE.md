# CUSC-AR – Kiến trúc & Quy ước mở rộng

> Tài liệu này mô tả cấu trúc dự án sau khi refactor (2026-04). Mục tiêu: triển
> khai 15+ model khủng long, mỗi model có nhiều animation và âm thanh tương tác,
> với code dễ mở rộng và tài nguyên dễ quản lý.

---

## 1. Tổng quan luồng

```
 ┌────────────┐    ┌────────────────┐    ┌───────────────────┐
 │ index.html │ →  │ src/main.js    │ →  │ HybridAREngine    │
 │  (UI HTML) │    │ (bootstrap +UI)│    │ (MindAR + Three)  │
 └────────────┘    └────────────────┘    └─────────┬─────────┘
                                                   │
                ┌──────────────────────────────────┼─────────────────────┐
                │                                  │                     │
                ▼                                  ▼                     ▼
       ┌──────────────────┐               ┌─────────────────┐   ┌────────────────┐
       │ src/models.js    │               │ ModelLoader     │   │ AudioManager   │
       │ (registry + meta)│               │ (GLB + filter   │   │ (1 roar/model) │
       └──────────────────┘               │  + animations)  │   └────────────────┘
                                          └─────────────────┘
```

* **MindAR** giữ vai trò gốc: marker thấy → model là **con của `anchor.group`** →
  hiện tại đúng vị trí. Marker mất → MindAR ẩn anchor → model biến mất.
  Đây là **STRICT mode**, hoạt động đúng với nhiều marker trong cùng `.mind`.
* Khi user bấm **"Quan sát"**: engine **chụp snapshot** matrix world của model
  đang tracking → tách ra `freezeGroup` → bật gyro để xoay nhìn quanh. Các
  marker khác bị tạm ẩn để không xen vào.
* **Tap** vào model → callback (`AudioManager` phát roar + UI hiện popup info).

---

## 2. Sơ đồ thư mục

```
CUSC-AR/
├─ docs/
│  └─ ARCHITECTURE.md           ← tài liệu này
│
├─ public/                       ← Vite serve nguyên si
│  └─ assets/
│     ├─ icons/
│     ├─ models/                 ← *.glb (1 file/model)
│     ├─ audio/                  ← *.mp3 / *.ogg theo modelId
│     └─ targets/
│        ├─ targets.mind         ← compile gộp TẤT CẢ marker
│        └─ images/              ← PNG nguồn để compile lại sau
│
├─ src/
│  ├─ main.js                    ← entry: bootstrap, wire UI
│  ├─ ar-config.js               ← cấu hình ENGINE (không chứa data model)
│  ├─ models.js                  ← REGISTRY 15+ model + meta
│  ├─ ar-engine-hybrid.js        ← engine chính (image marker + gyro)
│  ├─ model-loader.js            ← GLB loader + animation mixer
│  ├─ audio-manager.js           ← preload + play HTMLAudio theo id
│  └─ styles/main.css
│
├─ index.html
├─ vite.config.js
└─ package.json
```

* Root `assets/` (nếu có) chỉ là staging — runtime KHÔNG dùng.
* Mọi đường dẫn trong code dùng relative: `assets/...` (Vite serve từ `public/`).

---

## 3. Quy ước cấu trúc dữ liệu

### 3.1 Model registry — `src/models.js`

```js
{
  id: "spinosaurus",            // duy nhất, snake-case không dấu
  name: "Spinosaurus",          // tên hiển thị
  modelUrl: "assets/models/spinosaurus-idle.glb",

  // Mesh con cần loại bỏ sau khi load (vd. shadow plane do Blender export)
  ignoreNodes: ["Plane"],

  // Map tên animation → index/name trong file GLB
  // Hiện tại chỉ có Idle. Khi designer cấp thêm clip, bổ sung ở đây.
  animations: {
    idle: 0,                    // string hoặc number
    // walk: "Walk",
    // roar: "Roar",
    // attack: 2,
  },
  defaultAnimation: "idle",     // clip phát tự động khi spawn

  // Âm thanh (key tuỳ ý). UI tap mặc định phát "roar" nếu có.
  audio: {
    roar: "assets/audio/spinosaurus/roar.mp3",
  },

  // Override scale (nếu null → dùng autoFitSize toàn cục)
  autoFitSize: null,            // hoặc số: 1.5 → cạnh max = 1.5 × marker
  position: { x: 0, y: 0, z: 0 },
  rotation: null,               // null → engine tự đặt theo surface
  scale:    { x: 1, y: 1, z: 1 },

  info: {
    title: "Spinosaurus aegyptiacus",
    description: "...",
  },

  // Mỗi model có ≥1 marker. surface quyết định rotation mặc định.
  targets: [
    { targetIndex: 0, surface: "floor" },  // marker nằm ngang trên bàn/sàn
    { targetIndex: 1, surface: "wall"  },  // marker dán dọc trên tường
  ],
}
```

### 3.2 Engine config — `src/ar-config.js`

Chỉ chứa **tham số engine**, KHÔNG chứa data model:

```js
{
  mindFile: "assets/targets/targets.mind",
  autoFitSize: 1.5,
  tracking: { filterMinCF, filterBeta, warmupTolerance, missTolerance },
}
```

### 3.3 File `targets.mind`

* Compile 1 lần từ TẤT CẢ ảnh marker (PNG trong `public/assets/targets/images/`)
* Thứ tự upload PHẢI khớp `targetIndex` đã khai báo trong `models.js`.
* Quy ước index: theo cặp **(model, surface)**:
    ```
    Index  Marker
    0      spinosaurus-floor
    1      spinosaurus-wall
    2      triceratops-floor
    3      triceratops-wall
    4      <model-3>-floor
    5      <model-3>-wall
    ...
    ```
* Khi thêm model mới: thêm 2 ảnh vào cuối danh sách compile, model mới nhận
  index `2N`/`2N+1`.

---

## 4. Thiết kế ảnh marker

> **Quan trọng**: chất lượng marker quyết định 90% trải nghiệm. Tham khảo
> `public/assets/targets/README.md`.

* **Nên**: ảnh nhiều chi tiết (poster phim, bìa sách, tranh tự nhiên, photo
  texture vảy/lông…). Nhiều đặc trưng nhỏ không đối xứng.
* **Tránh**: viền vuông giống QR, vùng trắng/đen lớn, đối xứng cao, logo phẳng.
* **Tối thiểu**: 400×400px, in giấy ≥A5, không phản quang.
* Mỗi model 2 ảnh (floor + wall) — có thể CÙNG nội dung nhưng để nguyên,
  hoặc thiết kế 2 layout khác nhau (vd. floor có chữ ngang, wall có chữ dọc).

---

## 5. Performance budget (cho 15+ model)

| Hạng mục | Mục tiêu |
|---|---|
| File GLB | ≤ 10 MB / model (Spinosaurus 4.7MB OK, **Triceratops 52MB cần nén Draco**) |
| Tổng tải lần đầu | ≤ 30 MB (lazy-load nếu vượt) |
| Triangles / model | ≤ 100k |
| Texture | ≤ 2048×2048, format basis/ktx2 |
| Audio (.mp3) | ≤ 200 KB / file, 22kHz mono đủ cho roar |
| `targets.mind` | ≤ 5 MB cho 30 markers |

* **Lazy-load**: khi quá 5 model, chuyển sang chỉ tải GLB của model có marker
  được nhìn thấy lần đầu. Hiện tại load tất cả ngay từ đầu.
* **Compress**: dùng `gltf-pipeline` hoặc Blender export với Draco. Cập nhật
  `model-loader.js` đã sẵn `DRACOLoader`.

---

## 6. Tương tác trong "chế độ Quan sát" (gyro lock)

Workflow user:
1. Quét marker → model spawn, bám marker
2. Bấm **Quan sát** → bật gyro, model "đứng yên" trong không gian phòng
3. Đi quanh nhìn / xoay điện thoại
4. **Tap vào model** → :
   - Phát animation riêng (hiện tại không có, sẽ là `roar`/`attack` sau này)
   - Phát file `audio.roar`
   - Hiện popup info
5. Nút xoay (⟲ ⟳) và zoom (+ −) để chỉnh model thủ công
6. Bấm ⟳ reset → quét lại marker mới

Animation event-driven (kế hoạch tương lai):
```
tap        → roar      (1 lần, rồi về idle)
double-tap → attack    (1 lần, rồi về idle)
long-press → walk      (loop trong khi nhấn)
```
Tạm thời chỉ implement `tap = roar audio + popup`.

---

## 7. Quy trình thêm model mới (checklist)

1. [ ] Đặt file GLB vào `public/assets/models/<id>.glb` (≤10 MB, đã nén Draco)
2. [ ] Chuẩn bị 2 ảnh marker `<id>-floor.png`, `<id>-wall.png` (≥400×400, giàu chi tiết)
3. [ ] Đặt 2 ảnh vào `public/assets/targets/images/`
4. [ ] Recompile `targets.mind` với TẤT CẢ ảnh theo đúng thứ tự (xem §3.3)
5. [ ] (Tuỳ chọn) Đặt `roar.mp3` vào `public/assets/audio/<id>/roar.mp3`
6. [ ] Thêm entry mới vào `src/models.js` với `targetIndex` đúng
7. [ ] Test: scan marker → model hiện → tap → âm thanh phát + popup hiện

---

## 8. File/thư mục đã loại bỏ trong refactor

| Path | Lý do |
|---|---|
| `src/ar-engine.js` | strict mode (model bám phẳng marker) — không dùng |
| `src/ar-engine-webxr.js` | WebXR markerless — không dùng, iOS không hỗ trợ |
| `src/ar-engine-gyro.js` | mode `world` standalone — gộp vào HybridAREngine.enableGyro() |
| `assets/targets/<model>/*-scale*.mind` | Sản phẩm thử nghiệm tách scale, đã thay bằng `targets.mind` gộp |
| `assets/models/*.glb` | Trùng `public/assets/models/` |
| `assets/icons/`, `assets/images/` | Trùng / không dùng runtime |
