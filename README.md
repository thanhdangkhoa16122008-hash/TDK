# TDK — Bộ công cụ làm game của Khoa-TDK

Thư viện, tài nguyên, bộ kit và khung game mẫu cho game HTML (điện thoại màn ngang/PC) và Godot.
Tất cả miễn phí, mã nguồn mở / CC0, dùng thương mại được. Quy trình làm game: xem [GAMEDEV.md](GAMEDEV.md).

## Cấu trúc

```
html/
  libs/                Thư viện, chạy offline
    three/               Three.js r186 + addons (GLTFLoader, hậu kỳ, Sky, SimplexNoise, PointerLock, stats…)
    physics/             cannon-es 0.20 (va chạm, trọng lực, địa hình)
    input/               nipplejs 1.0.4 (joystick cảm ứng)
    audio/               howler.js (mp3), ZzFX/ZzFXM + jsfxr (âm thanh tạo bằng code)
    anim/                tween.js 25 (chuyển động mượt cho UI/vật thể)
  assets/              Tài nguyên CC0 — xem catalog.png (ảnh xem trước) và catalog.json (danh sách + animation)
    models/              76 model .glb: Kenney (arena, city, fps, platformer, racing) + robot Quaternius
                         nhân vật có animation: kenney-arena/character-soldier (32 động tác), quaternius/robot (14), kenney-platformer/character (4)
    sounds/              32 âm thanh .mp3 của Kenney (nhảy, xu, bước chân, súng, xe, xây dựng, nhạc nền thành phố)
  kit/                 Code dùng lại cho mọi game
    world.js             renderer chuẩn mobile, vòng lặp, chu kỳ ngày/đêm + bầu trời
    controls.js          điều khiển nhân vật góc nhìn thứ 1 và thứ 3, vuốt xoay camera, camera không xuyên tường
    input.js             joystick + nút cảm ứng, bàn phím PC, bắt xoay ngang
    assets.js            nạp model/âm thanh, điều khiển animation (chuyển mượt), đặt model lên mặt đất
    terrain.js           địa hình đồi núi tự sinh có nước + collider + rải cây/đá theo địa hình
    level.js             dựng nhà/biệt thự từ bản đồ chữ (# tường, D cửa mở được, W cửa sổ, đánh dấu vị trí)
    postfx.js            hậu kỳ: bright / horror / retro, tự hạ chất lượng khi máy yếu
    ui.js                thông báo, hội thoại chữ chạy có lựa chọn, thanh đồ, menu, loading, thanh máu, chữ bay
    save.js              lưu game (có phiên bản, tự lưu, xuất/nhập mã sao lưu)
    textures.js          texture tự vẽ: cỏ, đất, gỗ, gạch, gạch men, giấy dán tường cũ, bê tông, vết máu
    fx.js                hạt hiệu ứng, mưa/tuyết/đom đóm/bụi, rung camera
    anime.js             nhân vật nữ anime bằng code: tô bóng hoạt hình + viền, mắt to chớp, 5 biểu cảm, 4 kiểu tóc, 5 động tác
    lowpoly.js           model low-poly bằng code: cây, đá, nhà, hàng rào, cây trồng 4 giai đoạn, nhân vật
    sfx.js               12 hiệu ứng âm thanh + nhạc nền tự sinh (calm / happy / horror)
  templates/           Game mẫu chạy được — copy ra để làm game mới
    adventure-3d-starter/  góc nhìn thứ 3: nhân vật Kenney có animation, địa hình, ngày/đêm, xu, lưu game
    horror-fps-starter/    kinh dị góc nhìn thứ nhất: biệt thự, đèn pin hết pin, cửa, chìa khóa, bóng ma, nỗi sợ
    basic-3d-starter/      bản tối giản, không dùng file model
    character-viewer/      xem nhân vật anime xoay 360°, đổi tóc/màu/biểu cảm/động tác
  tools/
    build-single.mjs     đóng gói game thành MỘT file .html offline (nhúng cả model/âm thanh)
    test-game.mjs        chạy thử như điện thoại: bắt lỗi, đo FPS, giả lập điều khiển, chụp màn hình
    embed-glb.mjs        nhúng texture rời vào file .glb
    model-sheet.html     xem trước mọi model
godot/addons/          Copy vào res://addons/ rồi bật trong Project Settings → Plugins
    phantom_camera/ (4.4+)  dialogic/ (2.0-alpha-20, cần 4.5+)  beehave/ (AI)  virtual_joystick/  godot_sfxr/
```

## Dùng nhanh

```bash
npx serve .                                                   # chạy thử: mở /html/templates/<game>/
node html/tools/test-game.mjs html/templates/horror-fps-starter   # kiểm tra tự động
node html/tools/build-single.mjs html/templates/adventure-3d-starter  # ra 1 file trong dist/
```
Tham số URL khi thử: `?fx=none` tắt hậu kỳ, `?q=low|medium|high` chất lượng, `?hour=21` giờ trong game.

## Nguồn & giấy phép

| Thành phần | Nguồn | Giấy phép |
|---|---|---|
| Three.js r186 | github.com/mrdoob/three.js | MIT |
| cannon-es 0.20.0 | github.com/pmndrs/cannon-es | MIT |
| nipplejs 1.0.4 | github.com/yoannmoinet/nipplejs (build từ source) | MIT |
| howler.js | github.com/goldfire/howler.js | MIT |
| tween.js 25 | github.com/tweenjs/tween.js | MIT |
| ZzFX 1.4.0 / ZzFXM | github.com/KilledByAPixel/ZzFX, github.com/keithclark/ZzFXM | MIT |
| jsfxr 1.4.0 | github.com/chr15m/jsfxr | Unlicense |
| Model + âm thanh Kenney | github.com/KenneyNL/Starter-Kit-* | CC0 |
| Robot (Quaternius) | three.js examples | CC0 |
| Phantom Camera, Dialogic, Beehave, Virtual Joystick, GodotSfxr | xem từng thư mục | MIT |

Chi tiết tài nguyên: `html/assets/LICENSE.md`. `html/kit/`, `html/templates/`, `html/tools/` là code của TDK.
