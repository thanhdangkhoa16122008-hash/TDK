"""Kiểm tra bản chạy điện thoại (mobile/minigpt.js) khớp PyTorch.   python tests/test_mobile.py   (cần Node.js)"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import torch

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
from export_mobile import export  # noqa: E402
from minigpt.chat_format import render  # noqa: E402
from minigpt.model import GPT, GPTConfig  # noqa: E402
from minigpt.tokenizer import BPETokenizer  # noqa: E402

TEXT = open(os.path.join(ROOT, "README.md"), encoding="utf-8").read()
WEIRD = [
    "Xin chào Việt Nam! Hôm nay 25/11/2026, nhiệt độ 28°C.",
    "Tiếng Việt tổ hợp: Việt (NFD) và Việt (NFC)",            # dấu tổ hợp → chuẩn hóa NFC
    "khoảng　trắng lạ dòng\u0085mới\x1cgroup\x1f﻿BOM\t\ttab  hai",
    "số ٣٤٥ (Ả Rập) ²³ ½ Ⅻ ⅷ 1234567 x_1__y ___",
    "emoji 👨‍👩‍👧 🇻🇳 ✨ — “ngoặc” «Pháp» … ‽ 中文字符 日本語 한국어 العربية",
    "   bắt đầu bằng cách\n\n\nnhiều dòng   \n  cuối   ",
]


def run():
    torch.manual_seed(0)
    tok = BPETokenizer.train([TEXT] * 3, vocab_size=600, verbose=False)
    cfg = GPTConfig(vocab_size=tok.vocab_size, block_size=64, n_layer=2, n_head=4, n_embd=64)
    model = GPT(cfg)
    data = torch.tensor(tok.encode(TEXT)[:4000])
    opt = model.configure_optimizer(0.0, 3e-3)
    for _ in range(120):                                    # học sơ để logits không còn ngẫu nhiên
        ix = torch.randint(0, len(data) - 65, (16,))
        x = torch.stack([data[i:i + 64] for i in ix]); y = torch.stack([data[i + 1:i + 65] for i in ix])
        _, loss, _ = model(x, y)
        opt.zero_grad(); loss.backward(); opt.step()
    model.eval()
    with tempfile.TemporaryDirectory() as d:
        tok.save(os.path.join(d, "tokenizer.json"))
        torch.save({"model": model.state_dict(), "config": cfg.__dict__, "kind": "chat"}, os.path.join(d, "ckpt.pt"))
        seq = data[:40].tolist()
        prompt = tok.encode("Mây là")
        msgs = [{"role": "user", "content": "Xin chào"}, {"role": "assistant", "content": "Chào bạn!"}, {"role": "user", "content": " Bạn là ai? "}]
        with torch.no_grad():
            ref_logits = model(torch.tensor([seq]), targets=torch.zeros(1, len(seq), dtype=torch.long))[0][0].numpy()
        ref_greedy = list(model.generate(prompt, max_new_tokens=30, temperature=0, repetition_penalty=1.0))
        ref_chat, _ = render(tok, msgs, add_generation_prompt=True)
        q = {"texts": WEIRD + [TEXT[:3000]], "seq": seq, "prompt": prompt, "n_gen": 30, "messages": msgs}
        json.dump(q, open(os.path.join(d, "q.json"), "w"))
        results = {}
        for quant in ("fp32", "int8"):
            f = os.path.join(d, f"m-{quant}.mgpt")
            export(d, f, quant)
            out = subprocess.run(["node", os.path.join(ROOT, "tests", "mobile_check.js"), f, os.path.join(d, "q.json")],
                                 capture_output=True, text=True, check=True).stdout
            results[quant] = (json.loads(out), os.path.getsize(f))

    js, size32 = results["fp32"]
    for t, ids in zip(q["texts"], js["encode"]):
        assert ids == tok.encode(t), f"bộ tách từ JS khác Python: {t[:40]!r}"
    assert all(js["decode_ok"]), "JS tách–ghép không ra lại văn bản"
    print(f"✓ bộ tách từ JS trùng Python trên {len(q['texts'])} văn bản (kể cả khoảng trắng/chữ số/emoji lạ)")
    d32 = np.abs(np.array(js["logits"]) - ref_logits).max()
    assert d32 < 1e-3, d32
    assert js["greedy"] == ref_greedy, (js["greedy"], ref_greedy)
    keep = cfg.block_size - min(200, cfg.block_size // 2)      # cùng cách cắt với chat.py
    assert js["chat"] == ref_chat[-keep:], "khung hội thoại JS khác Python"
    assert js["reuse_ok"], "dùng lại bộ nhớ đệm KV giữa các lượt cho kết quả khác"
    print(f"✓ fp32: logits lệch tối đa {d32:.1e}, 30 token sinh tham lam trùng khớp, khung hội thoại trùng khớp, dùng lại bộ nhớ đệm giữa các lượt đúng")

    j8, size8 = results["int8"]
    l8 = np.array(j8["logits"])
    d8 = np.abs(l8 - ref_logits).max()
    agree = float(np.mean(l8.argmax(1) == ref_logits.argmax(1)))
    rel = float(np.linalg.norm(l8 - ref_logits) / np.linalg.norm(ref_logits))
    assert agree >= 0.9 and rel < 0.05, (agree, rel)
    print(f"✓ int8: file {size8 / 1024:.0f} KB (fp32 {size32 / 1024:.0f} KB), lệch tương đối {rel:.2%}, "
          f"token đoán nhiều nhất trùng {agree:.0%}; tốc độ JS ~{j8['tps']:.0f} token/s (mô hình thử)")


if __name__ == "__main__":
    run()
    print("Tất cả đạt.")
