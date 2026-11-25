"""Xuất MiniGPT sang file .mgpt để chạy trên điện thoại (app Mây AI) hoặc trình duyệt.

    python export_mobile.py --ckpt out-chat --out may.mgpt              # nén 8-bit (mặc định, nhẹ ~4 lần)
    python export_mobile.py --ckpt out-chat --out may.mgpt --quant fp32 # giữ nguyên độ chính xác

Định dạng (little-endian): "MGPT" · u32 phiên bản · u32 độ dài header · header JSON · đệm tới bội số 16 · dữ liệu.
Vị trí tensor trong header tính từ đầu vùng dữ liệu (mỗi tensor căn 16 byte).
Header gồm cấu hình mô hình, bộ tách từ (merges), lời nhắc hệ thống dùng khi dạy hội thoại, và vị trí từng tensor.
8-bit: mỗi hàng ma trận lưu int8 + 1 hệ số float32 (lượng tử đối xứng theo hàng); LayerNorm, nhúng vị trí giữ float32.
"""
import argparse
import json
import os
import struct
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from minigpt.chat_format import DEFAULT_SYSTEM  # noqa: E402


def quantize_rows(w):
    """int8 đối xứng theo hàng: w ≈ q * scale[:, None]."""
    scale = np.abs(w).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    q = np.clip(np.round(w / scale[:, None]), -127, 127).astype(np.int8)
    return q, scale.astype(np.float32)


def export(ckpt_dir, out, quant="int8"):
    d = Path(ckpt_dir)
    ck = torch.load(d / "ckpt.pt", map_location="cpu", weights_only=False)
    tok = json.loads((d / "tokenizer.json").read_text(encoding="utf-8"))
    sd = {k: v.float().numpy() for k, v in ck["model"].items() if k != "lm_head.weight"}  # lm_head dùng chung wte
    tensors, blobs, off = {}, [], 0

    def add(arr):
        nonlocal off
        pad = (-off) % 16
        if pad:
            blobs.append(b"\0" * pad)
            off += pad
        at = off
        b = np.ascontiguousarray(arr).tobytes()
        blobs.append(b)
        off += len(b)
        return at

    for name, w in sd.items():
        shape = list(w.shape)
        is_matrix = w.ndim == 2 and name != "wpe.weight"
        key = name.replace(".weight", "") if name in ("wte.weight", "wpe.weight") else name
        if is_matrix and quant == "int8":
            q, s = quantize_rows(w)
            tensors[key] = {"shape": shape, "dtype": "i8", "offset": add(q), "scale_offset": add(s)}
        elif is_matrix and quant == "fp16":
            tensors[key] = {"shape": shape, "dtype": "f16", "offset": add(w.astype(np.float16))}
        else:
            tensors[key] = {"shape": shape, "dtype": "f32", "offset": add(w.astype(np.float32))}

    header = {"config": ck["config"], "kind": ck.get("kind", "pretrain"), "quant": quant, "system": DEFAULT_SYSTEM,
              "tokenizer": {"pattern": tok["pattern"], "special_tokens": tok["special_tokens"], "merges": tok["merges"]},
              "tensors": tensors}
    hb = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    head = b"MGPT" + struct.pack("<II", 1, len(hb)) + hb
    head += b"\0" * ((-len(head)) % 16)      # dữ liệu bắt đầu ở bội số 16 ngay sau header
    with open(out, "wb") as f:
        f.write(head)
        for b in blobs:
            f.write(b)
    n = sum(int(np.prod(t["shape"])) for t in tensors.values())
    return {"params": n, "bytes": os.path.getsize(out), "kind": header["kind"], "quant": quant}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="out-chat")
    ap.add_argument("--out", default="may.mgpt")
    ap.add_argument("--quant", default="int8", choices=["int8", "fp16", "fp32"])
    a = ap.parse_args()
    r = export(a.ckpt, a.out, a.quant)
    print(f"✓ {a.out}: {r['params'] / 1e6:.1f}M tham số · {r['bytes'] / 1e6:.1f} MB · {r['quant']} · bản {r['kind']}")
    print("  Chép file này vào điện thoại → app Mây AI → Cài đặt → MiniGPT → Nạp file.")


if __name__ == "__main__":
    main()
