# Estúdio ACAIAMUSIC no Modal (ACE-Step 1.5 numa GPU que só liga quando você cria uma música)
#
# Gratuito: o plano Starter do Modal dá créditos todo mês. Para NUNCA haver cobrança,
# em modal.com → Settings → Usage/Billing deixe o limite de gasto (budget) igual aos créditos.
#
# Instalar (uma vez só), no terminal, dentro da pasta do projeto:
#   pip install modal
#   modal setup                                   (abre o navegador para entrar na conta)
#   modal secret create acaiamusic ACESTEP_API_KEY=<uma-chave-secreta>
#   modal deploy modal/acaiamusic_modal.py
# O deploy mostra o endereço (https://...modal.run): cole-o no app em ⚙️ Servidor de música → Modal.
import os
import subprocess

import modal

app = modal.App("acaiamusic-estudio")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libsndfile1")
    .pip_install("uv")
    .run_commands(
        "git clone --depth 1 https://github.com/ACE-Step/ACE-Step-1.5.git /app",
        "cd /app && UV_LINK_MODE=copy uv sync --no-dev",
        # Os modelos (~10 GB) ficam DENTRO da imagem: a máquina liga com tudo pronto, sem baixar
        # nada (no volume eles se perdiam quando o estúdio era republicado e baixavam de novo).
        "cd /app && uv run python -c \"from huggingface_hub import snapshot_download; snapshot_download('ACE-Step/Ace-Step1.5', local_dir='/app/checkpoints')\"",
    )
)


@app.function(
    image=image,
    gpu="L4",  # GPU nova (bfloat16): na T4 o ACE-Step 1.5 gera NaN (som vazio) em músicas longas
    secrets=[modal.Secret.from_name("acaiamusic")],
    scaledown_window=300,  # desliga sozinho 5 min depois da última música (a próxima não recarrega os modelos)
    max_containers=1,  # nunca liga mais de uma GPU
    timeout=60 * 60,
)
@modal.concurrent(max_inputs=50)
@modal.web_server(port=8001, startup_timeout=20 * 60)
def estudio():
    env = dict(
        os.environ,
        ACESTEP_API_HOST="0.0.0.0",
        ACESTEP_API_PORT="8001",
        ACESTEP_CONFIG_PATH="acestep-v15-turbo",
        ACESTEP_INIT_LLM="true",  # planejador musical (5Hz LM): som mais humano e natural
        ACESTEP_LM_MODEL_PATH="acestep-5Hz-lm-1.7B",
        ACESTEP_LM_BACKEND="pt",
        ACESTEP_CHECKPOINTS_DIR="/app/checkpoints",  # é aqui que o estúdio procura (ignora outras pastas)
        ACESTEP_GENERATION_TIMEOUT="3600",
        ACESTEP_NO_INIT="false",  # carrega os modelos ao ligar (o pré-aquecimento já deixa tudo pronto)
    )
    subprocess.Popen(["uv", "run", "acestep-api"], cwd="/app", env=env)


# ---------- Separador de faixas (Demucs) na GPU: ~20 s por música ----------
# O separador público e gratuito é lento e vive lotado; aqui ele liga só para a sua música.
# Endereço: o mesmo do estúdio, trocando "-estudio.modal.run" por "-separar.modal.run".
sep_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("torch==2.5.1", "torchaudio==2.5.1", "demucs==4.0.1", "lameenc", "soundfile", "fastapi[standard]")
    .run_commands("python -c \"from demucs.pretrained import get_model; get_model('htdemucs')\"")
)


@app.function(
    image=sep_image,
    gpu="T4",
    secrets=[modal.Secret.from_name("acaiamusic")],
    scaledown_window=60,  # desliga 1 min depois da última separação
    max_containers=1,
    timeout=15 * 60,
)
@modal.fastapi_endpoint(method="POST")
def separar(item: dict):
    import base64
    import pathlib
    import tempfile

    if item.get("key") != os.environ["ACESTEP_API_KEY"]:
        return {"error": "Chave incorreta."}
    with tempfile.TemporaryDirectory() as d:
        src = pathlib.Path(d, "musica.mp3")
        src.write_bytes(base64.b64decode(item["audio"]))
        subprocess.run(
            ["python", "-m", "demucs", "-n", "htdemucs", "--mp3", "--mp3-bitrate", "192", "-o", d, str(src)],
            check=True,
        )
        out = pathlib.Path(d, "htdemucs", "musica")
        return {n: base64.b64encode((out / f"{n}.mp3").read_bytes()).decode() for n in ["vocals", "bass", "drums", "other"]}

