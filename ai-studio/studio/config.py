"""Cấu hình AI Studio: chọn mô hình theo VRAM, phong cách ảnh/video, lời nhắc hệ thống.

Mọi mô hình đều mã nguồn mở, tải tự động từ Hugging Face lần đầu chạy (không cần token).
Đổi mô hình bằng biến môi trường: STUDIO_CHAT_MODEL, STUDIO_CHAT_ADAPTER.
"""
import os
import re
import unicodedata

# ---------- chọn mô hình chat theo VRAM (GB) ----------
def pick_chat_model(vram_gb: float) -> str:
    if os.environ.get("STUDIO_CHAT_MODEL"):
        return os.environ["STUDIO_CHAT_MODEL"]
    if vram_gb >= 10:
        return "Qwen/Qwen3-8B"      # 4-bit ≈ 6 GB, tiếng Việt tốt, có chế độ suy nghĩ
    if vram_gb >= 5:
        return "Qwen/Qwen3-4B"      # 4-bit ≈ 3 GB
    return "Qwen/Qwen3-1.7B"        # chạy được trên CPU (chậm)


CHAT_ADAPTER = os.environ.get("STUDIO_CHAT_ADAPTER", "loras/chat-may")  # LoRA chat sau khi tinh chỉnh

IMAGE_MODELS = {
    # khóa: (tên hiển thị, VRAM tối thiểu khuyến nghị)
    "fast": ("Nhanh — SDXL-Turbo 512px, 4 bước", 6),
    "quality": ("Đẹp — SDXL 1024px, 30 bước", 8),
    "flux": ("Đẹp nhất — FLUX.1-schnell 1024px (cần ≥ 24 GB VRAM hoặc nhiều RAM)", 24),
}
VIDEO_MODELS = {
    "wan": ("Wan 2.1 1.3B — văn bản → video 480p (≈ 8 GB VRAM)", 8),
    "ltx": ("LTX-Video — văn bản → video, nhanh (≈ 12 GB VRAM)", 12),
}

# ---------- phong cách: (thêm vào prompt, thêm vào negative) ----------
BASE_NEGATIVE = "lowres, blurry, deformed, bad anatomy, extra fingers, mutated hands, text, watermark, signature, jpeg artifacts"
STYLES = {
    "Không": ("", ""),
    "Kinh dị (Muro Var)": (
        "dark horror atmosphere, black shadow silhouette figure, faceless, dim moonlight, heavy fog, "
        "desaturated colors, film grain, cinematic lighting, unsettling, liminal space",
        "bright, cheerful, colorful, cartoon, cute"),
    "Game low-poly": ("low poly 3d game art, clean flat shading, vibrant colors, game asset, soft lighting", "photo, realistic, noisy"),
    "Anime": ("anime style, cel shading, clean lineart, vibrant colors, detailed eyes, high quality illustration", "photorealistic, 3d render"),
    "Ảnh thật": ("photorealistic, 35mm photo, natural lighting, high detail, sharp focus", "cartoon, painting, illustration, 3d render"),
    "Concept art": ("digital concept art, painterly, dramatic lighting, highly detailed, epic composition", "photo"),
    "Pixel art": ("pixel art, 16-bit retro game style, limited palette, crisp pixels", "smooth, realistic, blurry"),
}
VIDEO_NEGATIVE = "worst quality, low quality, blurry, jittery, distorted, inconsistent motion, flickering, static image, text, watermark"

# ---------- lời nhắc hệ thống ----------
SYSTEM_PROMPT = """Bạn là Mây, trợ lý AI tiếng Việt thân thiện, thông minh, xưng "mình" và gọi người dùng là "bạn".
- Trả lời tự nhiên, rõ ràng, đúng trọng tâm. Câu hỏi thường trả lời ngắn; chỉ viết dài khi được nhờ viết, giải thích kỹ hoặc giải bài.
- Bài toán, lập luận: trình bày các bước chính rồi kết luận.
- Không chắc thì nói không chắc, không bịa. Bạn không có internet nên không biết tin tức, giá cả, thời tiết hiện tại.
- Bạn có thể tạo ảnh và dựng video: khi người dùng nhờ "vẽ…/tạo ảnh…" hoặc "làm video…", hệ thống sẽ tự tạo. Nếu họ hỏi cách dùng, hãy gợi ý họ viết như "vẽ một ngôi nhà ma trong sương mù" hoặc "làm video con mèo chạy trên bãi biển".
- Chuyện sức khỏe hay tâm lý nghiêm trọng: khuyên tìm người lớn tin cậy hoặc chuyên gia."""

PROMPT_WRITER = {
    "image": """You are an expert prompt writer for the image model Stable Diffusion XL.
Turn the user's request (often in Vietnamese) into ONE English prompt: main subject first, then setting, composition, lighting, mood, style details.
Comma-separated phrases, at most 60 words. Output ONLY the prompt, no quotes, no explanation.""",
    "video": """You are an expert prompt writer for a text-to-video model.
Turn the user's request (often in Vietnamese) into ONE English prompt of 2-4 sentences: describe the subject, the motion that happens,
the camera movement (e.g. slow dolly in, static shot, pan left), the setting, lighting and mood. Keep the action simple enough for a 3-5 second clip.
Output ONLY the prompt, no quotes, no explanation.""",
}


def normalize_vi(s: str) -> str:
    """Bỏ dấu tiếng Việt, chữ thường: 'Vẽ ảnh' → 've anh'."""
    s = s.lower().replace("đ", "d")
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


_VIDEO_RE = re.compile(r"\b(tao|lam|dung|quay|render|xuat|ve)\b.{0,25}\b(video|clip|phim ngan|hoat hinh|chuyen dong)\b")
_IMAGE_RE = re.compile(r"^(?:\W*(?:hay|ban|may|oi|giup|minh|toi|lam on|nho|cho|xin)\b\s*)*(?:ve|tao|lam|thiet ke|sang tac)\b.{0,30}\b(anh|hinh|tranh|poster|logo|nhan vat|bia|wallpaper|minh hoa)\b|^(?:hay\s+|giup minh\s+)?ve\s+\S")


_QUESTION_RE = re.compile(r"\b(o dau|the nao|lam sao|tai sao|vi sao|cach nao|cach de|hoc|co nen|bao nhieu|la gi|phan mem|app nao|ung dung)\b|\?\s*$")

_SPECIAL = re.compile(r"<\|[^|>]+\|>")


def split_think(buf: str, think: bool):
    """Tách phần suy nghĩ <think>…</think> khỏi câu trả lời (Qwen3)."""
    buf = _SPECIAL.sub("", buf)
    if "</think>" in buf:
        a, b = buf.split("</think>", 1)
        return a.replace("<think>", "").strip(), b.strip()
    if think or buf.lstrip().startswith("<think>"):
        return buf.replace("<think>", "").strip(), ""
    return "", buf.strip()


def detect_media(msg: str):
    """Nhận diện yêu cầu tạo ảnh/video trong chat. Trả về ('image'|'video', mô tả) hoặc None."""
    raw = msg.strip()
    n = normalize_vi(raw)
    if n.startswith("/video"):
        return "video", raw[6:].strip()
    if n.startswith("/ve") or n.startswith("/anh"):
        return "image", raw.split(maxsplit=1)[1] if " " in raw else ""
    if _QUESTION_RE.search(n):  # "vẽ tranh thì học ở đâu?" là câu hỏi, không phải yêu cầu vẽ
        return None
    if _VIDEO_RE.search(n[:80]):
        return "video", raw
    if _IMAGE_RE.search(n[:80]):
        return "image", raw
    return None
