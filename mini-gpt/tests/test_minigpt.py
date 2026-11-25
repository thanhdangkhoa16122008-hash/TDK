"""Kiểm tra nhanh các phần dễ sai nhất.   python tests/test_minigpt.py"""
import os
import sys
import tempfile

import torch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from minigpt.chat_format import render, to_example  # noqa: E402
from minigpt.model import GPT, GPTConfig  # noqa: E402
from minigpt.tokenizer import PATTERN, BPETokenizer  # noqa: E402

TEXT = """Việt Nam, quốc hiệu là Cộng hòa Xã hội chủ nghĩa Việt Nam, là một quốc gia nằm ở cực Đông của bán đảo Đông Dương.
Thủ đô là Hà Nội, thành phố đông dân nhất là Thành phố Hồ Chí Minh. Dân số khoảng 100 triệu người (năm 2023).
Tiếng Việt có 6 thanh: ngang, huyền, sắc, hỏi, ngã, nặng. Ví dụ: ma, mà, má, mả, mã, mạ.
Code: x_1 = 3.14159 * r**2; print("chào 👋 thế giới!")   \t  dòng có tab
"""


def test_tokenizer():
    import re
    pat = re.compile(PATTERN)
    for s in [TEXT, "a__b  c\n\n\nd", "😀😀 ²³ ½", "   ", "Đ đ Ư ư Ơ ơ"]:
        assert "".join(pat.findall(s)) == s, "mẫu tách phải phủ mọi ký tự"
    tok = BPETokenizer.train([TEXT] * 5, vocab_size=400, verbose=False)
    for s in [TEXT, "Xin chào Mây! Hôm nay thế nào?", "🙂 emoji & ký tự lạ ∑∫", ""]:
        ids = tok.encode(s)
        assert tok.decode(ids) == s, f"tách–ghép sai: {s!r}"
    assert len(tok.encode(TEXT)) < len(TEXT.encode()) / 2, "BPE phải nén đáng kể"
    s = "<|user|>chào<|end|><|assistant|>"
    ids = tok.encode(s)
    assert ids[0] == tok.user and tok.end in ids and ids[-1] == tok.assistant
    assert tok.encode(s, allow_special=False).count(tok.user) == 0
    with tempfile.TemporaryDirectory() as d:
        tok.save(os.path.join(d, "t.json"))
        t2 = BPETokenizer.load(os.path.join(d, "t.json"))
        assert t2.encode(TEXT) == tok.encode(TEXT) and t2.vocab_size == tok.vocab_size
    print(f"✓ bộ tách từ: tách–ghép đúng, {len(TEXT.encode())} byte → {len(tok.encode(TEXT))} token")
    return tok


def test_kv_cache():
    torch.manual_seed(0)
    m = GPT(GPTConfig(vocab_size=300, block_size=32, n_layer=2, n_head=2, n_embd=32)).eval()
    x = torch.randint(0, 300, (1, 20))
    with torch.no_grad():
        full, _, _ = m(x, targets=torch.zeros_like(x))       # logits mọi vị trí, tính một lần
        _, _, c = m(x[:, :12])                                # nạp 12 token đầu
        out = []
        pos = 12
        for t in range(12, 20):                               # rồi từng token một qua bộ nhớ đệm
            lg, _, c = m(x[:, t:t + 1], caches=c, pos=pos)
            pos += 1
            out.append(lg[0, -1])
        _, _, c2 = m(x[:, :10])                               # nạp 10 token rồi thêm 5 token một lượt
        lg5, _, _ = m(x[:, 10:15], caches=c2, pos=10)
    for i, t in enumerate(range(12, 20)):
        assert torch.allclose(out[i], full[0, t], atol=1e-4), "bộ nhớ đệm KV lệch"
    assert torch.allclose(lg5[0, -1], full[0, 14], atol=1e-4), "nạp nhiều token sau bộ nhớ đệm lệch"
    print("✓ bộ nhớ đệm KV khớp với tính toàn bộ (từng token và nhiều token)")


def test_overfit():
    torch.manual_seed(0)
    m = GPT(GPTConfig(vocab_size=100, block_size=16, n_layer=2, n_head=2, n_embd=32))
    x = torch.randint(0, 100, (4, 16))
    y = torch.roll(x, -1, 1)
    opt = m.configure_optimizer(0.0, 3e-3)
    first = None
    for _ in range(150):
        _, loss, _ = m(x, y)
        first = first or loss.item()
        opt.zero_grad()
        loss.backward()
        opt.step()
    assert loss.item() < first * 0.2, (first, loss.item())
    gen = list(m.generate(x[0, :4].tolist(), max_new_tokens=8, temperature=0))
    assert gen == x[0, 4:12].tolist(), "sau khi học thuộc phải viết lại đúng chuỗi"
    print(f"✓ học thuộc 1 lô: loss {first:.2f} → {loss.item():.3f}, sinh lại đúng chuỗi")


def test_sft_mask(tok):
    ids, mask = render(tok, [{"role": "user", "content": "Xin chào"}, {"role": "assistant", "content": "Chào bạn!"}])
    x, y = to_example(ids, mask, 512)
    learned = [t for t in y if t != -100]
    assert tok.decode(learned) == "Chào bạn!<|end|>", tok.decode(learned)
    print("✓ SFT chỉ chấm điểm lời trợ lý (kể cả <|end|>)")


if __name__ == "__main__":
    tok = test_tokenizer()
    test_kv_cache()
    test_overfit()
    test_sft_mask(tok)
    print("Tất cả đạt.")
