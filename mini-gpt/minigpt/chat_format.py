"""Khung hội thoại cho bản chat (giống cách ChatGPT đánh dấu vai):

    <|system|>Bạn là Mây…<|end|><|user|>Xin chào<|end|><|assistant|>Chào bạn!<|end|>

Khi dạy hội thoại (SFT), mô hình chỉ bị chấm điểm ở phần lời của trợ lý (kể cả <|end|> để biết lúc dừng).
"""
DEFAULT_SYSTEM = "Bạn là Mây, trợ lý AI tiếng Việt thân thiện, trả lời ngắn gọn, đúng trọng tâm."


def render(tok, messages, system=DEFAULT_SYSTEM, add_generation_prompt=False):
    """→ (ids, mask): mask[i] = True nếu token i là lời trợ lý cần học."""
    msgs = list(messages)
    if not msgs or msgs[0]["role"] != "system":
        msgs = [{"role": "system", "content": system}] + msgs
    role_tok = {"system": tok.system, "user": tok.user, "assistant": tok.assistant}
    ids, mask = [], []
    for m in msgs:
        body = tok.encode(m["content"].strip(), allow_special=False) + [tok.end]
        ids.append(role_tok[m["role"]])
        mask.append(False)
        ids += body
        mask += [m["role"] == "assistant"] * len(body)
    if add_generation_prompt:
        ids.append(tok.assistant)
        mask.append(False)
    return ids, mask


def to_example(ids, mask, block_size):
    """Cắt (giữ phần cuối) và tạo cặp đầu vào/đích cho SFT; đích = -100 ở chỗ không cần học."""
    ids, mask = ids[-(block_size + 1):], mask[-(block_size + 1):]
    x = ids[:-1]
    y = [ids[i + 1] if mask[i + 1] else -100 for i in range(len(ids) - 1)]
    return x, y
