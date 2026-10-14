# Kết nối Claude + Grok với TDK (Android/GitHub)

Công cụ chạy 2 API **song song** để phản biện cùng một yêu cầu, tạo báo cáo `ai-review.md`.
ChatGPT có thể xem xét báo cáo sau khi bạn đưa kết quả vào chat hoặc chia sẻ vị trí artifact.
Đây KHÔNG phải một phiên trò chuyện trực tiếp giữa 3 tài khoản web ChatGPT, Claude và Grok.

## 1. Chuẩn bị tài khoản API

1. Claude: https://console.anthropic.com/ — tạo API key Anthropic.
2. Grok: https://console.x.ai/ — tạo API key xAI và kiểm tra tín dụng/billing.
3. Đăng nhập GitHub trên Android; mở kho TDK.

**Lưu ý:** Gói đăng ký ChatGPT Plus, Claude Pro/Max hoặc Grok trên web
không tự cấp quyền sử dụng API. API có thể phát sinh chi phí riêng.

## 2. Lưu key AN TOÀN trên GitHub

Mở TDK -> Settings -> Secrets and variables -> Actions ->
New repository secret:

- `ANTHROPIC_API_KEY` = key từ Claude Console.
- `XAI_API_KEY` = key từ xAI Console.

KHÔNG đăng key vào chat, issue, README, source code, ảnh chụp hoặc log.

## 3. Chạy từ Android

1. Merge pull request chứa file này vào `main`.
2. GitHub -> TDK -> Actions -> **Claude + Grok AI Review**.
3. Chọn **Run workflow**, nhập `task` (ví dụ:
   "Compare 3 possible architectures for a lightweight mobile 3D horror game.")
4. Chạy. Sau khi workflow kết thúc, tải artifact `claude-grok-review`
   (bên trong có `ai-review.md`).
5. Mở báo cáo rồi gửi lại cho ChatGPT để phân tích và quyết định.

Có thể thay đổi tên model bằng hai ô Claude model ID / Grok model ID.
Mặc định: `claude-sonnet-5-5`, `grok-4.7`.

## 4. Chạy trên Google Colab

Nếu dùng Colab Android, tải/clone repo TDK và mở terminal cell:
```python
import os
from getpass import getpass

os.environ["ANTHROPIC_API_KEY"] = getpass("Anthropic API key: ")
os.environ["XAI_API_KEY"] = getpass("xAI API key: ")
os.environ["TASK"] = "Propose 3 optimizations for a mobile 3D horror game."
!python3 scripts/ai_bridge.py
print(open("ai-review.md", encoding="utf-8").read())
```
Chạy trong thư mục gốc của TDK. Key nhập qua getpass không bị in ra
notebook; vẫn cần bảo vệ phiên Colab của mình.

## Giới hạn

- Mỗi lần chạy gọi hai dịch vụ, có thể mất phí theo token.
- Chỉ nội dung `task` được gửi đến hai AI; script không tự đọc toàn bộ repo.
- Bạn cần cung cấp nội dung code hoặc đường dẫn/tóm tắt phù hợp trong `task`
  nếu muốn AI đánh giá một đoạn code cụ thể.
- Tất cả output được ghi vào artifact của GitHub Actions trong 7 ngày.
  Tránh gửi thông tin riêng tư/sensitive qua workflow trên repo public.
- Chưa có API key nên chưa thể xác nhận một lệnh gọi trực tiếp thành công.
- Claude GitHub app riêng có ở https://github.com/apps/claude nếu
  bạn muốn Claude tự review issue / pull request; đó là tích hợp khác.

## Tài liệu API

- https://platform.claude.com/docs/en/api/messages/create
- https://platform.claude.com/docs/en/models/overview
- https://docs.x.ai/developers/rest-api-reference/inference
- https://docs.x.ai/developers/models
