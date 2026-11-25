"""Bộ tách từ BPE mức byte — cùng phương pháp GPT-2, viết lại từ đầu, không dùng thư viện ngoài.

Ý tưởng: văn bản → các byte UTF-8 (256 ký hiệu gốc). Huấn luyện = lặp lại "tìm cặp ký hiệu đứng cạnh nhau
hay gặp nhất → gộp thành ký hiệu mới". Sau vài nghìn lần gộp, các âm tiết tiếng Việt hay dùng ("ngư", " không",
" Việt") thành 1 token. Không bao giờ có từ "lạ": thứ gì cũng tách được về byte.

    tok = BPETokenizer.train(cac_van_ban, vocab_size=8000)
    ids = tok.encode("Xin chào Việt Nam")      # → [..]
    tok.decode(ids)                           # → "Xin chào Việt Nam"
    tok.save("tokenizer.json"); BPETokenizer.load("tokenizer.json")
"""
import heapq
import json
import re
import unicodedata
from collections import Counter, defaultdict

# Token đặc biệt: ranh giới văn bản và khung hội thoại cho bản chat.
SPECIAL_TOKENS = ["<|endoftext|>", "<|system|>", "<|user|>", "<|assistant|>", "<|end|>"]

# Tách thô trước khi BPE (giống GPT-2): chữ, số (≤ 3 chữ số), dấu câu, khoảng trắng. Mảnh chữ mang theo
# dấu cách đứng trước (" Việt"). Mẫu này phủ MỌI ký tự nên tách–ghép luôn ra lại đúng văn bản gốc.
PATTERN = r" ?[^\W\d_]+| ?\d{1,3}| ?_+| ?[^\s\w]+|\s+(?!\S)|\s+"


def _nfc(s):
    return unicodedata.normalize("NFC", s)


