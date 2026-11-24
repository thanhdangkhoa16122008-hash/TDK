# Mây AI Studio

AI của riêng bạn: **trò chuyện · tạo ảnh · dựng video**, dùng mô hình mã nguồn mở chạy trên GPU của bạn
(hoặc Google Colab miễn phí), và **huấn luyện thêm** bằng dữ liệu của bạn. Không phụ thuộc dịch vụ trả phí nào.

| Tính năng | Mô hình | VRAM tối thiểu | Ghi chú |
|---|---|---|---|
| Trò chuyện | Qwen3-8B (4-bit) · tự hạ xuống 4B / 1.7B khi máy yếu | 6 GB (CPU chạy được, rất chậm) | Có chế độ **suy nghĩ sâu** cho toán/lập luận |
| Tạo ảnh | SDXL (đẹp) · SDXL-Turbo (nhanh) · FLUX.1-schnell (đẹp nhất) | 8 GB · 6 GB · 24 GB | Mây tự viết prompt tiếng Anh từ mô tả tiếng Việt |
| Dựng video | Wan 2.1 1.3B · LTX-Video | 8 GB · 12 GB | Clip 2–5 giây; có **ảnh → video** |
| Huấn luyện | QLoRA chat · LoRA ảnh SDXL | 16 GB (Colab T4 được) | Dạy giọng nói / phong cách / nhân vật riêng |

## Chạy nhanh

**Google Colab (miễn phí, khuyên dùng):** mở `Mây_AI_Studio_Colab.ipynb` trên Colab, chọn GPU T4, chạy lần lượt từng ô.

**Máy có GPU NVIDIA:**
```bash
cd ai-studio
pip install -r requirements.txt        # cần PyTorch bản CUDA: https://pytorch.org
python app.py                          # mở http://localhost:7860
```
Thử giao diện không cần GPU: `python app.py --demo`.

## Dùng

- **Trò chuyện:** hỏi bất cứ gì. Bật *Suy nghĩ sâu* cho bài toán, lập luận, so sánh (chậm hơn nhưng đúng hơn).
  Trong chat có thể nói *“vẽ một ngôi nhà ma trong sương mù”* hoặc *“làm video con mèo chạy trên bãi biển”*.
  Lệnh tắt: `/ve …`, `/video …`.
- **Tạo ảnh:** chọn phong cách (Kinh dị Muro Var, Game low-poly, Anime, Ảnh thật…), chất lượng, khung hình.
  Ghi lại *seed* để tạo lại đúng ảnh và chỉnh dần.
- **Dựng video:** mô tả chuyển động và góc máy. Muốn video giữ đúng nhân vật/phong cách: tạo ảnh trước
  (có thể bằng LoRA riêng) rồi kéo vào ô *Ảnh đầu*.

## Huấn luyện

### LoRA chat: dạy Mây cách nói chuyện, kiến thức riêng
1. Thêm hội thoại vào `data/chat_vi.jsonl`, mỗi dòng một hội thoại:
   `{"messages": [{"role": "user", "content": "…"}, {"role": "assistant", "content": "…"}]}`
2. `python train/train_chat_lora.py --epochs 3` → lưu ở `loras/chat-may/`, app tự dùng khi khởi động lại.

Mẫu có sẵn 20 hội thoại viết tay (tính cách Mây, giải toán từng bước, viết truyện kinh dị, làm game).
Nên mở rộng lên **300–1000 hội thoại** đúng giọng bạn muốn. Chất lượng quan trọng hơn số lượng.
Dữ liệu ít mà huấn luyện quá nhiều vòng sẽ làm mô hình học vẹt, kém đi; hãy thử 2–3 vòng rồi chat để kiểm tra.

### LoRA ảnh: dạy một phong cách hoặc nhân vật
1. Đặt 15–40 ảnh vào `data/images/<tên>/` (xem `data/images/README.md`).
2. `python train/train_image_lora.py --images data/images/muro-var --name muro-var --prompt "murovar style, black shadow figure" --steps 800`
3. Trong tab Tạo ảnh → Nâng cao, chọn LoRA `muro-var` và viết `murovar style` trong mô tả.

### Video
Huấn luyện LoRA video (Wan) cần GPU ≥ 24 GB và công cụ riêng (vd *musubi-tuner*, *diffusion-pipe*),
chưa đưa vào đây. Cách thực tế: dùng **LoRA ảnh** để tạo khung hình đúng phong cách, rồi **ảnh → video**.

## Thực tế cần biết

- **Không mô hình nào ở đây được huấn luyện từ đầu.** Huấn luyện từ đầu một mô hình ngang ChatGPT/Midjourney/Sora
  tốn hàng triệu USD. Cách các nhóm nhỏ làm (và bộ này làm) là dùng mô hình mở tốt nhất vừa GPU của bạn,
  rồi tinh chỉnh LoRA.
- **Chất lượng so với dịch vụ lớn** (ước lượng): chat Qwen3-8B tốt cho trò chuyện, giải thích, toán phổ thông,
  nhưng kém GPT/Claude bản lớn ở bài khó và kiến thức sâu. Ảnh SDXL đẹp, đặc biệt khi có LoRA đúng phong cách.
  Video 1.3B là clip ngắn 480p, còn xa Sora/Veo; chuyển động phức tạp dễ méo.
- **Tốc độ trên Colab T4** (ước lượng): chat vài giây đến 30 giây mỗi câu; ảnh SDXL ~30–60 giây; video 3–10 phút.
  Lần đầu mỗi tính năng phải tải mô hình (tổng khoảng 30 GB). Gắn Google Drive để không tải lại.
- **Bộ nhớ:** GPU nhỏ chỉ giữ một mô hình nặng một lúc; chuyển giữa chat/ảnh/video sẽ mất 30–90 giây nạp lại.
- Mã đã được kiểm tra giao diện ở chế độ demo. Phần nạp mô hình thật cần chạy trên GPU; lần đầu chạy nếu có lỗi,
  chép nguyên thông báo lỗi để sửa.
- Giấy phép: Qwen3, SDXL, FLUX.1-schnell, Wan 2.1 dùng thương mại được; LTX-Video có giấy phép riêng của Lightricks,
  hãy đọc trước khi dùng cho mục đích thương mại.
