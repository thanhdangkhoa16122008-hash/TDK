"""Bước 3 — Dạy hội thoại (SFT): biến GPT "viết tiếp văn bản" thành trợ lý biết trả lời.

    python sft.py --base out --data data/sft_vi.jsonl --out out-chat --epochs 4

Dữ liệu: mỗi dòng {"messages": [{"role": "user"|"assistant"|"system", "content": "..."}, ...]}.
Mô hình chỉ bị chấm điểm ở lời trợ lý → học cách đáp, không học thuộc câu hỏi.
"""
import argparse
import json
import math
import os
import random
import shutil
import sys
import time
from contextlib import nullcontext
from dataclasses import asdict
from pathlib import Path

import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from minigpt.chat_format import render, to_example  # noqa: E402
from minigpt.model import load_checkpoint  # noqa: E402
from minigpt.tokenizer import BPETokenizer  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="out", help="thư mục mô hình đã tiền huấn luyện")
    ap.add_argument("--data", nargs="+", default=["data/sft_vi.jsonl"])
    ap.add_argument("--out", default="out-chat")
    ap.add_argument("--epochs", type=float, default=4)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--device", default="auto")
    a = ap.parse_args()

    dev = ("cuda" if torch.cuda.is_available() else "cpu") if a.device == "auto" else a.device
    dtype = "bfloat16" if dev == "cuda" and torch.cuda.is_bf16_supported() else "float16" if dev == "cuda" else "float32"
    ctx = torch.autocast(dev, dtype=getattr(torch, dtype)) if dtype != "float32" else nullcontext()
    scaler = torch.amp.GradScaler(enabled=(dtype == "float16"))
    torch.manual_seed(0)
    random.seed(0)

    base, out = Path(a.base), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    tok = BPETokenizer.load(base / "tokenizer.json")
    shutil.copy(base / "tokenizer.json", out / "tokenizer.json")
    model, ck = load_checkpoint(base / "ckpt.pt", dev)
    bs = model.config.block_size

    convs = []
    for f in a.data:
        for line in Path(f).read_text(encoding="utf-8").splitlines():
            if line.strip():
                convs.append(json.loads(line)["messages"])
    examples = []
    for m in convs:
        x, y = to_example(*render(tok, m), bs)
        if any(t != -100 for t in y):
            examples.append((x, y))
    n_tok = sum(sum(t != -100 for t in y) for _, y in examples)
    steps = math.ceil(len(examples) / a.batch_size * a.epochs)
    print(f"{len(examples)} hội thoại · {n_tok:,} token lời trợ lý · {steps} bước · thiết bị {dev}")

    opt = model.configure_optimizer(0.0, a.lr, device_type=dev)
    model.train()
    t0, step = time.time(), 0
    while step < steps:
        random.shuffle(examples)
        for i in range(0, len(examples), a.batch_size):
            if step >= steps:
                break
            chunk = examples[i:i + a.batch_size]
            L = max(len(x) for x, _ in chunk)
            X = torch.full((len(chunk), L), tok.eot, dtype=torch.long)
            Y = torch.full((len(chunk), L), -100, dtype=torch.long)
            for j, (x, y) in enumerate(chunk):
                X[j, :len(x)] = torch.tensor(x)
                Y[j, :len(y)] = torch.tensor(y)
            lr = a.lr * min(1.0, (step + 1) / 30) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * step / steps)))
            for g in opt.param_groups:
                g["lr"] = lr
            with ctx:
                _, loss, _ = model(X.to(dev), Y.to(dev))
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            opt.zero_grad(set_to_none=True)
            step += 1
            if step % 20 == 0 or step == steps:
                print(f"bước {step}/{steps} · loss {loss.item():.3f} · {time.time() - t0:.0f}s")

    torch.save({"model": model.state_dict(), "config": asdict(model.config), "kind": "chat",
                "base_iter": ck.get("iter"), "sft_convs": len(examples)}, out / "ckpt.pt")
    print(f"✓ Mô hình chat đã lưu ở {out}/. Trò chuyện: python chat.py --ckpt {out}")


if __name__ == "__main__":
    main()
