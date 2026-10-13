# PR #1: CI và vòng đời input — 2026-10-13

Thay đổi tiếp nối commit `5d0e3e5` trên cùng nhánh `fix/tdk-input-audio-model-regressions`.

`createInput()` trước đó không có hàm hủy. Nay thêm `destroy()` tùy chọn, không đổi các getter/method hiện tại. Hàm gỡ listener window/document/button của chính instance, gỡ callback và hủy collection nipplejs, xóa DOM mà instance tạo ra, rồi reset trạng thái. Gọi lặp an toàn; không hủy instance khác hoặc overlay `requireLandscape()` độc lập.

Tám regression lifecycle mới kiểm tra listener thật qua Chromium CDP, control đã detach không phản ứng, reset trạng thái, DOM ownership, hủy lặp lại, trường hợp không có nipplejs, nhiều instance và hai joystick đang hoạt động. Bảy testcase ban đầu đã chạy red vì thiếu `destroy()`; testcase hai joystick được bổ sung từ lượt review độc lập và đã chạy thành công.

## Kiểm thử local

`npm test` cuối hoàn tất exit 0:

| Nhóm | Đạt | Thất bại |
| --- | ---: | ---: |
| HTML, gồm 6 test cha | 131 | 0 |
| HTML, chỉ bài con/độc lập | 125 | 0 |
| Godot runtime | 26 | 0 |
| Build trên bản sao checkout | 8 lần | 0 |
| So sánh hai build/template | 4 cặp | 0 |

Không skip/cancel. Những kiểm thử build/template đã nằm trong số HTML, không cộng hai lần. Godot import/bật plugin đạt; chỉ có cảnh báo editor ObjectDB/UndoRedo shutdown đã ghi nhận trước, runtime không có warning/error. Actionlint 1.7.7 và `git diff --check` đạt; review độc lập không còn blocker.

Log: `/workspace/tdk-audit-2026-10-13/ci-lifecycle-final.log`.
Build/hash/screenshot: `/tmp/tdk-builds-czBoCH`.
Godot fixture/log: `/tmp/tdk-godot-uK37Fj`.
Không sửa hoặc xóa artifact kiểm toán trước và công việc của Claude.

## GitHub Actions

Workflow `TDK tests` chạy hai job riêng khi mở/cập nhật PR, push `main`, hoặc manual dispatch. Node 24 và Ubuntu 24.04; `npm ci` dùng lockfile; Chromium do Playwright cài; Godot 4.6.3 được tải từ release chính thức và xác minh SHA-512 trước khi chạy. Các action được pin bằng commit SHA, token chỉ có quyền đọc repository, không có step merge/deploy. HTML giới hạn concurrency hai file test để phù hợp tài nguyên hosted runner.

Log, JSON, hash và screenshot được giữ dưới dạng Actions artifact 14 ngày, kể cả khi test thất bại. Kết quả thực thi remote của commit này phải xem trên PR/Actions; kết quả local và lint không tự chứng minh CI đã chạy thành công.
