# Báo cáo: Gộp nhiều ảnh marker vào một file `targets.mind`

**Ngày:** 30/04/2026  
**Dự án:** CUSC-AR – Web AR cho trưng bày khủng long  
**Phạm vi:** Kiến trúc đa-marker với MindAR.js 1.2.5

---

## 1. Bối cảnh

Dự án ban đầu chỉ có **1 marker** (Shrimp.mind) hiển thị **1 model** (tôm). Khi mở rộng sang **2 model khủng long** (Spinosaurus, Triceratops) × **2 mặt phẳng** (sàn, tường) ⇒ tổng **4 marker**, đặt ra câu hỏi:

> Nên dùng **4 file `.mind` riêng lẻ** (mỗi file 1 ảnh) hay **1 file `.mind` chứa cả 4 ảnh** (multi-target)?

Lần thử nghiệm đầu (sáng 30/04) chọn phương án 4 file riêng + cycle (luân phiên load/unload). Kết quả: **thất bại** — model không hiển thị, marker bị nhận diện sai (false-positive). Phải revert về commit ổn định `09f93ce` và xây lại theo phương án multi-target.

---

## 2. Lý do chọn multi-target (1 file `targets.mind`)

### 2.1. Đặc điểm của MindAR

MindAR khi `start()` sẽ:
1. Tải file `.mind` → giải nén thành mảng `imageTargets[]` (mỗi target là tập hợp keypoint + descriptor).
2. Mỗi frame camera, **chạy detector song song** trên toàn bộ `imageTargets[]`.
3. Khi 1 target đạt ngưỡng tin cậy → bắn `onTargetFound(targetIndex)` cho anchor tương ứng.

⇒ MindAR **được thiết kế cho multi-target**: 1 instance + N anchor, không phải N instance + 1 anchor.

### 2.2. Vấn đề của "4 file riêng + cycle"

| Vấn đề | Mô tả |
|---|---|
| **False-positive** | Mỗi `.mind` chỉ có 1 ảnh ⇒ MindAR dễ "match đại" khi gặp ảnh tương tự (vì không có ảnh khác để so sánh, threshold tương đối). |
| **Teardown timing** | Cycle phải `stop()` instance cũ rồi `init()` instance mới ⇒ canvas WebGL bị reset, renderer phải tạo lại, Three.js scene mất state. |
| **GLB reload** | Mỗi cycle reload GLB ⇒ giật, tốn băng thông. |
| **Phức tạp hoá UX** | User phải bấm "next" hoặc engine tự đoán ⇒ không thân thiện. |
| **Mất tracking liên tục** | Khi user chĩa marker B mà engine đang ở mode marker A ⇒ không nhận diện được. |

### 2.3. Lợi thế của multi-target

| Lợi thế | Mô tả |
|---|---|
| **Tracking đồng thời** | Cả 4 marker được detect song song mỗi frame. User chĩa cái nào, engine tự bắn đúng anchor. |
| **Phân biệt tốt hơn** | Khi compile chung, thuật toán keypoint matching đối chiếu giữa các ảnh ⇒ giảm nhầm lẫn. |
| **Một instance** | Không có teardown, GLB chỉ load 1 lần (cache theo `modelDef.id` ⇒ Spinosaurus floor + wall dùng chung 1 GLB clone qua `SkeletonUtils.clone`). |
| **Performance ổn định** | 1 renderer, 1 scene, 1 animation loop. |
| **Mở rộng dễ** | Thêm khủng long mới = thêm PNG vào `MARKERS[]` + entry vào `MODELS[]`, recompile. |

---

## 3. Kỹ thuật gộp ảnh

### 3.1. Compile script (`scripts/compile-mind.mjs`)

MindAR cung cấp class `Compiler` (trong `mind-ar/dist/mindar-image-three.prod.js`) chạy **trên browser** vì dùng `Image`/`Canvas` API. Để chạy headless ⇒ dùng **Playwright (msedge)** mở trang HTML tạm có sẵn `MindARCompiler` và inject hàm:

```js
window.__compile = async (b64Array) => {
  const imgs = await Promise.all(b64Array.map((b64) => {
    const img = new Image();
    img.src = b64;
    return img.decode().then(() => img);
  }));
  const compiler = new MindARCompiler.Compiler();
  await compiler.compileImageTargets(imgs, (p) => console.log(`progress ${p}%`));
  const buffer = await compiler.exportData();
  return Array.from(new Uint8Array(buffer));
};
```

Node side đọc từng PNG → base64 → gọi `page.evaluate(__compile, b64Array)` → ghi kết quả ra `public/assets/targets/targets.mind` (1.3 MB).

