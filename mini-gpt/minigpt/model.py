"""Mô hình GPT (Transformer chỉ có bộ giải mã) — cùng kiến trúc GPT-2, viết gọn bằng PyTorch.

    văn bản → token → [nhúng token + nhúng vị trí]
            → N × Khối(LayerNorm → Chú ý nhân quả nhiều đầu → +, LayerNorm → MLP → +)
            → LayerNorm → tầng ra (dùng chung trọng số với nhúng token) → xác suất token kế tiếp

Mô hình chỉ học một việc: đoán token tiếp theo. Mọi khả năng (viết câu, trả lời) nảy sinh từ việc đó.
"""
import math
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class GPTConfig:
    vocab_size: int = 8000
    block_size: int = 256      # độ dài ngữ cảnh tối đa (token)
    n_layer: int = 6           # số khối Transformer
    n_head: int = 6            # số đầu chú ý
    n_embd: int = 384          # kích thước vector ẩn
    dropout: float = 0.0
    bias: bool = False         # bỏ bias: nhanh hơn, tốt ngang


class CausalSelfAttention(nn.Module):
    def __init__(self, c: GPTConfig):
        super().__init__()
        assert c.n_embd % c.n_head == 0
        self.n_head, self.dropout = c.n_head, c.dropout
        self.qkv = nn.Linear(c.n_embd, 3 * c.n_embd, bias=c.bias)
        self.proj = nn.Linear(c.n_embd, c.n_embd, bias=c.bias)
        self.resid_drop = nn.Dropout(c.dropout)

    def forward(self, x, cache=None):
        B, T, C = x.shape
        q, k, v = self.qkv(x).split(C, dim=2)
        q, k, v = (t.view(B, T, self.n_head, C // self.n_head).transpose(1, 2) for t in (q, k, v))
        if cache is not None:                      # bộ nhớ đệm KV: nối khóa/giá trị của các token trước
            k = torch.cat([cache[0], k], dim=2)
            v = torch.cat([cache[1], v], dim=2)
        S = k.size(2)
        drop = self.dropout if self.training else 0.0
        if S == T:                                 # không có quá khứ: che tam giác chuẩn
            y = F.scaled_dot_product_attention(q, k, v, dropout_p=drop, is_causal=True)
        elif T == 1:                               # sinh từng token: được nhìn mọi token trước
            y = F.scaled_dot_product_attention(q, k, v, dropout_p=drop)
        else:                                      # nhiều token mới + quá khứ: che lệch
            mask = torch.ones(T, S, dtype=torch.bool, device=x.device).tril(diagonal=S - T)
            y = F.scaled_dot_product_attention(q, k, v, attn_mask=mask, dropout_p=drop)
        y = y.transpose(1, 2).contiguous().view(B, T, C)
        return self.resid_drop(self.proj(y)), (k, v)


class MLP(nn.Module):
    def __init__(self, c: GPTConfig):
        super().__init__()
        self.fc = nn.Linear(c.n_embd, 4 * c.n_embd, bias=c.bias)
        self.proj = nn.Linear(4 * c.n_embd, c.n_embd, bias=c.bias)
        self.drop = nn.Dropout(c.dropout)

    def forward(self, x):
        return self.drop(self.proj(F.gelu(self.fc(x))))


class Block(nn.Module):
    def __init__(self, c: GPTConfig):
        super().__init__()
        self.ln1 = nn.LayerNorm(c.n_embd, bias=c.bias)
        self.attn = CausalSelfAttention(c)
        self.ln2 = nn.LayerNorm(c.n_embd, bias=c.bias)
        self.mlp = MLP(c)

    def forward(self, x, cache=None):
        a, cache = self.attn(self.ln1(x), cache)
        x = x + a
        x = x + self.mlp(self.ln2(x))
        return x, cache


class GPT(nn.Module):
    def __init__(self, c: GPTConfig):
        super().__init__()
        self.config = c
        self.wte = nn.Embedding(c.vocab_size, c.n_embd)       # nhúng token
        self.wpe = nn.Embedding(c.block_size, c.n_embd)       # nhúng vị trí
        self.drop = nn.Dropout(c.dropout)
        self.blocks = nn.ModuleList([Block(c) for _ in range(c.n_layer)])
        self.ln_f = nn.LayerNorm(c.n_embd, bias=c.bias)
        self.lm_head = nn.Linear(c.n_embd, c.vocab_size, bias=False)
        self.lm_head.weight = self.wte.weight                 # dùng chung trọng số (như GPT-2)
        self.apply(self._init)
        for name, p in self.named_parameters():               # khởi tạo nhỏ cho nhánh dư (GPT-2)
            if name.endswith("proj.weight"):
                nn.init.normal_(p, 0.0, 0.02 / math.sqrt(2 * c.n_layer))

    @staticmethod
    def _init(m):
        if isinstance(m, nn.Linear):
            nn.init.normal_(m.weight, 0.0, 0.02)
            if m.bias is not None:
                nn.init.zeros_(m.bias)
        elif isinstance(m, nn.Embedding):
            nn.init.normal_(m.weight, 0.0, 0.02)

    def num_params(self, non_embedding=True):
        n = sum(p.numel() for p in self.parameters())
        return n - self.wpe.weight.numel() if non_embedding else n

    def forward(self, idx, targets=None, caches=None, pos=0):
        """idx: (B, T) token. targets: (B, T) token đích, -100 = bỏ qua. caches: list bộ nhớ đệm mỗi khối.
        Trả về (logits, loss, caches_mới)."""
        B, T = idx.shape
        assert pos + T <= self.config.block_size, f"vượt ngữ cảnh {self.config.block_size} token"
        p = torch.arange(pos, pos + T, device=idx.device)
        x = self.drop(self.wte(idx) + self.wpe(p))
        new = []
        for i, blk in enumerate(self.blocks):
            x, c = blk(x, caches[i] if caches else None)
            new.append(c)
        x = self.ln_f(x)
        if targets is not None:
            logits = self.lm_head(x)
            loss = F.cross_entropy(logits.view(-1, logits.size(-1)).float(), targets.reshape(-1), ignore_index=-100)
            return logits, loss, new
        return self.lm_head(x[:, -1:, :]), None, new   # suy luận: chỉ cần token cuối

    def configure_optimizer(self, weight_decay, lr, betas=(0.9, 0.95), device_type="cpu"):
        decay = [p for p in self.parameters() if p.requires_grad and p.dim() >= 2]
        no_decay = [p for p in self.parameters() if p.requires_grad and p.dim() < 2]
        groups = [{"params": decay, "weight_decay": weight_decay}, {"params": no_decay, "weight_decay": 0.0}]
        extra = {"fused": True} if device_type == "cuda" else {}
        return torch.optim.AdamW(groups, lr=lr, betas=betas, **extra)

    @torch.no_grad()
    def generate(self, ids, max_new_tokens=200, temperature=0.8, top_k=50, top_p=0.95,
                 repetition_penalty=1.1, stop_ids=()):
        """Sinh từng token (generator). ids: list token mở đầu. Dừng khi gặp token trong stop_ids."""
        self.eval()
        dev = next(self.parameters()).device
        bs = self.config.block_size
        hist = list(ids)[-(bs - 1):] or [0]
        caches, pos = None, 0
        x = torch.tensor([hist], device=dev)
        for _ in range(max_new_tokens):
            logits, _, caches = self(x, caches=caches, pos=pos)
            pos += x.size(1)
            logits = logits[0, -1].float()
            if repetition_penalty != 1.0:                         # bớt lặp lại token vừa dùng
                recent = torch.tensor(sorted(set(hist[-64:])), device=dev)
                sel = logits[recent]
                logits[recent] = torch.where(sel > 0, sel / repetition_penalty, sel * repetition_penalty)
            if temperature <= 0:
                nxt = int(torch.argmax(logits))
            else:
                logits = logits / temperature
                if top_k:
                    kth = torch.topk(logits, min(top_k, logits.numel())).values[-1]
                    logits[logits < kth] = -float("inf")
                probs = F.softmax(logits, dim=-1)
                if top_p and top_p < 1.0:                          # lấy mẫu nhân (nucleus)
                    sp, si = torch.sort(probs, descending=True)
                    cut = torch.cumsum(sp, 0) - sp > top_p
                    sp[cut] = 0
                    probs = torch.zeros_like(probs).scatter_(0, si, sp)
                nxt = int(torch.multinomial(probs / probs.sum(), 1))
            if nxt in stop_ids:
                return
            yield nxt
            hist.append(nxt)
            if pos >= bs:                                          # hết ngữ cảnh: trượt cửa sổ, tính lại
                hist = hist[-(bs * 3 // 4):]
                caches, pos = None, 0
                x = torch.tensor([hist], device=dev)
            else:
                x = torch.tensor([[nxt]], device=dev)


def load_checkpoint(path, device="cpu"):
    ck = torch.load(path, map_location=device, weights_only=False)
    model = GPT(GPTConfig(**ck["config"]))
    model.load_state_dict(ck["model"])
    return model.to(device).eval(), ck
