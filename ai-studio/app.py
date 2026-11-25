"""AI Studio — trò chuyện, tạo ảnh, dựng video bằng mô hình mã nguồn mở, chạy trên máy/GPU của bạn.

    python app.py              # chạy thật (cần GPU NVIDIA cho ảnh/video)
    python app.py --share      # có link công khai (dùng trên Colab)
    python app.py --demo       # thử giao diện, không nạp mô hình
"""
import argparse
import json
import os
import sys
import traceback

import gradio as gr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from studio.config import IMAGE_MODELS, STYLES, SYSTEM_PROMPT, VIDEO_MODELS, detect_media, normalize_vi  # noqa: E402
from studio.memory import HOME, Memory, Notes  # noqa: E402
from studio.thinking import creative, extract_memories, wants_memory  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--share", action="store_true", help="tạo link công khai *.gradio.live")
ap.add_argument("--demo", action="store_true", help="giả lập, không nạp mô hình")
ap.add_argument("--port", type=int, default=7860)
args = ap.parse_args()

if args.demo:
    from studio.demo import DemoStudio as Studio
    image_loras = lambda: {}  # noqa: E731
else:
    from studio.engines import Studio, image_loras
studio = Studio()
memory, notes = Memory(), Notes()
BRAINS = {"Qwen/Qwen3-8B": "Qwen3 8B — nhanh, cân bằng (≥ 8 GB VRAM)",
          "Qwen/Qwen3-14B": "Qwen3 14B — sáng tạo & lập luận tốt hơn, chậm hơn (≥ 12 GB VRAM)",
          "Qwen/Qwen3-4B": "Qwen3 4B — nhẹ (≥ 5 GB VRAM)"}
MODES = ["💬 Bình thường", "🧠 Suy nghĩ sâu", "💡 Sáng tạo"]

STYLE_NAMES = list(STYLES)
IMG_CHOICES = [(v[0], k) for k, v in IMAGE_MODELS.items()]
VID_CHOICES = [(v[0], k) for k, v in VIDEO_MODELS.items()]


def err(e):
    traceback.print_exc()
    msg = str(e)
    if "out of memory" in msg.lower():
        msg += "\n→ Hết VRAM. Thử: bấm 'Giải phóng bộ nhớ' ở tab Hệ thống, chọn chế độ ảnh 'Nhanh', hoặc video ngắn hơn."
    return f"⚠️ Lỗi: {msg}"


def _is_plain(m):
    return isinstance(m.get("content"), str) and not (m.get("metadata") or {}).get("title")


# ---------------- chat ----------------
def system_for(msg):
    """Lời nhắc hệ thống = tính cách Mây + trí nhớ về người dùng + đoạn tài liệu riêng liên quan."""
    return {"role": "system", "content": SYSTEM_PROMPT + memory.as_prompt() + notes.as_prompt(msg)}


def remember_from(msg):
    """Tự rút điều đáng nhớ từ câu của người dùng. Trả về danh sách điều mới ghi."""
    if not wants_memory(normalize_vi(msg)):
        return []
    saved = []
    for m in extract_memories(studio, msg):
        if memory.add(m):
            saved.append(m)
    return saved


