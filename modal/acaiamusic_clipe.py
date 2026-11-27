# Clipe da capa do ACAIAMUSIC no Modal: a imagem do tema da música vira um vídeo curto com
# movimento de verdade (LTX-Video, imagem -> vídeo). App separado do estúdio e do ouvido, para
# poder ser atualizado sem interromper as músicas que estão gravando.
#   python -m modal deploy modal/acaiamusic_clipe.py
# Endereço: https://<conta>--acaiamusic-clipe-clipe.<região>.modal.run
# Modelo: Lightricks/LTX-Video (pesos abertos, licença OpenRAIL-M).
import os

import modal

app = modal.App("acaiamusic-clipe")
MODEL = "Lightricks/LTX-Video"
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.5.1", "diffusers==0.32.2", "transformers==4.46.3", "accelerate==1.1.1", "sentencepiece", "safetensors",
        "imageio==2.36.1", "imageio-ffmpeg==0.5.1", "pillow", "fastapi[standard]",
    )
    .run_commands(
        "python -c \"from huggingface_hub import snapshot_download; "
        f"snapshot_download('{MODEL}', allow_patterns=['model_index.json','scheduler/*','tokenizer/*','text_encoder/*','transformer/*','vae/*'])\""
    )
)
_pipe = None


def _ltx():
    global _pipe
    if _pipe is None:
        import torch
        from diffusers import LTXImageToVideoPipeline

        _pipe = LTXImageToVideoPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16).to("cuda")
        try:
            _pipe.vae.enable_tiling()
        except Exception:
            pass
    return _pipe


@app.function(
    image=image,
    gpu="L4",
    memory=32768,
    secrets=[modal.Secret.from_name("acaiamusic")],
    scaledown_window=60,
    max_containers=1,
    timeout=15 * 60,
)
@modal.fastapi_endpoint(method="POST")
def clipe(item: dict):
    import base64
    import io
    import tempfile

    import torch
    from diffusers.utils import export_to_video
    from PIL import Image

    if item.get("key") != os.environ["ACESTEP_API_KEY"]:
        return {"error": "Chave incorreta."}
    try:
        img = Image.open(io.BytesIO(base64.b64decode(item["image"]))).convert("RGB")
    except Exception:
        return {"error": "Imagem inválida."}
    vertical = item.get("format", "vertical") != "horizontal"
    w, h = (480, 832) if vertical else (832, 480)
    # recorta a imagem no formato do vídeo (centro), sem esticar
    sw, sh = img.size
    r = w / h
    if sw / sh > r:
        nw = int(sh * r)
        img = img.crop(((sw - nw) // 2, 0, (sw - nw) // 2 + nw, sh))
    else:
        nh = int(sw / r)
        img = img.crop((0, (sh - nh) // 2, sw, (sh - nh) // 2 + nh))
    img = img.resize((w, h), Image.LANCZOS)

    scene = str(item.get("prompt", ""))[:600]
    prompt = (
        f"{scene}. The scene comes alive with gentle, natural, continuous motion: soft wind moves the grass, leaves and flowers, "
        "clouds drift slowly across the sky, warm light rays shimmer and glow, water ripples softly, tiny particles of light float in the air. "
        "Slow cinematic camera push-in. Peaceful, sacred, contemplative atmosphere, high detail, smooth motion."
    )
    neg = "worst quality, inconsistent motion, blurry, jittery, distorted, deformed, morphing, flicker, text, letters, watermark, people appearing"
    frames = int(item.get("frames", 121))
    frames = max(49, min(161, frames - (frames - 1) % 8))  # o modelo pede 8*k+1 quadros
    g = torch.Generator("cuda").manual_seed(int(item.get("seed", 0)) or 42)
    out = _ltx()(
        image=img, prompt=prompt, negative_prompt=neg, width=w, height=h, num_frames=frames,
        num_inference_steps=int(item.get("steps", 40)), guidance_scale=3.0, decode_timestep=0.03, decode_noise_scale=0.025, generator=g,
    ).frames[0]
    # vai e volta: repete sem emenda visível quando o vídeo de status é mais longo que o clipe
    loop = list(out) + list(out)[-2:0:-1]
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        export_to_video(loop, f.name, fps=24)
        data = open(f.name, "rb").read()
    return {"video": base64.b64encode(data).decode(), "width": w, "height": h, "frames": len(out), "fps": 24}
