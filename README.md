# CUSC-AR – Web AR cho trưng bày khủng long

Ứng dụng **Web AR** hiển thị model 3D khủng long khi camera quét ảnh marker (sàn / tường).
Chạy trực tiếp trên trình duyệt mobile – **không cần cài app**.

> Chi tiết kiến trúc xem [`docs/DESIGN-functional.md`](docs/DESIGN-functional.md).
> Lý do chọn multi-target xem [`docs/REPORT-multi-target-merge.md`](docs/REPORT-multi-target-merge.md).

---

## Công nghệ

| Thành phần | Công nghệ | Phiên bản |
|---|---|---|
| AR Engine | [MindAR.js](https://hiukim.github.io/mind-ar-js-doc/) | 1.2.5 |
| 3D Rendering | [Three.js](https://threejs.org/) | 0.153.x |
| Bundler | [Vite](https://vitejs.dev/) | 5.4.x |
| HTTPS dev | `@vitejs/plugin-basic-ssl` | 1.1.x |
| Compiler marker | `playwright-core` (msedge headless) | 1.59.x |
| Model | GLTF / GLB (DRACO) | — |

---

## Cấu trúc dự án

```
CUSC-AR/
├── index.html
├── package.json
├── vite.config.js
├── README.md
│
├── docs/
│   ├── DESIGN-functional.md          # Thiết kế chức năng
│   └── REPORT-multi-target-merge.md  # Báo cáo gộp marker
│
├── scripts/
│   └── compile-mind.mjs              # Build targets.mind từ PNG
│
├── public/
│   └── assets/
│       ├── models/
│       │   ├── spinosaurus-idle.glb
│       │   └── Triceratops_idle.glb
│       └── targets/
│           ├── targets.mind          # 4 markers trong 1 file
│           └── images/
│               ├── spinosaurus-floor.png   (targetIndex 0)
│               ├── spinosaurus-wall.png    (targetIndex 1)
│               ├── triceratops-floor.png   (targetIndex 2)
│               └── triceratops-wall.png    (targetIndex 3)
│
└── src/
    ├── main.js                       # Wire UI ↔ engine
    ├── ar-config.js                  # Config tracking
    ├── models.js                     # Registry model + marker
    ├── ar-engine-hybrid.js           # Engine chính (MindAR + Three.js)
    ├── ar-engine.js                  # Engine cũ "image-strict"
    ├── ar-engine-gyro.js             # Engine "world" gyro
    ├── ar-engine-webxr.js            # Stub WebXR
    ├── model-loader.js               # GLB loader + animation + ignoreNodes
    └── styles/main.css
```

---

## Cài đặt & Chạy

```bash
npm install --ignore-scripts
npm run dev
```

Vite ready trên `https://localhost:8443/` và `https://<LAN-IP>:8443/`.

### Mở trên điện thoại
1. Cùng WiFi với máy dev.
2. Vào `https://<LAN-IP>:8443/`.
3. Bypass cảnh báo cert tự ký → cho phép Camera.
4. Chĩa vào ảnh marker → model 3D hiện trên marker.

> Camera mobile **bắt buộc HTTPS**. Plugin `basic-ssl` tự tạo cert.

---

## Scripts

| Lệnh | Mô tả |
|---|---|
| `npm run dev` | Dev server HTTPS port 8443 (mở cho LAN) |
| `npm run build` | Build production vào `dist/` |
| `npm run preview` | Preview bản build |
| `npm run compile-mind` | Compile PNG ở `public/assets/targets/images/` → `targets.mind` |

---

## Thêm model / marker mới

### 1. Bỏ ảnh marker
Đặt PNG vào `public/assets/targets/images/`.

### 2. Khai báo trong `scripts/compile-mind.mjs`
```js
const MARKERS = [
  "spinosaurus-floor.png",   // → targetIndex 0
  "spinosaurus-wall.png",    // → targetIndex 1
  "triceratops-floor.png",   // → targetIndex 2
  "triceratops-wall.png",    // → targetIndex 3
  "your-new-marker.png",     // → targetIndex 4
];
```
Thứ tự = `targetIndex` runtime.

### 3. Compile
```bash
npm run compile-mind
```
⇒ `public/assets/targets/targets.mind` được tạo lại.

### 4. Khai báo model trong `src/models.js`
```js
{
  id: "your-model",
  name: "Your Model",
  modelUrl: "assets/models/your-model.glb",
  ignoreNodes: ["Plane"],          // tên node trong GLB cần xoá khi load
  animations: { idle: 0 },
  defaultAnimation: "idle",
  autoFitSize: 1.5,
  position: { x: 0, y: 0, z: 0 },
  rotation: null,                  // null → auto: floor=π/2 quanh X, wall=0
  scale: { x: 1, y: 1, z: 1 },
  info: { title: "...", description: "..." },
  targets: [
    { targetIndex: 4, surface: "floor" },
  ],
},
```

### 5. Reload trang
Engine tự `addAnchor(targetIndex)` cho mọi entry trong `flattenTargets()`.

---

## Cấu hình tracking (`src/ar-config.js`)

```js
{
  mindFile: "assets/targets/targets.mind",
  autoFitSize: 1.5,                 // override per-model trong models.js
  tracking: {
    filterMinCF: 0.0001,
    filterBeta: 0.001,
    warmupTolerance: 2,
    missTolerance: 30,
  },
}
```

---

## Debug trên mobile

Nút **☰** góc trên-trái mở debug panel:

| Tab / Nút | Tác dụng |
|---|---|
| **Stats** | Tracking + transform real-time mỗi item |
| **Logs** | 20 dòng `console.*` cuối (thay F12) |
| **GLB** | Mesh count / tris / bbox của mỗi GLB |
| **👁 Force show** | Hiện toàn bộ model trước camera (test render) |
| **→ Next anchor** | Lần lượt hiện từng anchor (test riêng từng GLB) |
| **📸 Snapshot** | Tải PNG canvas hiện tại |

Status pill ở giữa trên: cam = đang quét, xanh = đã thấy + tên model + mặt phẳng.

---

## Trình duyệt hỗ trợ

| Trình duyệt | Hỗ trợ |
|---|---|
| Chrome Android | ✅ |
| Safari iOS 15+ | ✅ |
| Firefox Android | ✅ |
| Samsung Internet | ✅ |
| Chrome Desktop | ✅ (webcam) |

---

## Xử lý lỗi thường gặp

| Vấn đề | Giải pháp |
|---|---|
| Camera không mở | Phải HTTPS. Kiểm tra quyền camera. |
| Model không hiện khi quét | Mở debug ☰ → Logs xem error. Bấm 👁 Force show để test render độc lập. |
| Quét ảnh nhưng không nhận | Ảnh marker quá đơn giản / đối xứng. Compile lại với ảnh chi tiết hơn. |
| Lag trên điện thoại | Giảm GLB (< 5MB), bật Draco compression. |
| `npm install` lỗi `canvas` | `npm install --ignore-scripts`. |
| Vite báo port đang dùng | Đổi `server.port` trong `vite.config.js`. |
| Skinned model render lệch / invisible | **Phải dùng `SkeletonUtils.clone`** thay cho `scene.clone(true)` khi share GLB cho nhiều marker. |

---

## License

MIT
