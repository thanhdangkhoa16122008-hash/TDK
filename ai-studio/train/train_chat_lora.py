"""Tinh chỉnh mô hình chat (QLoRA) bằng dữ liệu hội thoại của bạn → loras/chat-may/

    python train/train_chat_lora.py                         # dùng data/chat_vi.jsonl, mô hình tự chọn theo VRAM
    python train/train_chat_lora.py --data data/my.jsonl --epochs 3 --model Qwen/Qwen3-4B

Dữ liệu: mỗi dòng 1 JSON {"messages": [{"role": "system"|"user"|"assistant", "content": "..."} ...]}.
Mỗi lượt "assistant" là 1 mẫu học (mô hình học cách trả lời như vậy, phần trước chỉ là ngữ cảnh).
Cần GPU NVIDIA (Colab T4 được). 300–1000 hội thoại chất lượng tốt hơn nhiều so với hàng vạn câu kém.
"""
import argparse
import json
import os
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio.config import SYSTEM_PROMPT, pick_chat_model  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--data", default="data/chat_vi.jsonl")
ap.add_argument("--out", default="loras/chat-may")
ap.add_argument("--model", default=None)
ap.add_argument("--epochs", type=float, default=3)
ap.add_argument("--lr", type=float, default=2e-4)
ap.add_argument("--rank", type=int, default=16)
ap.add_argument("--max-len", type=int, default=1024)
ap.add_argument("--batch", type=int, default=1)
ap.add_argument("--accum", type=int, default=8)
args = ap.parse_args()

if not torch.cuda.is_available():
    sys.exit("Cần GPU NVIDIA để huấn luyện (Colab: Runtime → Change runtime type → T4 GPU).")

from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training  # noqa: E402
from transformers import (AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig,  # noqa: E402
                          DataCollatorForSeq2Seq, Trainer, TrainingArguments)

vram = torch.cuda.get_device_properties(0).total_memory / 2**30
model_id = args.model or pick_chat_model(vram)
bf16 = torch.cuda.is_bf16_supported()
dtype = torch.bfloat16 if bf16 else torch.float16
print(f"Mô hình gốc: {model_id} · GPU {vram:.0f} GB · {'bf16' if bf16 else 'fp16'}")

tok = AutoTokenizer.from_pretrained(model_id)
if tok.pad_token is None:
    tok.pad_token = tok.eos_token
END = "<|im_end|>" if "<|im_end|>" in tok.get_vocab() else (tok.eos_token or "")


def samples(conv):
    """1 hội thoại → nhiều mẫu: (ngữ cảnh đã định dạng, câu trả lời cần học)."""
    msgs = conv["messages"]
    if msgs[0]["role"] != "system":
        msgs = [{"role": "system", "content": SYSTEM_PROMPT}] + msgs
    for i, m in enumerate(msgs):
        if m["role"] == "assistant" and i > 0:
            # cùng mẫu định dạng với lúc chạy app (enable_thinking=False)
            prompt = tok.apply_chat_template(msgs[:i], tokenize=False, add_generation_prompt=True, enable_thinking=False)
            yield prompt, m["content"].strip() + END


def encode(prompt, target):
    p = tok(prompt, add_special_tokens=False)["input_ids"]
    t = tok(target, add_special_tokens=False)["input_ids"]
    p = p[-max(16, args.max_len - len(t)):]           # cắt bớt ngữ cảnh cũ nếu quá dài
    ids = (p + t)[: args.max_len]
    labels = ([-100] * len(p) + t)[: args.max_len]    # chỉ tính lỗi trên câu trả lời
    return {"input_ids": ids, "attention_mask": [1] * len(ids), "labels": labels}


rows = [json.loads(l) for l in Path(args.data).read_text(encoding="utf-8").splitlines() if l.strip()]
data = [encode(p, t) for r in rows for p, t in samples(r)]
print(f"{len(rows)} hội thoại → {len(data)} mẫu học")


class DS(torch.utils.data.Dataset):
    def __len__(self):
        return len(data)

    def __getitem__(self, i):
        return data[i]


q = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=dtype, bnb_4bit_use_double_quant=True)
model = AutoModelForCausalLM.from_pretrained(model_id, quantization_config=q, device_map="auto", torch_dtype=dtype)
model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
model = get_peft_model(model, LoraConfig(
    r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]))
model.print_trainable_parameters()

trainer = Trainer(
    model=model,
    train_dataset=DS(),
    data_collator=DataCollatorForSeq2Seq(tok, padding=True, label_pad_token_id=-100),
    args=TrainingArguments(
        output_dir=args.out + "-ckpt", num_train_epochs=args.epochs, learning_rate=args.lr,
        per_device_train_batch_size=args.batch, gradient_accumulation_steps=args.accum,
        lr_scheduler_type="cosine", warmup_ratio=0.05, logging_steps=5, save_strategy="no",
        bf16=bf16, fp16=not bf16, optim="paged_adamw_8bit", gradient_checkpointing=True,
        report_to="none", remove_unused_columns=False),
)
trainer.train()
os.makedirs(args.out, exist_ok=True)
model.save_pretrained(args.out)
tok.save_pretrained(args.out)
print(f"✓ Đã lưu LoRA chat vào {args.out}. Khởi động lại app.py để dùng.")