def respond(msg, history, mode, style):
    msg = (msg or "").strip()
    if not msg:
        yield "", history
        return
    history = list(history or []) + [{"role": "user", "content": msg}]
    yield "", history
    try:
        media = detect_media(msg)
        if media:
            kind, desc = media
            history.append({"role": "assistant", "content": "✍️ Mình đang viết prompt…"})
            yield "", history
            prompt = studio.write_prompt(desc or msg, kind, style)
            history[-1] = {"role": "assistant", "content": f"{'🎨 Đang vẽ' if kind == 'image' else '🎬 Đang dựng video (vài phút)'}…\n\nPrompt: *{prompt}*"}
            yield "", history
            if kind == "image":
                paths, seed = studio.image(prompt, kind="quality", style=style)
                history[-1] = {"role": "assistant", "content": f"Xong! (seed {seed})\n\nPrompt: *{prompt}*"}
                history += [{"role": "assistant", "content": gr.Image(p)} for p in paths]
            else:
                path, seed = studio.video(prompt, kind="wan", seconds=3)
                history[-1] = {"role": "assistant", "content": f"Xong! (seed {seed})\n\nPrompt: *{prompt}*"}
                history.append({"role": "assistant", "content": gr.Video(path)})
            yield "", history
            return

        ctx = [m for m in history if _is_plain(m)][-20:]
        msgs = [system_for(msg)] + [{"role": m["role"], "content": m["content"]} for m in ctx]
        base = history
        if mode == MODES[2]:  # sáng tạo nhiều bước
            titles = {"ideas": "💡 Nghĩ rộng: các hướng", "critique": "🧐 Tự phản biện"}
            shown = {}
            for stage, text, done in creative(studio, msg, msgs):
                if stage in titles:
                    shown[stage] = {"role": "assistant", "content": text or "…",
                                    "metadata": {"title": titles[stage] + ("" if done else "…")}}
                    yield "", base + list(shown.values())
                else:
                    yield "", base + list(shown.values()) + [{"role": "assistant", "content": text or "✍️ Đang kết hợp ý tưởng…"}]
            history = base + list(shown.values()) + [{"role": "assistant", "content": text}]
        else:
            think = mode == MODES[1]
            items = []
            for thought, answer in studio.chat_stream(msgs, think=think):
                items = []
                if think and thought:
                    items.append({"role": "assistant", "content": thought,
                                  "metadata": {"title": "🧠 Suy nghĩ" + (" — xong" if answer else "…")}})
                items.append({"role": "assistant", "content": answer or ("…" if not items else "")})
                yield "", base + [i for i in items if i["content"]]
            history = base + [i for i in items if i["content"]]
        saved = remember_from(msg)
        if saved:
            history = history + [{"role": "assistant", "content": "\n".join(f"- {m}" for m in saved),
                                  "metadata": {"title": "📝 Mây đã ghi nhớ"}}]
            yield "", history
    except Exception as e:  # noqa: BLE001
        history.append({"role": "assistant", "content": err(e)})
        yield "", history


