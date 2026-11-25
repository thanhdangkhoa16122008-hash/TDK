"""Bản giả lập (không cần GPU/mô hình) để thử giao diện: python app.py --demo"""
import time
from pathlib import Path

from .config import STYLES

OUT = Path("outputs")


class DemoStudio:
    chat_id = "demo"

    def status(self):
        return "**Chế độ demo** — không nạp mô hình thật. Chạy không có `--demo` trên máy có GPU để dùng thật."

    def unload(self, what=None):
        pass

    def chat_stream(self, messages, think=False, max_new_tokens=None):
        q = messages[-1]["content"]
        if q.startswith("Đọc tin nhắn của người dùng"):  # giả lập trích trí nhớ
            import json, re
            m = re.search(r"Tin nhắn: «(.*)»", q, re.S)
            yield "", json.dumps([f"Người dùng nói: {m.group(1)}"] if m else [], ensure_ascii=False)
            return
        sysmsg = messages[0]["content"] if messages and messages[0]["role"] == "system" else ""
        if "Những điều bạn đã biết về người dùng" in sysmsg:
            q += " [có trí nhớ]"
        if "Trích từ tài liệu riêng" in sysmsg:
            q += " [có tài liệu]"

        thought = f"Người dùng hỏi: “{q}”. Mình cần hiểu ý rồi trả lời ngắn gọn." if think else ""
        ans = f"(demo) Mình đã nhận: {q}. Có {len(messages) - 1} lượt trong ngữ cảnh."
        for i in range(1, len(thought) + 1, 12):
            time.sleep(0.01)
            yield thought[:i], ""
        for i in range(1, len(ans) + 1, 8):
            time.sleep(0.01)
            yield thought, ans[:i]
        yield thought, ans

    def write_prompt(self, desc, kind, style="Không"):
        extra = STYLES.get(style, ("", ""))[0]
        return f"[{kind} prompt for] {desc}" + (f", {extra}" if extra else "")

    def image(self, prompt, negative="", kind="quality", width=1024, height=1024, n=1, seed=-1, lora=None, lora_scale=0.8, style="Không"):
        from PIL import Image, ImageDraw
        OUT.mkdir(exist_ok=True)
        paths = []
        for i in range(int(n)):
            im = Image.new("RGB", (512, 512), (40 + 30 * i, 50, 90))
            ImageDraw.Draw(im).text((16, 16), f"DEMO {kind}\n{prompt[:60]}", fill=(255, 255, 255))
            p = OUT / f"demo-{int(time.time() * 1000)}-{i}.png"
            im.save(p)
            paths.append(str(p))
        return paths, 42

    def video(self, prompt, kind="wan", seconds=3, image_path=None, seed=-1, negative=""):
        raise RuntimeError("Chế độ demo không dựng video thật.")
