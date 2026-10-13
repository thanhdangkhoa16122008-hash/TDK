# TDK — Bộ công cụ làm game của Khoa-TDK

Kho chứa thư viện, công cụ và khung game mẫu dùng chung cho các dự án game HTML (điện thoại/PC) và Godot. Tất cả đều miễn phí, mã nguồn mở, dùng thương mại được.

## Cấu trúc

```
html/
  libs/        Thư viện đã đóng gói sẵn, chạy offline
    three/       Three.js r186 (3D) + addons: GLTFLoader, OrbitControls, BufferGeometryUtils, SkeletonUtils
                 three-all.module.min.js = Three.js + toàn bộ addons trong 1 file
    physics/     cannon-es 0.20 (vật lý: va chạm, trọng lực, nhảy)
    input/       nipplejs 1.0.4 (joystick cảm ứng)
    audio/       howler.js (phát nhạc/hiệu ứng file mp3/ogg), ZzFX + ZzFXM (âm thanh tạo bằng code), jsfxr
  kit/         Code tự viết, tái sử dụng cho mọi game
    lowpoly.js   Model 3D low-poly dựng bằng code: cây, đá, bụi, nhà, hàng rào, cây trồng 4 giai đoạn, xu, nhân vật biết đi
    sfx.js       12 hiệu ứng âm thanh có sẵn (coin, jump, step, hit, plant, harvest, door, scream, heartbeat…)
                 + nhạc nền tự sinh 3 tâm trạng: calm / happy / horror
    input.js     Joystick + nút cho điện thoại, WASD/Space cho PC, màn hình bắt xoay ngang
  templates/
    mobile-3d-starter/  Game mẫu chạy được: nhân vật đi lại, nhảy, nhặt xu, cảnh nông trại, âm thanh
  tools/
    build-single.mjs    Đóng gói 1 game thành MỘT file .html chạy offline (gửi điện thoại, đăng artifact)
godot/
  addons/      Copy thư mục cần dùng vào res://addons/ của dự án, rồi bật trong Project Settings → Plugins
    phantom_camera/    Camera bám, chuyển cảnh mượt (Godot 4.4+)
    dialogic/          Hội thoại, cốt truyện, lựa chọn (2.0-alpha-20, cần Godot 4.5+)
    beehave/           Behavior tree cho AI quái/NPC (2.9.3)
    virtual_joystick/  Joystick cảm ứng cho Android (Godot 4.2+)
    godot_sfxr/        Tạo hiệu ứng âm thanh ngay trong editor
```

## Cách dùng nhanh

**Game HTML mới:** copy `html/templates/mobile-3d-starter` thành thư mục mới, sửa `index.html`.
Chạy thử cần web server (vì dùng ES module), ví dụ: `npx serve .` ở thư mục gốc repo.

**Đóng gói 1 file:**
```
node html/tools/build-single.mjs html/templates/mobile-3d-starter
```
Kết quả ở `dist/` trong thư mục game (~690 KB, chạy offline, mở thẳng trên điện thoại).

**Model 3D từ file:** dùng `GLTFLoader` nạp `.glb`. Nguồn model CC0 (dùng tự do): kenney.nl, quaternius.com, poly.pizza.

**Âm thanh mới:** chỉnh tiếng ở https://killedbyapixel.github.io/ZzFX/ rồi copy mảng tham số vào `PRESETS` trong `html/kit/sfx.js`.

## Nguồn & giấy phép

| Thư viện | Nguồn | Giấy phép |
|---|---|---|
| Three.js r186 | github.com/mrdoob/three.js | MIT |
| cannon-es 0.20.0 | github.com/pmndrs/cannon-es | MIT |
| nipplejs 1.0.4 | github.com/yoannmoinet/nipplejs (build từ source) | MIT |
| howler.js | github.com/goldfire/howler.js | MIT |
| ZzFX 1.4.0 | github.com/KilledByAPixel/ZzFX | MIT |
| ZzFXM | github.com/keithclark/ZzFXM | MIT |
| jsfxr 1.4.0 | github.com/chr15m/jsfxr | Unlicense (public domain) |
| Phantom Camera 0.11.0.3 | github.com/ramokz/phantom-camera | MIT |
| Dialogic 2.0-alpha-20 | github.com/dialogic-godot/dialogic | MIT |
| Beehave 2.9.3 | github.com/bitbrain/beehave | MIT |
| Virtual Joystick | github.com/MarcoFazioRandom/Virtual-Joystick-Godot | MIT |
| GodotSfxr | github.com/tomeyro/godot-sfxr | MIT |

File LICENSE gốc nằm cạnh từng thư viện. `html/kit/` và `html/templates/` là code của TDK.