def on_like(history, data: gr.LikeData):
    """👍/👎 → lưu cặp hội thoại vào dữ liệu huấn luyện (userdata/feedback_*.jsonl)."""
    idx = data.index if isinstance(data.index, int) else data.index[0]
    upto = [m for m in history[: idx + 1] if _is_plain(m)]
    if not upto or upto[-1]["role"] != "assistant":
        return
    conv = [{"role": m["role"], "content": m["content"]} for m in upto[-8:]]
    while conv and conv[0]["role"] != "user":
        conv.pop(0)
    HOME.mkdir(parents=True, exist_ok=True)
    with open(HOME / ("feedback_good.jsonl" if data.liked else "feedback_bad.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"messages": conv}, ensure_ascii=False) + "\n")
    gr.Info("Đã lưu để Mây học" if data.liked else "Đã ghi nhận, Mây sẽ tránh kiểu trả lời này")


# ---------------- ảnh ----------------
def gen_image(desc, use_llm, style, kind, size, n, seed, lora, lora_scale, negative):
    if not (desc or "").strip():
        raise gr.Error("Hãy nhập mô tả ảnh.")
    try:
        prompt = studio.write_prompt(desc, "image", style) if use_llm else ", ".join(x for x in [desc, STYLES[style][0]] if x)
        w, h = {"Vuông 1:1": (1024, 1024), "Ngang 16:9": (1344, 768), "Dọc 9:16": (768, 1344), "Ngang 4:3": (1152, 896)}[size]
        paths, used = studio.image(prompt, negative, kind, w, h, n, seed, lora or None, lora_scale, style)
        return paths, f"**Prompt:** {prompt}\n\n**Seed:** {used} (nhập lại seed này để tạo lại đúng ảnh)"
    except Exception as e:  # noqa: BLE001
        raise gr.Error(err(e))


# ---------------- video ----------------
def gen_video(desc, use_llm, style, kind, seconds, image, seed):
    if not (desc or "").strip():
        raise gr.Error("Hãy nhập mô tả video.")
    try:
        prompt = studio.write_prompt(desc, "video", style) if use_llm else ", ".join(x for x in [desc, STYLES[style][0]] if x)
        path, used = studio.video(prompt, kind, seconds, image, seed)
        return path, f"**Prompt:** {prompt}\n\n**Seed:** {used}" + ("\n\n(Ảnh đầu → video bằng LTX-Video)" if image else "")
    except Exception as e:  # noqa: BLE001
        raise gr.Error(err(e))


# ---------------- API cho app Android ----------------
def api_chat(message, history_json, think):
    """Chat không stream cho app điện thoại. history_json: [{"role","content"}…]"""
    try:
        hist = [m for m in json.loads(history_json or "[]") if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)]
    except ValueError:
        hist = []
    msgs = [system_for(str(message))] + hist[-20:] + [{"role": "user", "content": str(message)}]
    answer = ""
    try:
        for _, answer in studio.chat_stream(msgs, think=bool(think)):
            pass
    except Exception as e:  # noqa: BLE001
        return err(e)
    try:
        remember_from(str(message))
    except Exception:  # noqa: BLE001
        pass
    return answer


def _msg(e):
    return getattr(e, "message", None) or str(e)


def api_image(*a):
    try:
        return gen_image(*a)
    except Exception as e:  # noqa: BLE001
        return [], _msg(e) if _msg(e).startswith("⚠️") else f"⚠️ Lỗi: {_msg(e)}"


def api_video(*a):
    try:
        return gen_video(*a)
    except Exception as e:  # noqa: BLE001
        return None, _msg(e) if _msg(e).startswith("⚠️") else f"⚠️ Lỗi: {_msg(e)}"


def unload():
    studio.unload()
    return studio.status()


CSS = """
.gradio-container {max-width: 1100px !important}
#title h1 {margin-bottom: 0}
"""

with gr.Blocks(title="AI Studio — Mây", css=CSS, theme=gr.themes.Soft(primary_hue="violet")) as ui:
    gr.Markdown("# Mây AI Studio\nTrò chuyện · Tạo ảnh · Dựng video — mô hình mã nguồn mở chạy trên GPU của bạn.", elem_id="title")
    with gr.Tab("💬 Trò chuyện"):
        chat = gr.Chatbot(type="messages", height=520, show_copy_button=True, label="Mây",
                          placeholder="Hỏi Mây bất cứ điều gì. Muốn vẽ: *“vẽ một ngôi nhà ma trong sương mù”*. Muốn video: *“làm video con mèo chạy trên bãi biển”*.")
        with gr.Row():
            box = gr.Textbox(placeholder="Nhắn cho Mây…", show_label=False, scale=6, autofocus=True)
            send = gr.Button("Gửi", variant="primary", scale=1)
        with gr.Row():
            think = gr.Radio(MODES, value=MODES[0], label="Cách Mây suy nghĩ", info="Suy nghĩ sâu: toán, lập luận. Sáng tạo: ý tưởng, kịch bản, kế hoạch (nghĩ nhiều hướng → tự phản biện → kết hợp).")
            chat_style = gr.Dropdown(STYLE_NAMES, value="Không", label="Phong cách khi vẽ/làm video từ chat")
            gr.ClearButton([chat, box], value="Cuộc trò chuyện mới")
        chat.like(on_like, [chat], None)
        gr.Examples(["Mình tên Khoa, đang làm game kinh dị và kênh video Muro Var", "Nghĩ cho mình ý tưởng video kinh dị 60 giây thật mới lạ",
                     "Giải thích vì sao bầu trời màu xanh", "Mình có 5 cái kẹo, cho bạn 2 cái, mẹ cho thêm gấp đôi số còn lại. Mình có mấy cái?",
                     "Viết mở đầu một truyện kinh dị về bóng đen trong hành lang", "Vẽ nhân vật hiệp sĩ low-poly cho game",
                     "Làm video bóng đen đứng cuối hành lang tối, đèn chập chờn"], box)
        send.click(respond, [box, chat, think, chat_style], [box, chat], api_name=False)
        box.submit(respond, [box, chat, think, chat_style], [box, chat], api_name=False)

    with gr.Tab("🎨 Tạo ảnh"):
        with gr.Row():
            with gr.Column(scale=2):
                idesc = gr.Textbox(label="Mô tả (tiếng Việt được)", lines=3, placeholder="Một ngôi làng cổ lúc nửa đêm, có bóng đen đứng dưới gốc đa")
                iuse = gr.Checkbox(label="Để Mây viết prompt tiếng Anh chi tiết (khuyên dùng)", value=True)
                with gr.Row():
                    istyle = gr.Dropdown(STYLE_NAMES, value="Không", label="Phong cách")
                    ikind = gr.Dropdown(IMG_CHOICES, value="quality", label="Chất lượng / mô hình")
                with gr.Row():
                    isize = gr.Radio(["Vuông 1:1", "Ngang 16:9", "Dọc 9:16", "Ngang 4:3"], value="Vuông 1:1", label="Khung")
                    inum = gr.Slider(1, 4, value=1, step=1, label="Số ảnh")
                with gr.Accordion("Nâng cao", open=False):
                    iseed = gr.Number(-1, label="Seed (-1 = ngẫu nhiên)", precision=0)
                    ineg = gr.Textbox(label="Không muốn có (negative, tiếng Anh)")
                    with gr.Row():
                        ilora = gr.Dropdown([""] + list(image_loras()), value="", label="LoRA phong cách đã huấn luyện")
                        iscale = gr.Slider(0, 1.5, value=0.8, step=0.05, label="Độ mạnh LoRA")
                ibtn = gr.Button("Tạo ảnh", variant="primary")
            with gr.Column(scale=3):
                igal = gr.Gallery(label="Kết quả", columns=2, height=520, type="filepath")
                iinfo = gr.Markdown()
        ibtn.click(gen_image, [idesc, iuse, istyle, ikind, isize, inum, iseed, ilora, iscale, ineg], [igal, iinfo], api_name=False)

    with gr.Tab("🎬 Dựng video"):
        with gr.Row():
            with gr.Column(scale=2):
                vdesc = gr.Textbox(label="Mô tả (tiếng Việt được)", lines=3, placeholder="Bóng đen chậm rãi bước ra từ cuối hành lang, đèn trần chập chờn, máy quay tiến chậm")
                vuse = gr.Checkbox(label="Để Mây viết prompt tiếng Anh chi tiết (khuyên dùng)", value=True)
                with gr.Row():
                    vstyle = gr.Dropdown(STYLE_NAMES, value="Không", label="Phong cách")
                    vkind = gr.Dropdown(VID_CHOICES, value="wan", label="Mô hình")
                vsec = gr.Slider(2, 5, value=3, step=1, label="Độ dài (giây)")
                vimg = gr.Image(type="filepath", label="Ảnh đầu (tùy chọn) — có ảnh thì làm ảnh → video", height=200)
                vseed = gr.Number(-1, label="Seed (-1 = ngẫu nhiên)", precision=0)
                vbtn = gr.Button("Dựng video", variant="primary")
                gr.Markdown("Mẹo: tạo ảnh đẹp ở tab **Tạo ảnh** (có thể dùng LoRA phong cách của bạn), kéo vào **Ảnh đầu** để video giữ đúng nhân vật/phong cách. GPU T4 mất khoảng 3–10 phút cho mỗi clip.")
            with gr.Column(scale=3):
                vout = gr.Video(label="Kết quả", height=420)
                vinfo = gr.Markdown()
        vbtn.click(gen_video, [vdesc, vuse, vstyle, vkind, vsec, vimg, vseed], [vout, vinfo], api_name=False)

    with gr.Tab("🧠 Mây của bạn"):
        gr.Markdown("Mọi thứ ở đây lưu trong thư mục `userdata/` trên máy bạn: thuộc về bạn, sửa/xóa/chép đi được.")
        with gr.Row():
            with gr.Column():
                gr.Markdown("### 📝 Trí nhớ về bạn\nMây tự ghi khi bạn kể về bản thân (hoặc nói *“hãy nhớ rằng…”*). Dùng trong mọi cuộc trò chuyện.")
                mem_box = gr.CheckboxGroup(label="Điều Mây đang nhớ (tích để xóa)")
                with gr.Row():
                    mem_new = gr.Textbox(placeholder="Thêm tay, vd: Mình thích phong cách kể chuyện chậm, ám ảnh", show_label=False, scale=4)
                    mem_add = gr.Button("Thêm", scale=1)
                mem_del = gr.Button("Xóa mục đã tích", variant="stop")
            with gr.Column():
                gr.Markdown("### 📚 Kiến thức riêng\nNạp ghi chú, kịch bản, kế hoạch (.txt .md .pdf .docx). Mây tra cứu khi trả lời.")
                note_files = gr.File(file_count="multiple", file_types=[".txt", ".md", ".pdf", ".docx"], label="Nạp tài liệu")
                note_list = gr.Markdown()
                with gr.Row():
                    note_pick = gr.Dropdown(label="Tài liệu", choices=[], scale=3)
                    note_del = gr.Button("Gỡ", scale=1)
        with gr.Row():
            with gr.Column():
                gr.Markdown("### 🧩 Bộ não")
                brain = gr.Dropdown([(v, k) for k, v in BRAINS.items()], value=studio.chat_id if studio.chat_id in BRAINS else None,
                                    label="Mô hình chat", allow_custom_value=True)
                brain_info = gr.Markdown()
            with gr.Column():
                gr.Markdown("### 📈 Mây học từ bạn")
                learn_info = gr.Markdown()

        def mem_view():
            return gr.CheckboxGroup(choices=[(f"{m['text']}  ·  {m['created']}", m["id"]) for m in memory.items], value=[])

        def notes_view():
            src = notes.sources()
            md = "\n".join(f"- **{n}** · {c} đoạn" for n, c in src) or "_Chưa có tài liệu nào._"
            return md, gr.Dropdown(choices=[n for n, _ in src], value=None)

        def learn_view():
            def count(name):
                f = HOME / name
                return sum(1 for _ in open(f, encoding="utf-8")) if f.exists() else 0
            good, bad = count("feedback_good.jsonl"), count("feedback_bad.jsonl")
            return (f"👍 **{good}** câu trả lời tốt · 👎 **{bad}** câu chưa tốt (bấm 👍/👎 dưới câu trả lời trong chat).\n\n"
                    + ("Khi có khoảng **50+ 👍**, huấn luyện để Mây nói chuyện đúng kiểu bạn thích:\n"
                       "```\npython train/train_chat_lora.py --data data/chat_vi.jsonl userdata/feedback_good.jsonl --epochs 2\n```\n"
                       "rồi khởi động lại app. (Colab: ô *Huấn luyện A* trong sổ tay.)"))

        def add_mem(t):
            if (t or "").strip():
                memory.add(t)
            return mem_view(), ""

        def del_mem(ids):
            memory.remove(ids or [])
            return mem_view()

        def add_notes(files):
            for f in files or []:
                path = f if isinstance(f, str) else f.name
                notes.add_file(path, os.path.basename(path))
            return (*notes_view(), None)

        def del_note(name):
            if name:
                notes.remove(name)
            return notes_view()

        def set_brain(mid):
            if mid and mid != studio.chat_id:
                studio.unload(("chat",))
                studio.chat_id = mid
                return f"Đã chọn **{mid}**. Lần nhắn tiếp theo sẽ nạp mô hình này (lần đầu phải tải về, vài phút)."
            return f"Đang dùng **{studio.chat_id}**."

        mem_add.click(add_mem, mem_new, [mem_box, mem_new])
        mem_new.submit(add_mem, mem_new, [mem_box, mem_new])
        mem_del.click(del_mem, mem_box, mem_box)
        note_files.upload(add_notes, note_files, [note_list, note_pick, note_files])
        note_del.click(del_note, note_pick, [note_list, note_pick])
        brain.change(set_brain, brain, brain_info)
        ui.load(lambda: (mem_view(), *notes_view(), learn_view(), set_brain(None)), None, [mem_box, note_list, note_pick, learn_info, brain_info])
        chat.like(lambda: (mem_view(), learn_view()), None, [mem_box, learn_info])

    with gr.Tab("⚙️ Hệ thống"):
        stat = gr.Markdown(studio.status())
        with gr.Row():
            gr.Button("Làm mới").click(lambda: studio.status(), None, stat)
            gr.Button("Giải phóng bộ nhớ GPU").click(unload, None, stat)
        with gr.Row(visible=False):  # điểm gọi API cho app Android
            a_msg, a_hist, a_think, a_out = gr.Textbox(), gr.Textbox(), gr.Checkbox(), gr.Textbox()
            gr.Button().click(api_chat, [a_msg, a_hist, a_think], a_out, api_name="chat_api")
            gr.Button().click(api_image, [idesc, iuse, istyle, ikind, isize, inum, iseed, ilora, iscale, ineg], [igal, iinfo], api_name="tao_anh")
            gr.Button().click(api_video, [vdesc, vuse, vstyle, vkind, vsec, vimg, vseed], [vout, vinfo], api_name="dung_video")
        gr.Markdown("Huấn luyện thêm (LoRA): xem `ai-studio/README.md`, mục **Huấn luyện**. LoRA ảnh đặt trong `loras/<tên>/`, LoRA chat ở `loras/chat-may/` — khởi động lại app để nhận.")

if __name__ == "__main__":
    ui.queue(default_concurrency_limit=1).launch(share=args.share, server_name="0.0.0.0", server_port=args.port, show_error=True)
