"""Các "bộ não" của AI Studio: chat (Qwen3), ảnh (SDXL / FLUX), video (Wan 2.1 / LTX-Video).

Quản lý bộ nhớ GPU: nạp mô hình khi cần; GPU nhỏ thì tự giải phóng mô hình khác trước khi nạp
mô hình nặng (video), nên một GPU 16 GB (Colab T4) vẫn chạy được cả ba — đổi qua lại sẽ mất
thời gian nạp lại (30–90 giây).
"""
import gc
import os
import threading
import time
from pathlib import Path

import torch

from .config import (BASE_NEGATIVE, CHAT_ADAPTER, PROMPT_WRITER, STYLES, VIDEO_NEGATIVE,
                     pick_chat_model, split_think)

OUT = Path(os.environ.get("STUDIO_OUT", "outputs"))
LORA_DIR = Path(os.environ.get("STUDIO_LORAS", "loras"))
CUDA = torch.cuda.is_available()
VRAM = torch.cuda.get_device_properties(0).total_memory / 2**30 if CUDA else 0.0
DTYPE = (torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16) if CUDA else torch.float32


def _stamp(ext):
    OUT.mkdir(parents=True, exist_ok=True)
    return str(OUT / f"{time.strftime('%Y%m%d-%H%M%S')}-{int(time.time() * 1000) % 1000:03d}.{ext}")


def image_loras():
    """LoRA ảnh đã huấn luyện: loras/<tên>/pytorch_lora_weights.safetensors hoặc loras/<tên>.safetensors."""
    found = {}
    if LORA_DIR.exists():
        for p in sorted(LORA_DIR.glob("*/pytorch_lora_weights.safetensors")):
            found[p.parent.name] = str(p)
        for p in sorted(LORA_DIR.glob("*.safetensors")):
            found[p.stem] = str(p)
    return found


