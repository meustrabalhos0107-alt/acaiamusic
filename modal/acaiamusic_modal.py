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
    )
)

# Os modelos ficam guardados aqui: baixam só na primeira vez
models = modal.Volume.from_name("acaiamusic-modelos", create_if_missing=True)


@app.function(
    image=image,
    gpu="T4",  # a GPU mais barata: gasta menos crédito
    volumes={"/models": models},
    secrets=[modal.Secret.from_name("acaiamusic")],
    scaledown_window=120,  # desliga sozinho 2 min depois da última música
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
        ACESTEP_INIT_LLM="false",
        ACESTEP_LM_BACKEND="pt",
        ACESTEP_CHECKPOINTS_DIR="/models",
        HF_HOME="/models/hf",
    )
    subprocess.Popen(["uv", "run", "acestep-api"], cwd="/app", env=env)
