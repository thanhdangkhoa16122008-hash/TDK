"""Bước 2 — Tiền huấn luyện: dạy GPT đoán token tiếp theo trên kho văn bản.

    python train.py --data data-vi --preset nano --max-iters 2000          # thử nhanh trên CPU
    python train.py --data data-vi --preset small --time-limit 150 --out out   # Colab T4 (~2,5 giờ)

Tự tiếp tục từ out/ckpt.pt nếu đã có (Colab ngắt giữa chừng thì chạy lại đúng lệnh cũ).
"""
import argparse
import json
import math
import os
import shutil
import sys
import time
from contextlib import nullcontext
from dataclasses import asdict
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from minigpt.model import GPT, GPTConfig  # noqa: E402
from minigpt.tokenizer import BPETokenizer  # noqa: E402

# Cỡ mô hình. Số tham số chưa tính phần nhúng token (vocab × n_embd).
PRESETS = {
    "nano":  dict(n_layer=4,  n_head=4,  n_embd=128, block_size=128,  batch_size=32, grad_accum=1, lr=1e-3),   # ~0,8M · CPU, vài phút
    "mini":  dict(n_layer=6,  n_head=6,  n_embd=384, block_size=256,  batch_size=32, grad_accum=1, lr=6e-4),   # ~10,6M · CPU mạnh / GPU nhỏ
    "small": dict(n_layer=8,  n_head=8,  n_embd=512, block_size=512,  batch_size=16, grad_accum=4, lr=6e-4),   # ~25,2M · Colab T4
    "base":  dict(n_layer=12, n_head=12, n_embd=768, block_size=1024, batch_size=8,  grad_accum=8, lr=6e-4),   # ~85M · cỡ GPT-2 small, GPU ≥ 24 GB
}


def get_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data-vi")
    ap.add_argument("--out", default="out")
    ap.add_argument("--preset", default="mini", choices=PRESETS)
    for k in ("n_layer", "n_head", "n_embd", "block_size", "batch_size", "grad_accum"):
        ap.add_argument("--" + k.replace("_", "-"), type=int)
    ap.add_argument("--lr", type=float)
    ap.add_argument("--dropout", type=float, default=0.0)
    ap.add_argument("--weight-decay", type=float, default=0.1)
    ap.add_argument("--grad-clip", type=float, default=1.0)
    ap.add_argument("--max-iters", type=int, default=5000)
    ap.add_argument("--warmup", type=int, default=200)
    ap.add_argument("--time-limit", type=float, default=0, help="phút; dừng & lưu khi hết giờ (0 = không giới hạn)")
    ap.add_argument("--eval-every", type=int, default=250)
    ap.add_argument("--eval-iters", type=int, default=40)
    ap.add_argument("--log-every", type=int, default=20)
    ap.add_argument("--prompt", default="Việt Nam là", help="câu mở đầu để xem mô hình viết thử khi đánh giá")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--compile", action="store_true", help="torch.compile (nhanh hơn trên GPU, khởi động lâu)")
    ap.add_argument("--fresh", action="store_true", help="bỏ checkpoint cũ, học lại từ đầu")
    a = ap.parse_args()
    for k, v in PRESETS[a.preset].items():
        if getattr(a, k, None) is None:
            setattr(a, k, v)
    return a


