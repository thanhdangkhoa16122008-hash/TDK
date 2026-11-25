"""Bước 4 — Dùng mô hình: trò chuyện (bản chat) hoặc viết tiếp văn bản (bản tiền huấn luyện).

    python chat.py --ckpt out-chat                      # trò chuyện trong terminal
    python chat.py --ckpt out-chat --web [--share]      # giao diện web (cần: pip install gradio)
    python chat.py --ckpt out --prompt "Hà Nội là"      # viết tiếp văn bản
Lệnh trong terminal: /moi (cuộc trò chuyện mới), /nhiet 0.5 (độ sáng tạo), /thoat
"""
import argparse
import codecs
import os
import sys
from pathlib import Path

import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from minigpt.chat_format import render  # noqa: E402
from minigpt.model import load_checkpoint  # noqa: E402
from minigpt.tokenizer import BPETokenizer  # noqa: E402


class Bot:
    def __init__(self, ckpt_dir, device="auto"):
        d = Path(ckpt_dir)
        dev = ("cuda" if torch.cuda.is_available() else "cpu") if device == "auto" else device
        self.tok = BPETokenizer.load(d / "tokenizer.json")
        self.model, ck = load_checkpoint(d / "ckpt.pt", dev)
        self.is_chat = ck.get("kind") == "chat"
        self.temperature, self.top_k, self.top_p = 0.7, 40, 0.9

    def stream(self, ids, max_new_tokens=300, stop=()):
        """Sinh và giải mã dần (không cắt đôi ký tự UTF-8 nhiều byte)."""
        dec = codecs.getincrementaldecoder("utf-8")(errors="replace")
        for t in self.model.generate(ids, max_new_tokens, self.temperature, self.top_k, self.top_p, 1.15, stop):
            piece = dec.decode(self.tok.decode_bytes([t]))
            if piece:
                yield piece

    def reply(self, history):
        """history: [{'role','content'}…] kết thúc bằng lượt của người dùng. Sinh từng mảnh câu trả lời."""
        ids, _ = render(self.tok, history[-12:], add_generation_prompt=True)
        bs = self.model.config.block_size
        keep = bs - min(200, bs // 2)          # chừa chỗ cho câu trả lời, nhưng không cắt mất câu hỏi
        ids = ids[-keep:]
        yield from self.stream(ids, 300, stop=(self.tok.end, self.tok.eot))

    def complete(self, prompt, n=200):
        yield from self.stream(self.tok.encode(prompt), n, stop=(self.tok.eot,))


def terminal(bot):
    hist = []
    print("Mây (MiniGPT) — gõ /moi để bắt đầu lại, /thoat để thoát.\n")
    while True:
        try:
            q = input("Bạn: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not q:
            continue
        if q == "/thoat":
            break
        if q == "/moi":
            hist = []
            print("(cuộc trò chuyện mới)\n")
            continue
        if q.startswith("/nhiet"):
            bot.temperature = float(q.split()[1])
            print(f"(độ sáng tạo = {bot.temperature})\n")
            continue
        hist.append({"role": "user", "content": q})
        print("Mây: ", end="", flush=True)
        ans = ""
        for piece in bot.reply(hist):
            ans += piece
            print(piece, end="", flush=True)
        print("\n")
        hist.append({"role": "assistant", "content": ans.strip()})


def web(bot, share):
    import gradio as gr

    def fn(message, history):
        hist = [{"role": m["role"], "content": m["content"]} for m in history if isinstance(m.get("content"), str)]
        hist.append({"role": "user", "content": message})
        ans = ""
        for piece in bot.reply(hist):
            ans += piece
            yield ans

    gr.ChatInterface(fn, type="messages", title="Mây — MiniGPT của bạn",
                     description="GPT cỡ nhỏ tự huấn luyện từ đầu.").launch(share=share, server_name="0.0.0.0")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="out-chat")
    ap.add_argument("--prompt", help="viết tiếp câu này rồi thoát")
    ap.add_argument("--tokens", type=int, default=200)
    ap.add_argument("--temperature", type=float, default=0.7)
    ap.add_argument("--web", action="store_true")
    ap.add_argument("--share", action="store_true")
    ap.add_argument("--device", default="auto")
    a = ap.parse_args()
    bot = Bot(a.ckpt, a.device)
    bot.temperature = a.temperature
    if a.prompt is not None or not bot.is_chat:
        prompt = a.prompt if a.prompt is not None else input("Câu mở đầu: ")
        print(prompt, end="", flush=True)
        for piece in bot.complete(prompt, a.tokens):
            print(piece, end="", flush=True)
        print()
    elif a.web:
        web(bot, a.share)
    else:
        terminal(bot)


if __name__ == "__main__":
    main()
