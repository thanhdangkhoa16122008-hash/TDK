"""Huấn luyện LoRA ảnh SDXL: dạy mô hình một PHONG CÁCH hoặc một NHÂN VẬT từ 15–40 ảnh của bạn.

    python train/train_image_lora.py --images data/images/muro-var --name muro-var \
        --prompt "murovar style, black shadow figure" --steps 800

Sau khi xong: LoRA ở loras/<name>/pytorch_lora_weights.safetensors → chọn trong tab "Tạo ảnh".
Khi tạo ảnh, viết từ khóa kích hoạt (vd "murovar style") trong mô tả.

Dùng script huấn luyện chính thức của thư viện diffusers (train_dreambooth_lora_sdxl.py),
tự tải đúng phiên bản khớp với diffusers đang cài. Cần GPU NVIDIA ≥ 16 GB (Colab T4 được, ~30–60 phút).
Ảnh: rõ nét, đa dạng góc/bố cục, cùng phong cách; nên cắt vuông ~1024px.
"""
import argparse
import subprocess
import sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--images", required=True, help="thư mục ảnh huấn luyện")
ap.add_argument("--name", required=True, help="tên LoRA (thư mục loras/<name>)")
ap.add_argument("--prompt", required=True, help='câu mô tả chung có từ khóa kích hoạt, vd "murovar style"')
ap.add_argument("--steps", type=int, default=800)
ap.add_argument("--rank", type=int, default=16)
ap.add_argument("--resolution", type=int, default=1024)
ap.add_argument("--lr", type=float, default=1e-4)
args = ap.parse_args()

imgs = [p for p in Path(args.images).glob("*") if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}]
if len(imgs) < 5:
    sys.exit(f"Chỉ thấy {len(imgs)} ảnh trong {args.images}. Cần ít nhất 5, tốt nhất 15–40 ảnh.")

import diffusers  # noqa: E402

ver = diffusers.__version__.split(".dev")[0]
src = Path.home() / ".cache" / "ai-studio" / f"diffusers-v{ver}"
if not src.exists():
    print(f"Tải script huấn luyện diffusers v{ver}…")
    subprocess.run(["git", "clone", "--depth", "1", "--branch", f"v{ver}",
                    "https://github.com/huggingface/diffusers", str(src)], check=True)
script = src / "examples" / "dreambooth" / "train_dreambooth_lora_sdxl.py"
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", str(script.parent / "requirements_sdxl.txt"), "bitsandbytes"], check=True)

out = Path("loras") / args.name
cmd = ["accelerate", "launch", "--mixed_precision", "fp16", "--num_processes", "1", "--num_machines", "1", "--dynamo_backend", "no", str(script),
       "--pretrained_model_name_or_path", "stabilityai/stable-diffusion-xl-base-1.0",
       "--pretrained_vae_model_name_or_path", "madebyollin/sdxl-vae-fp16-fix",
       "--instance_data_dir", args.images, "--instance_prompt", args.prompt,
       "--output_dir", str(out), "--resolution", str(args.resolution), "--rank", str(args.rank),
       "--train_batch_size", "1", "--gradient_accumulation_steps", "4", "--gradient_checkpointing", "--use_8bit_adam",
       "--learning_rate", str(args.lr), "--lr_scheduler", "constant", "--lr_warmup_steps", "0",
       "--max_train_steps", str(args.steps), "--checkpointing_steps", "100000", "--mixed_precision", "fp16", "--seed", "42"]
print(" ".join(cmd))
subprocess.run(cmd, check=True)
print(f"✓ Xong: {out}/pytorch_lora_weights.safetensors — mở lại app, chọn LoRA '{args.name}' trong tab Tạo ảnh.")
