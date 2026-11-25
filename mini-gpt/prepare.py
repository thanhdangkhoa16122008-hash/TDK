"""Bước 1 — Chuẩn bị dữ liệu: gom văn bản → huấn luyện bộ tách từ → mã hóa thành train.bin / val.bin.

    python prepare.py --input corpus/ ghi_chu.txt --vocab 8000 --out data-vi
    python prepare.py --wiki 200000 --vocab 16000 --out data-vi          # Wikipedia tiếng Việt (cần: pip install datasets)
    python prepare.py --hf-dataset TEN/BO_DU_LIEU --hf-field text --hf-limit 100000 --out data-vi

Đầu vào hỗ trợ: .txt .md (mỗi file một văn bản; file lớn tự chia theo đoạn), .jsonl (trường "text").
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from minigpt.tokenizer import BPETokenizer, encode_corpus  # noqa: E402


def read_inputs(paths):
    files = []
    for p in map(Path, paths):
        files += sorted(f for f in (p.rglob("*") if p.is_dir() else [p]) if f.suffix.lower() in {".txt", ".md", ".jsonl"})
    for f in files:
        if f.suffix.lower() == ".jsonl":
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                if line.strip():
                    t = json.loads(line).get("text")
                    if t:
                        yield t
        else:
            text = f.read_text(encoding="utf-8", errors="ignore")
            if len(text) < 200_000:
                yield text
            else:                           # file lớn: chia thành văn bản ~20k ký tự theo đoạn
                buf = ""
                for para in text.split("\n\n"):
                    buf += para + "\n\n"
                    if len(buf) > 20_000:
                        yield buf.strip()
                        buf = ""
                if buf.strip():
                    yield buf.strip()


def read_hf(name, config, field, limit, split="train"):
    from datasets import load_dataset
    ds = load_dataset(name, config, split=split, streaming=True)
    for i, row in enumerate(ds):
        if i >= limit:
            break
        if i and i % 10_000 == 0:
            print(f"  … {i:,}/{limit:,}", flush=True)
        t = row.get(field) or ""
        if "title" in row and row["title"]:
            t = f"{row['title']}\n\n{t}"
        if len(t) > 50:
            yield t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", nargs="*", default=[], help="file/thư mục văn bản")
    ap.add_argument("--wiki", type=int, default=0, help="số bài Wikipedia tiếng Việt cần lấy")
    ap.add_argument("--hf-dataset"); ap.add_argument("--hf-config"); ap.add_argument("--hf-field", default="text")
    ap.add_argument("--hf-limit", type=int, default=100_000)
    ap.add_argument("--vocab", type=int, default=8000, help="kích thước từ vựng BPE (tiếng Việt: 8k–16k)")
    ap.add_argument("--tok-sample-mb", type=float, default=60, help="dùng bao nhiêu MB văn bản để học bộ tách từ")
    ap.add_argument("--val-frac", type=float, default=0.005)
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--out", default="data-vi")
    a = ap.parse_args()

    t0 = time.time()
    docs = list(read_inputs(a.input))
    if a.wiki:
        print(f"Tải {a.wiki:,} bài Wikipedia tiếng Việt…")
        docs += list(read_hf("wikimedia/wikipedia", "20231101.vi", "text", a.wiki))
    if a.hf_dataset:
        docs += list(read_hf(a.hf_dataset, a.hf_config, a.hf_field, a.hf_limit))
    if not docs:
        sys.exit("Không có dữ liệu. Dùng --input, --wiki hoặc --hf-dataset.")
    chars = sum(map(len, docs))
    print(f"{len(docs):,} văn bản · {chars / 1e6:.1f} triệu ký tự")

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sample, n = [], 0
    for d in docs:                                # học bộ tách từ trên một phần dữ liệu là đủ
        sample.append(d)
        n += len(d)
        if n > a.tok_sample_mb * 1e6:
            break
    tok = BPETokenizer.train(sample, a.vocab)
    tok.save(out / "tokenizer.json")
    assert tok.vocab_size < 65536
    print(f"Bộ tách từ: {tok.vocab_size:,} token · {time.time() - t0:.0f}s")

    rng = np.random.default_rng(0)
    order = rng.permutation(len(docs))
    n_val = max(1, int(len(docs) * a.val_frac)) if len(docs) > 1 else 0
    splits = {"val": [docs[i] for i in order[:n_val]], "train": [docs[i] for i in order[n_val:]]}
    if not splits["val"]:
        splits["val"] = splits["train"][-1:]
    meta = {"vocab_size": tok.vocab_size, "docs": len(docs), "chars": chars}
    for name, ds in splits.items():
        parts, n_tok = [], 0
        for ids in encode_corpus(str(out / "tokenizer.json"), ds, workers=a.workers):
            parts.append(np.array(ids, dtype=np.uint16))
            n_tok += len(ids)
        np.concatenate(parts).tofile(out / f"{name}.bin")
        meta[f"{name}_tokens"] = n_tok
        print(f"{name}: {n_tok:,} token")
    meta["chars_per_token"] = round(chars / max(1, meta["train_tokens"] + meta["val_tokens"]), 2)
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"✓ Xong trong {time.time() - t0:.0f}s → {out}/ (train.bin, val.bin, tokenizer.json) · {meta['chars_per_token']} ký tự/token")


if __name__ == "__main__":
    main()
