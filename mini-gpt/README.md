# MiniGPT: GPT cỡ nhỏ viết từ đầu

Một GPT **của riêng bạn**, viết từ con số 0 (gần 1.000 dòng Python + PyTorch, kể cả chú thích). Cùng kiến trúc với GPT-2:
bạn tự huấn luyện trên dữ liệu tiếng Việt, tự dạy nó trò chuyện, và sở hữu toàn bộ, từ bộ tách từ đến trọng số.

```
văn bản ──► [1] prepare.py  học bộ tách từ BPE, mã hóa dữ liệu      → data-vi/
         ──► [2] train.py    tiền huấn luyện: học đoán token tiếp theo → out/       (mô hình "viết tiếp")
         ──► [3] sft.py      dạy hội thoại trên các cặp hỏi–đáp     → out-chat/  (mô hình "trò chuyện")
         ──► [4] chat.py     trò chuyện trong terminal / web, hoặc viết tiếp văn bản
```

## Bên trong có gì

| File | Nội dung |
|---|---|
| `minigpt/tokenizer.py` | Bộ tách từ **BPE mức byte** (cách của GPT-2), tự học từ dữ liệu của bạn; tách–ghép không mất ký tự nào |
| `minigpt/model.py` | **Transformer bộ giải mã**: nhúng token + vị trí, chú ý nhân quả nhiều đầu, MLP, LayerNorm, chia sẻ trọng số vào/ra, **bộ nhớ đệm KV** để sinh nhanh, lấy mẫu nhiệt độ / top-k / top-p |
| `minigpt/chat_format.py` | Khung hội thoại `<\|system\|> <\|user\|> <\|assistant\|> <\|end\|>`; khi dạy chỉ chấm điểm lời trợ lý |
| `train.py` | AdamW, khởi động + cosine, độ chính xác hỗn hợp (GPU), gộp gradient, cắt gradient, lưu/tiếp tục, giới hạn thời gian |
| `sft.py` | Dạy hội thoại (SFT), bước biến GPT thành "ChatGPT" |
| `data/sft_vi.jsonl` | 1.139 hội thoại tiếng Việt (từ dữ liệu Mây + hội thoại viết tay). Tạo lại: `node tools/make_sft_data.mjs` |
| `tests/test_minigpt.py` | Kiểm tra: tách từ đúng, bộ nhớ đệm KV khớp tính toàn bộ, học thuộc được, che nhãn SFT đúng |

## Chạy

**Colab miễn phí (bản thật):** mở `MiniGPT_Colab.ipynb`, chọn GPU T4, chạy lần lượt. Wikipedia tiếng Việt (150.000 bài) →
mô hình `small` 34 triệu tham số → dạy trò chuyện → chat qua link web. Khoảng 3 giờ, chia nhiều lần được.

**Thử nhanh trên máy tính (CPU, ~5 phút):**
```bash
pip install torch numpy
python tests/test_minigpt.py
python prepare.py --input ../README.md ../GAMEDEV.md --vocab 2000 --out data-vi
python train.py --data data-vi --preset nano --max-iters 1500
python sft.py --base out --out out-chat --epochs 3 --lr 5e-4
python chat.py --ckpt out-chat
```
(Dữ liệu ít như vậy thì mô hình chỉ học thuộc; đây là để thấy cả quy trình chạy.)

## Cỡ mô hình

| Preset | Tham số (từ vựng 16k) | Ngữ cảnh | Chạy trên | Ghi chú |
|---|---|---|---|---|
| `nano` | 2,9M | 128 | CPU | thử quy trình |
| `mini` | 16,9M | 256 | CPU mạnh / GPU nhỏ | |
| `small` | 33,6M | 512 | **Colab T4** | mặc định trong sổ tay |
| `base` | 98M | 1024 | GPU ≥ 24 GB | cỡ GPT-2 small |

## Đã kiểm chứng gì (CPU, kho văn bản nhỏ trong repo)

- Bộ kiểm tra đạt: tách–ghép tiếng Việt, emoji và ký tự lạ đúng; bộ nhớ đệm KV cho kết quả trùng tính toàn bộ; mô hình học thuộc 1 lô rồi viết lại đúng chuỗi.
- Huấn luyện `nano` (49 nghìn token, 1.500 bước, ~4,5 phút, ~23 nghìn token/giây): loss 7,6 → 0,1, viết ra câu tiếng Việt.
- Sau SFT: chào hỏi, an ủi, kể chuyện cười, nói "không biết giá vàng" đúng; vẫn nhầm vài câu kiến thức.
- **Chưa chạy được bản `small` trên GPU** (máy làm việc không có GPU): số liệu Colab trong sổ tay là ước lượng.

## Kỳ vọng thực tế

Kiến trúc giống GPT thật; **khác biệt nằm ở quy mô**:

| | MiniGPT `small` | GPT-2 (2019) | ChatGPT hiện nay |
|---|---|---|---|
| Tham số | 34 triệu | 124 triệu – 1,5 tỉ | hàng trăm tỉ trở lên |
| Dữ liệu huấn luyện | ~0,3 tỉ token | ~10 tỉ | hàng chục nghìn tỉ |
| Sau tiền huấn luyện | SFT ~1 nghìn hội thoại | không | SFT lớn + RLHF + công cụ |

Vì vậy MiniGPT `small` sẽ **viết tiếng Việt khá trôi chảy theo văn phong Wikipedia**, trò chuyện được các chủ đề đã dạy,
nhưng **hay bịa kiến thức và không suy luận được** bài khó. Đó là giới hạn của quy mô, không phải của code.
Muốn trợ lý thông minh để dùng hằng ngày thì dùng Qwen3 trong `ai-studio/`; MiniGPT để bạn hiểu, sở hữu và thử nghiệm GPT từ gốc.

**Cải thiện nhiều nhất:** thêm dữ liệu (văn bản của bạn vào `--input`, nhiều bài Wikipedia hơn), học lâu hơn, thêm hội thoại
chất lượng vào `data/sft_vi.jsonl`, rồi tăng cỡ lên `base` khi có GPU mạnh.
