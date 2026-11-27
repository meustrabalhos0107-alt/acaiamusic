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
    # baixa e já guarda em bf16 (metade do tamanho): a imagem fica menor e o estúdio liga mais rápido
    .run_commands(
        "python -c \"import torch, shutil, os; from diffusers import LTXImageToVideoPipeline; "
        f"p = LTXImageToVideoPipeline.from_pretrained('{MODEL}', torch_dtype=torch.bfloat16); "
        "p.save_pretrained('/models/ltx', safe_serialization=True); "
        "shutil.rmtree(os.path.expanduser('~/.cache/huggingface'), ignore_errors=True)\""
    )
)
LOCAL = "/models/ltx"
_pipe = None


def _ltx():
    global _pipe
    if _pipe is None:
        import torch
        from diffusers import LTXImageToVideoPipeline

        _pipe = LTXImageToVideoPipeline.from_pretrained(LOCAL, torch_dtype=torch.bfloat16).to("cuda")
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
    timeout=25 * 60,
)
def gerar(item: dict):
    import base64
    import io
    import tempfile

    import time

    import torch
    from diffusers.utils import export_to_video
    from PIL import Image

    t0 = time.time()

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
        "A living cinematic shot. The wind blows steadily: grass, flowers and leaves sway visibly back and forth, "
        "clouds move across the sky, the sunlight flickers and glows, light rays pulse, glowing particles drift upward through the air, "
        "water flows and sparkles. The camera slowly dollies forward. Continuous, clearly visible natural motion everywhere in the frame. "
        f"Scene: {scene}. Peaceful, sacred atmosphere, high detail."
    )
    neg = "worst quality, static, still image, frozen, no motion, inconsistent motion, blurry, jittery, distorted, deformed, morphing, text, letters, watermark, people appearing"
    frames = int(item.get("frames", 97))
    frames = max(49, min(161, frames - (frames - 1) % 8))  # o modelo pede 8*k+1 quadros
    g = torch.Generator("cuda").manual_seed(int(item.get("seed", 0)) or 42)
    pipe = _ltx()
    t_load = time.time() - t0
    out = pipe(
        image=img, prompt=prompt, negative_prompt=neg, width=w, height=h, num_frames=frames,
        num_inference_steps=int(item.get("steps", 25)), guidance_scale=3.5, decode_timestep=0.03, decode_noise_scale=0.025, generator=g,
    ).frames[0]
    # vai e volta: repete sem emenda visível quando o vídeo de status é mais longo que o clipe
    loop = list(out) + list(out)[-2:0:-1]
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        export_to_video(loop, f.name, fps=24)
        data = open(f.name, "rb").read()
    t_all = time.time() - t0
    print(f"clipe: carregar {t_load:.0f}s, gerar {t_all - t_load:.0f}s, {len(out)} quadros {w}x{h}")
    return {"video": base64.b64encode(data).decode(), "width": w, "height": h, "frames": len(out), "fps": 24, "timing": {"load": round(t_load), "total": round(t_all)}}


# Endereço público (leve, sem GPU): começa um clipe e devolve um número; depois, com o número,
# diz se já ficou pronto. Assim nenhum pedido fica minutos aberto (o Modal expirava com erro 408
# quando a GPU demorava a ligar).
@app.function(image=modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]"), secrets=[modal.Secret.from_name("acaiamusic")])
@modal.fastapi_endpoint(method="POST")
def clipe(item: dict):
    if item.get("key") != os.environ["ACESTEP_API_KEY"]:
        return {"error": "Chave incorreta."}
    if item.get("call_id"):
        call = modal.FunctionCall.from_id(str(item["call_id"]))
        try:
            return call.get(timeout=0)
        except TimeoutError:
            return {"pending": True}
        except Exception as e:
            return {"error": f"O clipe não deu certo: {str(e)[:200]}"}
    if not item.get("image"):
        return {"error": "Imagem inválida."}
    call = gerar.spawn(item)
    return {"call_id": call.object_id}