**Thứ tự ảnh = `targetIndex`** trong runtime:

```js
// scripts/compile-mind.mjs
const MARKERS = [
  "spinosaurus-floor.png",   // → targetIndex 0
  "spinosaurus-wall.png",    // → targetIndex 1
  "triceratops-floor.png",   // → targetIndex 2
  "triceratops-wall.png",    // → targetIndex 3
];
```

### 3.2. Mapping target ↔ model (`src/models.js`)

```js
export const MODELS = [
  {
    id: "spinosaurus",
    modelUrl: "assets/models/spinosaurus-idle.glb",
    targets: [
      { targetIndex: 0, surface: "floor" },
      { targetIndex: 1, surface: "wall"  },
    ],
  },
  {
    id: "triceratops",
    modelUrl: "assets/models/Triceratops_idle.glb",
    ignoreNodes: ["Plane"],
    targets: [
      { targetIndex: 2, surface: "floor" },
      { targetIndex: 3, surface: "wall"  },
    ],
  },
];
```

`flattenTargets()` trả về list phẳng đã sort theo `targetIndex`, engine duyệt và `addAnchor(targetIndex)` tương ứng.

### 3.3. Engine pattern (`src/ar-engine-hybrid.js`)

```js
const mindar = new MindARThree({ imageTargetSrc: "assets/targets/targets.mind", ... });
const glbCache = new Map();

for (const tgt of flattenTargets()) {
  const def = tgt.modelDef;
  const anchor = mindar.addAnchor(tgt.targetIndex);

  let cached = glbCache.get(def.id);
  if (!cached) cached = await loader.load(def.modelUrl);
  // QUAN TRỌNG: dùng SkeletonUtils.clone (KHÔNG dùng .clone(true) cho skinned mesh)
  const modelScene = SkeletonUtils.clone(cached.scene);

  const wrapper = new THREE.Group();
  wrapper.add(modelScene);
  scene.add(wrapper);   // wrapper trong scene root, KHÔNG phải con của anchor.group

  anchor.onTargetFound = () => { item.tracking = true; wrapper.visible = true; };
  anchor.onTargetLost  = () => { item.tracking = false; };
  items.push({ targetIndex, surface, def, anchor, wrapper, modelScene, ... });
}
```

### 3.4. Wrapper-in-scene-root pattern

Mỗi frame, copy `anchor.group.matrixWorld → wrapper.matrix`, lerp nhẹ (0.25):

- Frame đầu: copy thẳng (snap).
- Các frame sau: `lerp(position)` + `slerp(quaternion)` ⇒ smooth, không giật.
- Wrapper là con của `scene` (không phải `anchor.group`) ⇒ khi marker mất, model vẫn lưu vị trí cuối, sẵn sàng bật gyro để xoay quanh.

### 3.5. Bug tránh được: `SkinnedMesh.clone()`

`THREE.Object3D.clone(true)` **không clone đúng `SkinnedMesh`**: bones giữ reference đến skeleton gốc. Khi 2 marker (floor + wall của cùng Spinosaurus) cùng dùng 1 GLB clone ⇒ skeleton bị "share" ⇒ model render ở bind pose lệch hoặc invisible.

⇒ **Bắt buộc** dùng `SkeletonUtils.clone()` từ `three/examples/jsm/utils/SkeletonUtils.js`. Đây là lỗi **trầm trọng** và khó debug nhất trong session này (model không hiện chỉ vì clone sai cách).

---

## 4. So sánh cuối cùng

| Tiêu chí | 4 file riêng + cycle | **1 file `targets.mind`** ✅ |
|---|---|---|
| Tracking đồng thời | ❌ | ✅ |
| False-positive | Cao | Thấp |
| Số instance MindAR | 4 (luân phiên) | 1 |
| Số GLB load | N×lượt cycle | 1 lần (cache) |
| Code phức tạp | Cao (state machine cycle) | Thấp |
| Performance | Giật khi switch | Mượt |
| File `.mind` | 4 file (~mỗi 300KB) | 1 file (~1.3 MB) |

**Kết luận:** Multi-target là phương án chuẩn của MindAR. Mọi dự án đa-marker nên dùng pattern này.

---

## 5. Tài liệu tham khảo

- MindAR docs – Image Targets: https://hiukim.github.io/mind-ar-js-doc/quick-start/overview/
- Three.js – SkeletonUtils.clone(): https://threejs.org/docs/#examples/en/utils/SkeletonUtils
- MindAR Compiler API: `mind-ar/dist/mindar-image-three.prod.js` → `MindARCompiler.Compiler`
