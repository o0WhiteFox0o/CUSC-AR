# CUSC-AR – Web AR Image Tracking

Ứng dụng **Web AR** hiển thị model 3D khi camera quét qua ảnh mục tiêu (image target).  
Chạy trực tiếp trên trình duyệt mobile – **không cần cài app**.

---

## Công nghệ sử dụng

| Thành phần | Công nghệ | Phiên bản |
|---|---|---|
| AR Engine | [MindAR.js](https://hiukim.github.io/mind-ar-js-doc/) | 1.2.5 |
| 3D Rendering | [Three.js](https://threejs.org/) | 0.153.x |
| Bundler / Dev Server | [Vite](https://vitejs.dev/) | 5.4.x |
| HTTPS (dev) | [@vitejs/plugin-basic-ssl](https://github.com/nicolo-ribaudo/vite-plugin-basic-ssl) | 1.1.x |
| Model Format | GLTF / GLB | — |

---

## Cấu trúc dự án

```
CUSC-AR/
├── index.html                  # Trang HTML chính
├── package.json                # Dependencies & scripts
├── vite.config.js              # Cấu hình Vite (HTTPS, port)
├── README.md
│
├── assets/
│   ├── icons/
│   │   └── scan.svg            # Icon gợi ý scan
│   ├── models/
│   │   └── AM_Shrimp.glb       # Model 3D (con tôm)
│   └── targets/
│       └── Shrimp.mind         # File image target đã biên dịch
│
└── src/
    ├── main.js                 # Entry point – khởi chạy app
    ├── ar-config.js            # ⚙️ CẤU HÌNH: map ảnh → model
    ├── ar-engine.js            # MindAR + Three.js engine
    ├── model-loader.js         # GLTF/GLB loader + animation manager
    └── styles/
        └── main.css            # Giao diện (loading, UI overlay)
```

---

## Cài đặt & Chạy

### Yêu cầu

- [Node.js](https://nodejs.org/) >= 18

### Các bước

```bash
# 1. Cài dependencies
npm install --ignore-scripts

# 2. Chạy dev server (HTTPS + mở cho mạng LAN)
npm run dev
```

Kết quả:

```
VITE ready
➜  Local:   https://localhost:8443/
➜  Network: https://192.168.x.x:8443/
```

### Mở trên điện thoại

1. Đảm bảo điện thoại **cùng mạng WiFi** với máy tính
2. Mở trình duyệt trên điện thoại, nhập `https://<IP-máy-tính>:8443`
3. Trình duyệt sẽ cảnh báo certificate tự ký → nhấn **"Advanced"** → **"Proceed"**
4. Cho phép quyền **Camera** khi được hỏi
5. Hướng camera vào ảnh mục tiêu → model 3D sẽ xuất hiện

> **Lưu ý:** Camera trên mobile **bắt buộc HTTPS**. Plugin `basic-ssl` của Vite tự tạo certificate.

---

## Cấu hình (`src/ar-config.js`)

Đây là file duy nhất bạn cần chỉnh sửa khi thêm/bớt target.

```js
const AR_CONFIG = {
  // Đường dẫn tới file .mind
  mindFile: "assets/targets/Shrimp.mind",

  targets: [
    {
      targetIndex: 0,                           // Index ảnh trong file .mind
      modelUrl: "assets/models/AM_Shrimp.glb",  // Model 3D tương ứng
      position: { x: 0, y: 0, z: 0 },          // Vị trí
      rotation: { x: 0, y: 0, z: 0 },          // Góc xoay (radian)
      scale:    { x: 0.5, y: 0.5, z: 0.5 },    // Tỷ lệ
      animation: null,                           // Animation clip (xem bên dưới)
    },
  ],
};
```

### Các trường cấu hình

| Trường | Kiểu | Mô tả |
|---|---|---|
| `targetIndex` | `number` | Thứ tự ảnh khi biên dịch file `.mind` (bắt đầu từ 0) |
| `modelUrl` | `string` | Đường dẫn tới file `.glb` hoặc `.gltf` |
| `position` | `{x,y,z}` | Vị trí model so với ảnh target |
| `rotation` | `{x,y,z}` | Góc xoay (đơn vị radian) |
| `scale` | `{x,y,z}` | Tỷ lệ phóng to / thu nhỏ |
| `animation` | `null \| string \| number` | `null` = không animation, `"Idle"` = theo tên, `0` = theo index |

---

## Hướng dẫn mở rộng (nhiều ảnh – nhiều model)

### Bước 1: Biên dịch nhiều ảnh thành file `.mind`

1. Truy cập **[MindAR Image Target Compiler](https://hiukim.github.io/mind-ar-js-doc/tools/compile)**
2. Nhấn **"+"** để upload **nhiều ảnh** cùng lúc (ảnh 1, ảnh 2, ảnh 3...)
3. Nhấn **"Start"** để biên dịch
4. Tải file `.mind` về → đặt vào `assets/targets/`

> **Mẹo chọn ảnh tốt:** Ảnh nên có nhiều chi tiết, tương phản cao, không đối xứng, kích thước >= 400×400px.

### Bước 2: Thêm model 3D

Đặt các file `.glb` vào `assets/models/`:
```
assets/models/
├── AM_Shrimp.glb     # Model cho ảnh 1
├── robot.glb          # Model cho ảnh 2
└── flower.glb         # Model cho ảnh 3
```

> Model nên dưới **5MB** để tải nhanh trên mobile. Nguồn model miễn phí: [Sketchfab](https://sketchfab.com), [Poly Pizza](https://poly.pizza), [Kenney](https://kenney.nl/assets)

### Bước 3: Cập nhật cấu hình

Mở `src/ar-config.js`, thêm entry cho từng ảnh:

```js
const AR_CONFIG = {
  mindFile: "assets/targets/multi-targets.mind",

  targets: [
    {
      targetIndex: 0,                           // Ảnh thứ 1
      modelUrl: "assets/models/AM_Shrimp.glb",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.5, y: 0.5, z: 0.5 },
      animation: null,
    },
    {
      targetIndex: 1,                           // Ảnh thứ 2
      modelUrl: "assets/models/robot.glb",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.3, y: 0.3, z: 0.3 },
      animation: 0,                             // Phát animation đầu tiên
    },
    {
      targetIndex: 2,                           // Ảnh thứ 3
      modelUrl: "assets/models/flower.glb",
      position: { x: 0, y: 0.1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      animation: "Bloom",                       // Phát animation tên "Bloom"
    },
  ],
};
```

**Quy tắc:** `targetIndex` phải khớp với thứ tự ảnh khi upload lên MindAR Compiler (bắt đầu từ 0).

### Bước 4: Chạy lại

```bash
npm run dev
```

Giờ khi quét ảnh 1 → hiện model tôm, quét ảnh 2 → hiện robot, quét ảnh 3 → hiện hoa.

---

## Giải thích luồng hoạt động

```
Camera mở → MindAR phân tích frame → Nhận diện ảnh target
    → Lấy targetIndex → Hiển thị model 3D tương ứng trên ảnh
    → Camera mất ảnh → Ẩn model
```

1. **`main.js`** – Khởi tạo `AREngine`, bắt đầu tracking, xử lý sự kiện UI
2. **`ar-engine.js`** – Tạo MindAR instance, setup Three.js scene (ánh sáng, renderer), tạo anchor cho mỗi target
3. **`model-loader.js`** – Tải file GLB/GLTF bằng `GLTFLoader`, quản lý animation qua `AnimationMixer`
4. **`ar-config.js`** – File cấu hình duy nhất, map targetIndex → model

---

## Scripts

| Lệnh | Mô tả |
|---|---|
| `npm run dev` | Chạy dev server HTTPS tại port 8443, mở cho LAN |
| `npm run build` | Build production vào thư mục `dist/` |
| `npm run preview` | Preview bản build production |

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

| Vấn đề | Nguyên nhân & Giải pháp |
|---|---|
| Camera không mở | Phải dùng HTTPS. Kiểm tra quyền camera trong cài đặt trình duyệt |
| Model không hiện khi quét | Kiểm tra `modelUrl` trong `ar-config.js` có đúng tên file không |
| Quét ảnh nhưng không nhận | Ảnh target quá đơn giản / đối xứng / ít chi tiết. Biên dịch lại với ảnh tốt hơn |
| Lag trên điện thoại | Giảm kích thước model (< 5MB), giảm polygon count |
| `npm install` lỗi `canvas` | Chạy `npm install --ignore-scripts` (canvas chỉ cần cho server-side, không ảnh hưởng AR) |
| Vite báo port đang dùng | Đổi port trong `vite.config.js` → `server.port` |

---

## License

MIT
