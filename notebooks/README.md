# TDK-3D Colab test

Open `notebooks/TDK_Colab_3D_ImageTo3D.ipynb` in Google Colab to test Blender, GPU/CUDA, GLB import/export, and optional TripoSR image-to-3D.

- Open from GitHub: https://github.com/thanhdangkhoa16122008-hash/TDK/blob/feat/colab-image-to-3d/notebooks/TDK_Colab_3D_ImageTo3D.ipynb
- Source repository: https://github.com/thanhdangkhoa16122008-hash/TDK
- Notebook also backed up privately to the user's Google Drive folder `TDK-3D`.

## Execution order
1. On Android open Colab using Chrome Desktop Site, then select the hardware accelerator GPU if available.
2. Run the GPU preflight and public read-only TDK clone.
3. Install Blender in the ephemeral Colab VM, then run the mesh/GLB smoke test.
4. Only if NVIDIA CUDA is usable with around 6 GiB+ VRAM, optionally run the TripoSR install and model generation. The TripoSR CUDA extension `torchmcubes` is a known compatibility risk; do not keep retrying failing installs.
5. Mount Google Drive **only in the final cell** to persist outputs to `MyDrive/TDK-3D/outputs/<UTC timestamp>/`.

## Safety and limits
- This is a **static-validated** notebook; no actual Colab GPU inference has been completed yet.
- Do not choose Run all before inspecting the setup, as it invokes third-party code.
- The notebook does not push to GitHub, auto-merge PRs, create paid cloud resources, or capture Google credentials.
- Blender smoke GLB is a procedural sphere, explicitly **not** AI output.
- Successful TripoSR geometry does not guarantee anime-character likeness, materials/rig, or mobile game quality.
- Colab's free runtimes are interactive, resource-limited and can be terminated; not a persistent automation server.

For issues, record GPU name/VRAM, Python/PyTorch/CUDA versions, and the first installation traceback.
