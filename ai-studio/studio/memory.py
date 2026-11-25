"""Trí nhớ dài hạn về người dùng + kho kiến thức riêng (ghi chú, tài liệu).

Tất cả lưu thành file trong thư mục STUDIO_HOME (mặc định ai-studio/userdata/) — thuộc về bạn,
xem/sửa/xóa được, chép sang máy khác được. Trên Colab, sổ tay nối thư mục này vào Google Drive.

Tìm kiếm kiến thức dùng BM25 trên từ đã bỏ dấu + cặp từ: không cần tải thêm mô hình, chạy cả trên CPU.
"""
import json
import math
import os
import re
import threading
import time
import uuid
from collections import Counter
from pathlib import Path

from .config import normalize_vi

HOME = Path(os.environ.get("STUDIO_HOME", Path(__file__).resolve().parents[1] / "userdata"))


def _tokens(text):
    w = re.findall(r"[a-z0-9]+", normalize_vi(text))
    return w + [f"{a}_{b}" for a, b in zip(w, w[1:])]


class Memory:
    """Những điều đáng nhớ về người dùng: [{id, text, created}]."""

    def __init__(self, path=None):
        self.path = Path(path or HOME / "memory.json")
        self.lock = threading.Lock()
        self.items = []
        if self.path.exists():
            try:
                self.items = json.loads(self.path.read_text(encoding="utf-8"))
            except ValueError:
                self.items = []

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.items, ensure_ascii=False, indent=1), encoding="utf-8")

    def add(self, text):
        text = " ".join(str(text).split()).strip(" .-•")
        if len(text) < 4:
            return None
        with self.lock:
            key = set(_tokens(text))
            for it in self.items:  # bỏ trùng: giống ≥ 80% thì thay bản cũ bằng bản mới
                old = set(_tokens(it["text"]))
                if key and len(key & old) / max(1, min(len(key), len(old))) >= 0.8:
                    it["text"], it["created"] = text, time.strftime("%Y-%m-%d")
                    self._save()
                    return it
            it = {"id": uuid.uuid4().hex[:8], "text": text, "created": time.strftime("%Y-%m-%d")}
            self.items.append(it)
            self._save()
            return it

    def remove(self, ids):
        with self.lock:
            ids = set(ids)
            self.items = [i for i in self.items if i["id"] not in ids]
            self._save()

    def as_prompt(self, limit=40):
        if not self.items:
            return ""
        lines = "\n".join(f"- {i['text']}" for i in self.items[-limit:])
        return f"\n\nNhững điều bạn đã biết về người dùng (dùng tự nhiên để hỗ trợ đúng người, đừng nhắc lại máy móc):\n{lines}"


class Notes:
    """Kho kiến thức riêng: tài liệu được cắt thành đoạn, tìm bằng BM25."""

    def __init__(self, path=None):
        self.path = Path(path or HOME / "notes.jsonl")
        self.lock = threading.Lock()
        self.chunks = []
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    self.chunks.append(json.loads(line))
        self._index()

    def _index(self):
        self.tf = [Counter(_tokens(c["text"])) for c in self.chunks]
        self.len = [sum(t.values()) for t in self.tf]
        self.avg = (sum(self.len) / len(self.len)) if self.len else 1
        df = Counter(k for t in self.tf for k in t)
        n = len(self.chunks)
        self.idf = {k: math.log(1 + (n - v + 0.5) / (v + 0.5)) for k, v in df.items()}

    @staticmethod
    def read_file(path):
        p = Path(path)
        ext = p.suffix.lower()
        if ext == ".pdf":
            from pypdf import PdfReader
            return "\n".join(page.extract_text() or "" for page in PdfReader(str(p)).pages)
        if ext == ".docx":
            import zipfile
            xml = zipfile.ZipFile(p).read("word/document.xml").decode("utf-8", "ignore")
            return re.sub(r"<[^>]+>", "", xml.replace("</w:p>", "\n"))
        return p.read_text(encoding="utf-8", errors="ignore")

    def add_text(self, text, source):
        paras = [x.strip() for x in re.split(r"\n\s*\n", text) if x.strip()]
        chunks, cur = [], ""
        for para in paras:  # gom đoạn văn thành khối ~700 ký tự
            if len(cur) + len(para) > 700 and cur:
                chunks.append(cur)
                cur = ""
            cur = (cur + "\n\n" + para).strip()
            while len(cur) > 1200:
                chunks.append(cur[:1000])
                cur = cur[900:]
        if cur:
            chunks.append(cur)
        with self.lock:
            self.chunks = [c for c in self.chunks if c["source"] != source]  # nạp lại file cùng tên thì thay
            self.chunks += [{"source": source, "text": c} for c in chunks]
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in self.chunks), encoding="utf-8")
            self._index()
        return len(chunks)

    def add_file(self, path, name=None):
        return self.add_text(self.read_file(path), name or Path(path).name)

    def remove(self, source):
        with self.lock:
            self.chunks = [c for c in self.chunks if c["source"] != source]
            self.path.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in self.chunks), encoding="utf-8")
            self._index()

    def sources(self):
        return sorted(Counter(c["source"] for c in self.chunks).items())

    def search(self, query, k=4, min_score=1.5):
        q = [t for t in set(_tokens(query)) if t in self.idf]
        scored = []
        for i, tf in enumerate(self.tf):
            s = 0.0
            for t in q:
                f = tf.get(t, 0)
                if f:
                    s += self.idf[t] * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * self.len[i] / self.avg))
            if s >= min_score:
                scored.append((s, i))
        return [self.chunks[i] | {"score": round(s, 2)} for s, i in sorted(scored, reverse=True)[:k]]

    def as_prompt(self, query, k=4):
        hits = self.search(query, k)
        if not hits:
            return ""
        body = "\n\n".join(f"[{h['source']}]\n{h['text']}" for h in hits)
        return f"\n\nTrích từ tài liệu riêng của người dùng (ưu tiên dùng khi liên quan, ghi rõ lấy từ tài liệu nào):\n{body}"


def parse_memories(text):
    """Đọc kết quả trích trí nhớ của LLM: mảng JSON chuỗi, hoặc gạch đầu dòng."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    m = re.search(r"\[.*\]", text, re.S)
    if m:
        try:
            return [str(x) for x in json.loads(m.group(0)) if str(x).strip()]
        except ValueError:
            pass
    return [l.strip(" -•*") for l in text.splitlines() if l.strip().startswith(("-", "•", "*"))]