class Studio:
    def __init__(self):
        self.chat_id = pick_chat_model(VRAM)
        self.tok = self.llm = None
        self.img = self.img_kind = self.img_lora = None
        self.vid = self.vid_kind = None
        self.lock = threading.Lock()

    # ---------- bộ nhớ ----------
    def _gc(self):
        gc.collect()
        if CUDA:
            torch.cuda.empty_cache()

    def unload(self, what=("chat", "image", "video")):
        if "chat" in what and self.llm is not None:
            self.llm = self.tok = None
        if "image" in what and self.img is not None:
            self.img = self.img_kind = self.img_lora = None
        if "video" in what and self.vid is not None:
            self.vid = self.vid_kind = None
        self._gc()

    def status(self):
        gpu = f"{torch.cuda.get_device_name(0)} · {VRAM:.1f} GB VRAM" if CUDA else "Không có GPU (chạy CPU — chỉ chat được, rất chậm)"
        used = f" · đang dùng {torch.cuda.memory_allocated() / 2**30:.1f} GB" if CUDA else ""
        loaded = [n for n, m in [(f"chat: {self.chat_id}", self.llm), (f"ảnh: {self.img_kind}", self.img), (f"video: {self.vid_kind}", self.vid)] if m is not None]
        return f"**GPU:** {gpu}{used}\n\n**Đang nạp:** {', '.join(loaded) or 'chưa có'}\n\n**LoRA ảnh:** {', '.join(image_loras()) or 'chưa có'}" \
               f"\n\n**LoRA chat:** {CHAT_ADAPTER if Path(CHAT_ADAPTER, 'adapter_config.json').exists() else 'chưa có'}"

    # ---------- chat ----------
    def _load_chat(self):
        if self.llm is not None:
            return
        if VRAM < 16:
            self.unload(("video",))
        from transformers import AutoModelForCausalLM, AutoTokenizer
        self.tok = AutoTokenizer.from_pretrained(self.chat_id)
        if CUDA:
            from transformers import BitsAndBytesConfig
            q = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                   bnb_4bit_compute_dtype=DTYPE, bnb_4bit_use_double_quant=True)
            model = AutoModelForCausalLM.from_pretrained(self.chat_id, device_map="auto", quantization_config=q, torch_dtype=DTYPE)
        else:
            model = AutoModelForCausalLM.from_pretrained(self.chat_id, torch_dtype=torch.float32)
        if Path(CHAT_ADAPTER, "adapter_config.json").exists():
            from peft import PeftModel
            model = PeftModel.from_pretrained(model, CHAT_ADAPTER)
        self.llm = model.eval()

    def chat_stream(self, messages, think=False, max_new_tokens=None):
        """messages: [{'role','content'}]. Sinh từng phần: (suy_nghĩ, trả_lời)."""
        from transformers import TextIteratorStreamer
        with self.lock:
            self._load_chat()
            text = self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=think)
            inputs = self.tok(text, return_tensors="pt").to(self.llm.device)
            streamer = TextIteratorStreamer(self.tok, skip_prompt=True, skip_special_tokens=False, timeout=600)
            gen = dict(**inputs, streamer=streamer, max_new_tokens=max_new_tokens or (4096 if think else 1024),
                       do_sample=True, top_k=20, temperature=0.6 if think else 0.7, top_p=0.95 if think else 0.8,
                       repetition_penalty=1.05)
            th = threading.Thread(target=self.llm.generate, kwargs=gen, daemon=True)
            th.start()
            buf = ""
            for piece in streamer:
                buf += piece
                yield split_think(buf, think)
            th.join()

    def write_prompt(self, desc, kind, style="Không"):
        """Dùng mô hình chat viết prompt tiếng Anh cho mô hình ảnh/video."""
        msgs = [{"role": "system", "content": PROMPT_WRITER[kind]}, {"role": "user", "content": desc}]
        answer = ""
        for _, answer in self.chat_stream(msgs, think=False, max_new_tokens=220):
            pass
        p = answer.strip().strip('"').strip()
        extra = STYLES.get(style, ("", ""))[0]
        return f"{p}, {extra}" if extra else p

    # ---------- ảnh ----------
    def _load_image(self, kind):
        if self.img is not None and self.img_kind == kind:
            return
        self.unload(("image", "video") if VRAM < 24 else ("image",))
        if VRAM < 12:
            self.unload(("chat",))
        from diffusers import AutoencoderKL, AutoPipelineForText2Image
        if kind == "flux":
            from diffusers import FluxPipeline
            pipe = FluxPipeline.from_pretrained("black-forest-labs/FLUX.1-schnell", torch_dtype=torch.bfloat16)
            pipe.enable_model_cpu_offload()
        else:
            vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
            mid = "stabilityai/sdxl-turbo" if kind == "fast" else "stabilityai/stable-diffusion-xl-base-1.0"
            pipe = AutoPipelineForText2Image.from_pretrained(mid, vae=vae, torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
            if VRAM >= 12:
                pipe.to("cuda")
            else:
                pipe.enable_model_cpu_offload()
        self.img, self.img_kind, self.img_lora = pipe, kind, None

    def image(self, prompt, negative="", kind="quality", width=1024, height=1024, n=1, seed=-1,
              lora=None, lora_scale=0.8, style="Không"):
        if not CUDA:
            raise RuntimeError("Tạo ảnh cần GPU. Hãy chạy trên Google Colab (GPU T4) hoặc máy có GPU NVIDIA.")
        with self.lock:
            self._load_image(kind)
            pipe = self.img
            if kind != "flux" and lora != self.img_lora:
                if self.img_lora:
                    pipe.unload_lora_weights()
                if lora:
                    pipe.load_lora_weights(image_loras()[lora], adapter_name="style")
                    pipe.set_adapters(["style"], adapter_weights=[float(lora_scale)])
                self.img_lora = lora
            seed = int(seed) if seed is not None and int(seed) >= 0 else int(time.time()) % 2**31
            g = torch.Generator("cpu").manual_seed(seed)
            st_neg = STYLES.get(style, ("", ""))[1]
            neg = ", ".join(x for x in [negative, st_neg, BASE_NEGATIVE] if x)
            if kind == "fast":
                args = dict(num_inference_steps=4, guidance_scale=0.0, width=512, height=512)
            elif kind == "flux":
                args = dict(num_inference_steps=4, guidance_scale=0.0, width=width, height=height, max_sequence_length=256)
            else:
                args = dict(num_inference_steps=30, guidance_scale=6.5, width=width, height=height, negative_prompt=neg)
            imgs = pipe(prompt=prompt, num_images_per_prompt=int(n), generator=g, **args).images
            paths = []
            for im in imgs:
                p = _stamp("png")
                im.save(p)
                paths.append(p)
            return paths, seed

    # ---------- video ----------
    def _load_video(self, kind):
        if self.vid is not None and self.vid_kind == kind:
            return
        self.unload(("video", "image", "chat") if VRAM < 24 else ("video",))
        if kind == "wan":
            from diffusers import AutoencoderKLWan, WanPipeline
            mid = "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"
            vae = AutoencoderKLWan.from_pretrained(mid, subfolder="vae", torch_dtype=torch.float32)
            pipe = WanPipeline.from_pretrained(mid, vae=vae, torch_dtype=DTYPE)
        elif kind == "ltx":
            from diffusers import LTXPipeline
            pipe = LTXPipeline.from_pretrained("Lightricks/LTX-Video", torch_dtype=DTYPE)
        else:  # ltx_i2v
            from diffusers import LTXImageToVideoPipeline
            pipe = LTXImageToVideoPipeline.from_pretrained("Lightricks/LTX-Video", torch_dtype=DTYPE)
        if VRAM >= 24:
            pipe.to("cuda")
        else:
            pipe.enable_model_cpu_offload()
        try:
            pipe.vae.enable_tiling()
        except Exception:
            pass
        self.vid, self.vid_kind = pipe, kind

    def video(self, prompt, kind="wan", seconds=3, image_path=None, seed=-1, negative=""):
        if not CUDA:
            raise RuntimeError("Dựng video cần GPU. Hãy chạy trên Google Colab (GPU T4) hoặc máy có GPU NVIDIA.")
        from diffusers.utils import export_to_video
        if image_path:
            kind = "ltx_i2v"  # có ảnh đầu → ảnh thành video
        with self.lock:
            self._load_video(kind)
            seed = int(seed) if seed is not None and int(seed) >= 0 else int(time.time()) % 2**31
            g = torch.Generator("cpu").manual_seed(seed)
            neg = ", ".join(x for x in [negative, VIDEO_NEGATIVE] if x)
            if kind == "wan":
                fps = 16
                frames = min(81, int(seconds * fps) // 4 * 4 + 1)
                out = self.vid(prompt=prompt, negative_prompt=neg, width=832, height=480, num_frames=frames,
                               guidance_scale=5.0, num_inference_steps=30, generator=g).frames[0]
            else:
                fps = 24
                frames = min(161, int(seconds * fps) // 8 * 8 + 1)
                w, h = (704, 480) if VRAM >= 16 else (512, 320)
                args = dict(prompt=prompt, negative_prompt=neg, width=w, height=h, num_frames=frames,
                            num_inference_steps=40, guidance_scale=3.0, generator=g)
                if kind == "ltx_i2v":
                    from PIL import Image
                    args["image"] = Image.open(image_path).convert("RGB").resize((w, h))
                out = self.vid(**args).frames[0]
            path = _stamp("mp4")
            export_to_video(out, path, fps=fps)
            return path, seed
