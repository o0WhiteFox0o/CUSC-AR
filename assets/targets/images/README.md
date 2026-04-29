# Target Images

Đặt ảnh marker nguồn vào thư mục này theo quy tắc đặt tên:
  `{model-id}-{surface}.png`

Ví dụ:
  spinosaurus-floor.png   ← ảnh in ra, đặt nằm ngang trên bàn/sàn
  spinosaurus-wall.png    ← ảnh dán đứng trên tường

## Quy trình compile .mind

1. Chuẩn bị ảnh (PNG/JPG, tốt nhất ≥ 500×500px, nhiều chi tiết, tương phản cao).
2. Sắp xếp ảnh ĐÚNG THỨ TỰ khớp với `targetIndex` trong `ar-config.js`:
     Index 0 → upload đầu tiên
     Index 1 → upload thứ hai
     ...
3. Truy cập: https://hiukim.github.io/mind-ar-js-doc/tools/compile
4. Upload theo đúng thứ tự → nhấn "Start" → tải file `targets.mind`.
5. Đổi tên và đặt vào `assets/targets/` rồi cập nhật `mindFile` trong `ar-config.js`.

## Quy ước thêm model mới

Mỗi model mới cần 2 ảnh: floor + wall.
targetIndex tiếp tục từ index cuối cùng hiện tại.

Ví dụ hiện tại:
  0 → spinosaurus-floor.png
  1 → spinosaurus-wall.png

Model mới (triceratops):
  2 → triceratops-floor.png
  3 → triceratops-wall.png
