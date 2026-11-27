# 2ª voz do ACAIAMUSIC no Modal (dueto do karaokê): a voz da IA (faixa de voz separada) vira
# uma 2ª voz em terça, acima ou abaixo, seguindo a escala do tom da música (terça maior ou menor
# conforme a nota, como um backing vocal de verdade). Só processador (sem GPU): sai barato.
#   python -m modal deploy modal/acaiamusic_harmonia.py
import os

import modal

app = modal.App("acaiamusic-harmonia")
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("numpy==1.26.4", "scipy==1.13.1", "pyworld==0.3.4", "soundfile==0.12.1", "fastapi[standard]")
)

MAIOR = [0, 2, 4, 5, 7, 9, 11]
MENOR = [0, 2, 3, 5, 7, 8, 10]


@app.function(image=image, cpu=2, memory=6144, timeout=20 * 60, scaledown_window=60, max_containers=2)
def harmonizar(item: dict):
    import base64
    import subprocess
    import tempfile
    import time

    import numpy as np
    import pyworld as pw
    import soundfile as sf
    from scipy.ndimage import median_filter

    t0 = time.time()
    sr = 24000
    with tempfile.NamedTemporaryFile(suffix=".audio") as f:
        f.write(base64.b64decode(item["audio"]))
        f.flush()
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", f.name, "-ac", "1", "-ar", str(sr), "-f", "f64le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float64).copy()
    if len(x) < sr:
        return {"error": "Áudio da voz muito curto."}

    tonic = int(item.get("tonic", 0)) % 12
    escala = MENOR if item.get("minor") else MAIOR
    passo = -2 if item.get("dir") == "down" else 2  # dois graus da escala = uma terça

    fp = 5.0
    f0, t = pw.dio(x, sr, frame_period=fp)
    f0 = pw.stonemask(x, f0, t, sr)
    sp = pw.cheaptrick(x, f0, t, sr)
    ap = pw.d4c(x, f0, t, sr)

    # nota de cada quadro -> grau da escala mais próximo -> dois graus acima/abaixo
    shift = np.zeros_like(f0)
    voiced = f0 > 40
    midi = np.where(voiced, 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440.0), 0)
    notas = [tonic + 12 * o + g for o in range(-2, 12) for g in escala]  # todas as notas da escala (MIDI)
    notas = np.array(sorted(notas))
    for i in np.nonzero(voiced)[0]:
        k = int(np.argmin(np.abs(notas - midi[i])))
        alvo = min(max(k + passo, 0), len(notas) - 1)
        shift[i] = notas[alvo] - notas[k]
    # sem trocar de intervalo a cada quadro (evita "tremido" nas notas de passagem)
    shift = median_filter(shift, size=25)
    shift[~voiced] = 0
    f0n = np.where(voiced, f0 * np.power(2.0, shift / 12.0), 0)
    y = pw.synthesize(f0n, sp, ap, sr, frame_period=fp)
    peak = float(np.max(np.abs(y))) or 1.0
    y = (y / peak * 0.89).astype(np.float32)

    with tempfile.NamedTemporaryFile(suffix=".flac") as out:
        sf.write(out.name, y, sr, format="FLAC", subtype="PCM_16")
        data = open(out.name, "rb").read()
    print(f"2ª voz: {len(x) / sr:.0f} s de áudio em {time.time() - t0:.0f} s")
    return {"audio": base64.b64encode(data).decode(), "seconds": round(len(x) / sr, 1), "timing": round(time.time() - t0)}


# Endereço público leve: começa e devolve um número; com o número, diz se já ficou pronto
@app.function(image=modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]"), secrets=[modal.Secret.from_name("acaiamusic")])
@modal.fastapi_endpoint(method="POST")
def harmonia(item: dict):
    if item.get("key") != os.environ["ACESTEP_API_KEY"]:
        return {"error": "Chave incorreta."}
    if item.get("call_id"):
        call = modal.FunctionCall.from_id(str(item["call_id"]))
        try:
            return call.get(timeout=0)
        except TimeoutError:
            return {"pending": True}
        except Exception as e:
            return {"error": f"A 2ª voz não deu certo: {str(e)[:200]}"}
    if not item.get("audio"):
        return {"error": "Áudio inválido."}
    call = harmonizar.spawn(item)
    return {"call_id": call.object_id}


# Despertador do app (gratuito): o servidor grátis do Render dorme quando ninguém usa. Toda
# madrugada (04:05 em Brasília) este agendamento o acorda; ao acordar, o app grava o Salmo do dia.
@app.function(image=modal.Image.debian_slim(python_version="3.11"), schedule=modal.Cron("5 7 * * *"), timeout=600)
def acordar():
    import time
    import urllib.request

    for i in range(12):
        try:
            with urllib.request.urlopen("https://acaiamusic.onrender.com/manifest.json", timeout=60) as r:
                if r.status == 200:
                    print(f"app acordado na tentativa {i + 1}")
                    return
        except Exception as e:
            print(f"tentativa {i + 1}: {e}")
        time.sleep(20)