class BPETokenizer:
    def __init__(self, merges, special_tokens=SPECIAL_TOKENS, pattern=PATTERN):
        self.merges = [tuple(m) for m in merges]                  # thứ tự gộp = độ ưu tiên
        self.ranks = {m: i for i, m in enumerate(self.merges)}
        self.pattern = pattern
        self.pat = re.compile(pattern)
        self.vocab = [bytes([i]) for i in range(256)]              # id → byte
        for a, b in self.merges:
            self.vocab.append(self.vocab[a] + self.vocab[b])
        self.special = {t: len(self.vocab) + i for i, t in enumerate(special_tokens)}
        self.special_inv = {i: t for t, i in self.special.items()}
        self.special_re = re.compile("(" + "|".join(re.escape(t) for t in special_tokens) + ")")
        self.cache = {}

    # ---------- kích thước & id đặc biệt ----------
    @property
    def vocab_size(self):
        return len(self.vocab) + len(self.special)

    def __getattr__(self, name):  # tok.eot, tok.user, tok.assistant, tok.end, tok.system
        alias = {"eot": "<|endoftext|>", "system": "<|system|>", "user": "<|user|>", "assistant": "<|assistant|>", "end": "<|end|>"}
        if name in alias and "special" in self.__dict__:
            return self.special[alias[name]]
        raise AttributeError(name)

    # ---------- huấn luyện ----------
    @classmethod
    def train(cls, texts, vocab_size=8000, verbose=True):
        """texts: iterable chuỗi. vocab_size gồm 256 byte + các lần gộp + token đặc biệt."""
        n_merges = vocab_size - 256 - len(SPECIAL_TOKENS)
        if n_merges < 0:
            raise ValueError("vocab_size quá nhỏ")
        pat = re.compile(PATTERN)
        counts = Counter()
        for t in texts:
            counts.update(pat.findall(_nfc(t)))
        words = [list(w.encode("utf-8")) for w in counts]
        freqs = list(counts.values())
        if verbose:
            print(f"[BPE] {len(words):,} mảnh khác nhau, {sum(freqs):,} mảnh tổng; cần {n_merges:,} lần gộp")

        pair_count = defaultdict(int)          # (a, b) → số lần xuất hiện (có trọng số tần suất)
        where = defaultdict(set)               # (a, b) → các mảnh chứa cặp đó
        for i, (w, f) in enumerate(zip(words, freqs)):
            for p in zip(w, w[1:]):
                pair_count[p] += f
                where[p].add(i)
        heap = [(-c, p) for p, c in pair_count.items()]
        heapq.heapify(heap)

        merges = []
        while len(merges) < n_merges and heap:
            negc, p = heapq.heappop(heap)
            c = pair_count.get(p, 0)
            if c != -negc:                     # mục cũ trong heap: bỏ qua hoặc đẩy lại số đếm mới
                if c > 0:
                    heapq.heappush(heap, (-c, p))
                continue
            if c < 2:
                break
            new = 256 + len(merges)
            merges.append(p)
            delta = defaultdict(int)
            for i in where.pop(p):
                w, f = words[i], freqs[i]
                if len(w) < 2:
                    continue
                for q in zip(w, w[1:]):
                    delta[q] -= f
                out, j = [], 0
                while j < len(w):
                    if j + 1 < len(w) and w[j] == p[0] and w[j + 1] == p[1]:
                        out.append(new)
                        j += 2
                    else:
                        out.append(w[j])
                        j += 1
                words[i] = out
                for q in zip(out, out[1:]):
                    delta[q] += f
                    where[q].add(i)
            pair_count.pop(p, None)
            for q, d in delta.items():
                if d and q != p:
                    pair_count[q] += d
                    if pair_count[q] > 0:
                        heapq.heappush(heap, (-pair_count[q], q))
            if verbose and len(merges) % 1000 == 0:
                print(f"[BPE] {len(merges):,}/{n_merges:,} lần gộp")
        return cls(merges)

    # ---------- mã hóa / giải mã ----------
    def _bpe(self, chunk):
        ids = self.cache.get(chunk)
        if ids is not None:
            return ids
        ids = list(chunk.encode("utf-8"))
        while len(ids) > 1:
            best = min(range(len(ids) - 1), key=lambda i: self.ranks.get((ids[i], ids[i + 1]), 1 << 30))
            pair = (ids[best], ids[best + 1])
            r = self.ranks.get(pair)
            if r is None:
                break
            out, j = [], 0
            while j < len(ids):
                if j + 1 < len(ids) and ids[j] == pair[0] and ids[j + 1] == pair[1]:
                    out.append(256 + r)
                    j += 2
                else:
                    out.append(ids[j])
                    j += 1
            ids = out
        if len(self.cache) > 300_000:
            self.cache.clear()
        self.cache[chunk] = ids
        return ids

    def encode(self, text, allow_special=True):
        text = _nfc(text)
        out = []
        parts = self.special_re.split(text) if allow_special else [text]
        for part in parts:
            if not part:
                continue
            if allow_special and part in self.special:
                out.append(self.special[part])
                continue
            for chunk in self.pat.findall(part):
                out.extend(self._bpe(chunk))
        return out

    def decode_bytes(self, ids):
        return b"".join(self.vocab[i] if i < len(self.vocab) else self.special_inv[i].encode() for i in ids)

    def decode(self, ids):
        return self.decode_bytes(ids).decode("utf-8", errors="replace")

    # ---------- lưu / nạp ----------
    def save(self, path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"type": "byte-bpe", "version": 1, "pattern": self.pattern,
                       "special_tokens": list(self.special), "merges": self.merges}, f)

    @classmethod
    def load(cls, path):
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return cls(d["merges"], d["special_tokens"], d["pattern"])


# ---------- mã hóa song song cho kho dữ liệu lớn ----------
_worker_tok = None


def _init_worker(path):
    global _worker_tok
    _worker_tok = BPETokenizer.load(path)


def _encode_docs(docs):
    eot = _worker_tok.eot
    out = []
    for d in docs:
        out.extend(_worker_tok.encode(d, allow_special=False))
        out.append(eot)
    return out


def encode_corpus(tok_path, docs, workers=1, batch=200):
    """Mã hóa nhiều văn bản (mỗi văn bản kết thúc bằng <|endoftext|>). Trả về generator các list id."""
    batches = [docs[i:i + batch] for i in range(0, len(docs), batch)]
    if workers <= 1:
        _init_worker(tok_path)
        for b in batches:
            yield _encode_docs(b)
        return
    import multiprocessing as mp
    with mp.get_context("spawn").Pool(workers, initializer=_init_worker, initargs=(tok_path,)) as pool:
        yield from pool.imap(_encode_docs, batches)
