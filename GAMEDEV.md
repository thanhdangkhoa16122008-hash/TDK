# Quy trình làm game với repo TDK

Quy tắc cho mọi game HTML làm từ repo này. Mục tiêu: chạy mượt trên điện thoại Android tầm trung, màn ngang.

## 1. Bắt đầu
1. Chọn template gần nhất trong `html/templates/`, copy sang `html/games/<ten-game>/`.
2. Xem `html/assets/catalog.png` để chọn model; tên animation ở `catalog.json`.
3. Dùng module trong `html/kit/` thay vì viết lại (điều khiển, UI, lưu game, hậu kỳ…).

## 2. Vòng lặp làm việc (bắt buộc sau mỗi thay đổi lớn)
1. `node html/tools/test-game.mjs html/games/<ten-game> --out /tmp/shots` — phải **không có lỗi**.
2. Xem ảnh `shot-*.png`: cảnh có quá tối / trắng xóa / lệch tỉ lệ không? UI có che nhau không?
3. Game logic: đặt `window.__game = { stats: () => ({...}) }` để công cụ in trạng thái; với kịch bản dài,
   viết script playwright dịch chuyển người chơi (`__game.pc.body.position.set(...)`) để kiểm tra nhanh.
4. `node html/tools/build-single.mjs html/games/<ten-game>` rồi kiểm tra lại bản 1 file.
5. FPS trong công cụ là dựng hình bằng CPU (chậm hơn điện thoại thật 10–50 lần) → chỉ so sánh tương đối.

## 3. Hiệu năng điện thoại
- Tối đa ~4 đèn động (PointLight/SpotLight) cùng lúc. Nhiều bóng đèn → dùng pool đèn gán cho bóng gần nhất
  (xem horror-fps-starter), bóng xa chỉ là mesh phát sáng.
- Pixel ratio ≤ 1.5 (createWorld tự lo). Bóng đổ 1 đèn chính, map 1024.
- Gộp tường/sàn tĩnh thành ít mesh (level.js đã gộp). Model lặp lại dùng `.clone()` để chung geometry.
- Không bật bloom khi có bầu trời Sky (HDR quá sáng → trắng xóa). Bloom hợp cảnh tối.
- `createPostFX` tự hạ chất lượng khi FPS < 40; vẫn nên thiết kế nhẹ từ đầu.

## 4. Âm thanh
- Điện thoại chỉ phát âm thanh sau lần chạm đầu → gọi `unlockAudio()` trong nút "Chơi".
- File thật: `Assets.sound('sounds/...mp3')` (cần thẻ script howler). Âm thanh nhanh: `SFX.play('coin')`.

## 5. Ánh sáng (Three.js r186, đơn vị vật lý)
- Trời: Hemisphere 0.35–1.1, mặt trời ~2.4. Đèn trong nhà PointLight 20–30 (decay 1.5), đèn pin SpotLight 100+.
- Cảnh kinh dị vẫn phải nhìn thấy đường đi: thử với `?fx=none` trước, rồi mới thêm vignette/nhiễu.

## 6. Godot
- Addon ở `godot/addons/`. Máy làm việc của Claude không chạy được Godot editor/export, nên game Godot
  được viết code + scene dạng text và cần mở thử trên máy của Khoa.