def main():
    a = get_args()
    dev = ("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu") if a.device == "auto" else a.device
    dtype = "bfloat16" if dev == "cuda" and torch.cuda.is_bf16_supported() else "float16" if dev == "cuda" else "float32"
    ctx = torch.autocast(dev, dtype=getattr(torch, dtype)) if dtype != "float32" else nullcontext()
    scaler = torch.amp.GradScaler(enabled=(dtype == "float16"))
    torch.manual_seed(1337)
    if dev == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

    data, out = Path(a.data), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    tok = BPETokenizer.load(data / "tokenizer.json")
    shutil.copy(data / "tokenizer.json", out / "tokenizer.json")
    train = np.memmap(data / "train.bin", dtype=np.uint16, mode="r")
    val = np.memmap(data / "val.bin", dtype=np.uint16, mode="r")
    bs = a.block_size
    if len(val) <= bs + 1:      # dữ liệu kiểm tra quá ít: tạm dùng phần cuối tập huấn luyện
        val = train[-max(len(train) // 10, bs + 2):]

    def batch(split):
        d = train if split == "train" else val
        ix = np.random.randint(0, len(d) - bs - 1, a.batch_size)
        x = torch.from_numpy(np.stack([d[i:i + bs].astype(np.int64) for i in ix]))
        y = torch.from_numpy(np.stack([d[i + 1:i + 1 + bs].astype(np.int64) for i in ix]))
        if dev == "cuda":
            return x.pin_memory().to(dev, non_blocking=True), y.pin_memory().to(dev, non_blocking=True)
        return x.to(dev), y.to(dev)

    ck_path = out / "ckpt.pt"
    start_it, best = 0, float("inf")
    if ck_path.exists() and not a.fresh:
        ck = torch.load(ck_path, map_location=dev, weights_only=False)
        cfg = GPTConfig(**ck["config"])
        model = GPT(cfg).to(dev)
        model.load_state_dict(ck["model"])
        start_it, best = ck["iter"], ck.get("best_val", best)
        print(f"↻ Tiếp tục từ bước {start_it} (val tốt nhất {best:.3f})")
    else:
        ck = None
        cfg = GPTConfig(vocab_size=tok.vocab_size, block_size=bs, n_layer=a.n_layer, n_head=a.n_head,
                        n_embd=a.n_embd, dropout=a.dropout)
        model = GPT(cfg).to(dev)
    opt = model.configure_optimizer(a.weight_decay, a.lr, device_type=dev)
    if ck and "optimizer" in ck:
        opt.load_state_dict(ck["optimizer"])
    net = torch.compile(model) if a.compile else model

    tokens_per_iter = a.batch_size * a.grad_accum * bs
    print(f"Thiết bị {dev} ({dtype}) · {model.num_params() / 1e6:.2f}M tham số · ngữ cảnh {bs} · "
          f"{tokens_per_iter:,} token/bước · dữ liệu {len(train) / 1e6:.2f}M token "
          f"(≈ {len(train) / tokens_per_iter:.0f} bước/vòng)")

    min_lr = a.lr / 10

    def lr_at(it):              # khởi động tuyến tính rồi giảm theo cosine
        if it < a.warmup:
            return a.lr * (it + 1) / a.warmup
        r = min(1.0, (it - a.warmup) / max(1, a.max_iters - a.warmup))
        return min_lr + 0.5 * (1 + math.cos(math.pi * r)) * (a.lr - min_lr)

    @torch.no_grad()
    def evaluate():
        model.eval()
        res = {}
        for split in ("train", "val"):
            losses = []
            for _ in range(a.eval_iters):
                x, y = batch(split)
                with ctx:
                    _, loss, _ = net(x, y)
                losses.append(loss.item())
            res[split] = float(np.mean(losses))
        model.train()
        return res

    def save(it, best_val):
        torch.save({"model": model.state_dict(), "config": asdict(cfg), "iter": it, "best_val": best_val,
                    "optimizer": opt.state_dict(), "kind": "pretrain", "args": vars(a)}, out / "ckpt.tmp")
        os.replace(out / "ckpt.tmp", ck_path)

    def sample():
        ids = tok.encode(a.prompt)
        gen = list(model.generate(ids, max_new_tokens=60, temperature=0.8, top_k=50, stop_ids=(tok.eot,)))
        model.train()
        return tok.decode(ids + gen).replace("\n", " ⏎ ")

    t_start = time.time()
    t0 = time.time()
    model.train()
    it = start_it
    log = open(out / "log.jsonl", "a")
    while it < a.max_iters:
        for g in opt.param_groups:
            g["lr"] = lr_at(it)
        if it % a.eval_every == 0 and it > start_it or it == a.max_iters - 1:
            r = evaluate()
            best = min(best, r["val"])
            print(f"── bước {it}: loss train {r['train']:.3f} · val {r['val']:.3f} (ppl {math.exp(r['val']):.1f})")
            print(f"   ✍ {sample()}")
            log.write(json.dumps({"iter": it, **r}) + "\n")
            log.flush()
            save(it, best)
        for _ in range(a.grad_accum):
            x, y = batch("train")
            with ctx:
                _, loss, _ = net(x, y)
            scaler.scale(loss / a.grad_accum).backward()
        if a.grad_clip:
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), a.grad_clip)
        scaler.step(opt)
        scaler.update()
        opt.zero_grad(set_to_none=True)
        it += 1
        if it % a.log_every == 0:
            dt = (time.time() - t0) / a.log_every
            t0 = time.time()
            print(f"bước {it:>6} · loss {loss.item():.3f} · lr {lr_at(it):.2e} · {dt * 1000:.0f} ms/bước · "
                  f"{tokens_per_iter / dt / 1000:.1f}k token/s")
        if a.time_limit and time.time() - t_start > a.time_limit * 60:
            print(f"⏱ Hết {a.time_limit:.0f} phút — lưu lại, chạy lại lệnh này để học tiếp.")
            break
    save(it, best)
    print(f"✓ Đã lưu {ck_path} (bước {it}). Viết thử: python chat.py --ckpt {out} --prompt \"{a.prompt}\"")


if __name__ == "__main__":
    main()
