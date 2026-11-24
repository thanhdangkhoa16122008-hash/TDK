"""Tư duy sáng tạo nhiều bước + tự rút trí nhớ.

Sáng tạo (3 vòng, mỗi vòng là một lần mô hình suy nghĩ):
  1. Phân kỳ  — nghĩ ra nhiều hướng thật khác nhau, có cả hướng táo bạo.
  2. Phản biện — đóng vai người chấm khó tính, xét độ mới lạ / khả thi / hợp với người dùng.
  3. Hội tụ   — kết hợp ý mạnh nhất, vá điểm yếu, viết câu trả lời cuối.
Cách này cho ý tưởng tốt hơn rõ rệt so với trả lời một lần, nhất là với mô hình cỡ vừa.
"""
import re

from .memory import parse_memories

DIVERGE = """Nhiệm vụ của người dùng: «{task}»

Bước 1 — NGHĨ RỘNG. Đưa ra 7 hướng giải quyết/ý tưởng THẬT KHÁC NHAU (khác về cách tiếp cận, không chỉ khác chữ).
Bắt buộc có: 2 hướng an toàn, chắc chắn hiệu quả; 3 hướng mới lạ; 2 hướng táo bạo, phá cách hoặc kết hợp lĩnh vực không liên quan.
Mỗi hướng: một tên ngắn + 1–2 câu mô tả. Chỉ liệt kê, chưa đánh giá."""

CRITIQUE = """Nhiệm vụ của người dùng: «{task}»

Các hướng đã nghĩ ra:
{ideas}

Bước 2 — PHẢN BIỆN. Đóng vai người chấm khó tính. Với mỗi hướng, chấm 1–10 theo: mới lạ, khả thi với người dùng (nguồn lực, kỹ năng của họ), mức hiệu quả.
Chỉ ra điểm yếu lớn nhất của 3 hướng điểm cao nhất. Cuối cùng đề xuất cách KẾT HỢP các ý mạnh để vá điểm yếu. Ngắn gọn, thẳng thắn."""

CONVERGE = """Nhiệm vụ của người dùng: «{task}»

Các hướng đã nghĩ:
{ideas}

Phản biện:
{critique}

Bước 3 — KẾT LUẬN. Viết câu trả lời cuối cho người dùng: chọn/kết hợp phương án tốt nhất, trình bày cụ thể, làm được ngay
(các bước, ví dụ, nội dung hoàn chỉnh nếu họ nhờ viết). Nói ngắn vì sao chọn phương án này. Không nhắc tới "bước 1/2/3"."""

EXTRACT = """Đọc tin nhắn của người dùng dưới đây. Trích những thông tin ĐÁNG NHỚ LÂU DÀI về chính người dùng:
tên, tuổi/lớp, nghề, mục tiêu, dự án đang làm, sở thích, điều họ ghét, cách họ muốn được hỗ trợ, thiết bị/công cụ họ dùng.
KHÔNG trích: câu hỏi nhất thời, cảm xúc thoáng qua, kiến thức chung, nội dung nhờ viết.
Mỗi điều viết thành một câu ngắn ngôi thứ ba, ví dụ "Người dùng tên Khoa", "Người dùng đang làm kênh video kinh dị Muro Var".
Trả về DUY NHẤT một mảng JSON các chuỗi; không có gì đáng nhớ thì trả về [].

Tin nhắn: «{msg}»"""

# chỉ tốn thêm một lượt gọi mô hình khi câu có dấu hiệu nói về bản thân
_SELF = re.compile(r"\b(minh|toi|tao|em|to|tui)\b.{0,40}\b(la|ten|thich|ghet|muon|dang|se|can|co|lam|hoc|song|dung|mo uoc|du dinh|so)\b")
_REMEMBER = re.compile(r"^\s*(hay |ban )?(nho|ghi nho|luu)( giup| lai| rang| la| cho minh| cho toi)?\b")


def wants_memory(norm_msg):
    return bool(_SELF.search(norm_msg) or _REMEMBER.search(norm_msg))


def extract_memories(studio, msg):
    out = ""
    for _, out in studio.chat_stream([{"role": "user", "content": EXTRACT.format(msg=msg)}], think=False, max_new_tokens=200):
        pass
    return [m for m in parse_memories(out) if 4 <= len(m) <= 200][:5]


def creative(studio, task, context_msgs):
    """Sinh từng giai đoạn: ('ideas'|'critique'|'answer', văn bản đến hiện tại, xong?)."""
    sys = context_msgs[0]  # lời nhắc hệ thống đã có trí nhớ + tài liệu
    history = context_msgs[1:-1]

    def run(prompt, stage, think=True, tokens=None):
        text = ""
        for _, ans in studio.chat_stream([sys] + history[-6:] + [{"role": "user", "content": prompt}], think=think, max_new_tokens=tokens):
            text = ans
            yield stage, text, False
        yield stage, text, True

    ideas = critique = ""
    for stage, ideas, done in run(DIVERGE.format(task=task), "ideas", think=False, tokens=900):
        yield stage, ideas, done
    for stage, critique, done in run(CRITIQUE.format(task=task, ideas=ideas), "critique", think=False, tokens=900):
        yield stage, critique, done
    for stage, ans, done in run(CONVERGE.format(task=task, ideas=ideas, critique=critique), "answer", think=True, tokens=3000):
        yield stage, ans, done
