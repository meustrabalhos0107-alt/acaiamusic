# Ouvido do ACAIAMUSIC no Modal: Whisper + acordes do áudio (app separado do estúdio, para
# poder ser atualizado sem interromper as músicas que estão gravando).
#   python -m modal deploy modal/acaiamusic_ouvido.py
import os
import subprocess

import modal

app = modal.App("acaiamusic-ouvido")
sep_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("torch==2.5.1", "torchaudio==2.5.1", "demucs==4.0.1", "lameenc", "soundfile", "fastapi[standard]")
    .run_commands("python -c \"from demucs.pretrained import get_model; get_model('htdemucs')\"")
)


# ---------- Ouvido: Whisper (o que está sendo cantado) + acordes do áudio ----------
# Separa a voz (Demucs), transcreve a voz com o Whisper (com o tempo de cada palavra) e detecta
# os acordes no acompanhamento. Serve para conferir a pronúncia e montar a cifra do áudio real.
# Endereço: https://<conta>--acaiamusic-ouvido-ouvir.<região>.modal.run
ouvir_image = sep_image.pip_install("transformers==4.46.3", "accelerate==1.1.1", "librosa==0.10.2.post1").run_commands(
    "python -c \"from huggingface_hub import snapshot_download; snapshot_download('openai/whisper-large-v3-turbo')\""
)
NOTAS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
_asr = None


def _whisper():
    global _asr
    if _asr is None:
        import torch
        from transformers import pipeline

        _asr = pipeline("automatic-speech-recognition", model="openai/whisper-large-v3-turbo", torch_dtype=torch.float16, device="cuda:0")
    return _asr


def _acordes(path):
    """Acordes maiores/menores por tempo musical (cromagrama + suavização), e o tom provável."""
    import librosa
    import numpy as np

    y, sr = librosa.load(path, sr=22050, mono=True)
    hop = 1024
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop)
    bounds = librosa.util.fix_frames(beats, x_min=0, x_max=chroma.shape[1])
    cs = librosa.util.sync(chroma, bounds, aggregate=np.median)
    energy = cs.sum(axis=0)
    cn = cs / (np.linalg.norm(cs, axis=0, keepdims=True) + 1e-9)
    names, tpl = [], []
    for i in range(12):
        for q, iv in (("", (0, 4, 7)), ("m", (0, 3, 7))):
            v = np.zeros(12)
            v[[(i + k) % 12 for k in iv]] = [1.0, 0.8, 0.9]
            tpl.append(v / np.linalg.norm(v))
            names.append(NOTAS[i] + q)
    sc = np.array(tpl) @ cn  # 24 x n
    # Viterbi: trocar de acorde custa um pouco (evita trocas a cada batida)
    n, pen = sc.shape[1], 0.07
    dp = np.zeros_like(sc)
    bp = np.zeros(sc.shape, dtype=int)
    dp[:, 0] = sc[:, 0]
    for t in range(1, n):
        best = int(np.argmax(dp[:, t - 1]))
        stay = dp[:, t - 1]
        move = dp[best, t - 1] - pen
        bp[:, t] = np.where(stay >= move, np.arange(24), best)
        dp[:, t] = np.maximum(stay, move) + sc[:, t]
    path = [int(np.argmax(dp[:, -1]))]
    for t in range(n - 1, 0, -1):
        path.append(int(bp[path[-1], t]))
    path.reverse()
    times = librosa.frames_to_time(bounds, sr=sr, hop_length=hop)
    quiet = energy < 0.15 * np.median(energy)
    segs = []
    for k in range(n):
        name = "N" if quiet[k] else names[path[k]]
        t0, t1 = float(times[k]), float(times[k + 1]) if k + 1 < len(times) else float(len(y) / sr)
        if segs and segs[-1][2] == name:
            segs[-1][1] = t1
        else:
            segs.append([t0, t1, name])
    # tom: perfis de Krumhansl sobre o cromagrama médio
    maj = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    mnr = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    prof = chroma.mean(axis=1)
    cands = [(np.corrcoef(np.roll(maj, i), prof)[0, 1], NOTAS[i]) for i in range(12)]
    cands += [(np.corrcoef(np.roll(mnr, i), prof)[0, 1], NOTAS[i] + "m") for i in range(12)]
    key = max(cands)[1]
    return segs, key, float(np.atleast_1d(tempo)[0])


@app.function(
    image=ouvir_image,
    gpu="T4",
    secrets=[modal.Secret.from_name("acaiamusic")],
    scaledown_window=120,
    max_containers=1,
    timeout=15 * 60,
)
@modal.fastapi_endpoint(method="POST")
def ouvir(item: dict):
    import base64
    import pathlib
    import tempfile

    if item.get("key") != os.environ["ACESTEP_API_KEY"]:
        return {"error": "Chave incorreta."}
    lang = {"pt": "portuguese", "en": "english", "es": "spanish"}.get(item.get("language", "pt"), "portuguese")
    with tempfile.TemporaryDirectory() as d:
        src = pathlib.Path(d, "musica.mp3")
        src.write_bytes(base64.b64decode(item["audio"]))
        subprocess.run(["python", "-m", "demucs", "--two-stems", "vocals", "-n", "htdemucs", "-o", d, str(src)], check=True)
        out = pathlib.Path(d, "htdemucs", "musica")
        import torch

        try:
            r = _whisper()(
                str(out / "vocals.wav"),
                chunk_length_s=30,
                batch_size=2,
                return_timestamps="word",
                generate_kwargs={"language": lang, "task": "transcribe"},
            )
        finally:
            torch.cuda.empty_cache()  # devolve a memória da GPU para o separador da próxima música
        words = [[c["text"].strip(), round(c["timestamp"][0] or 0, 2), round(c["timestamp"][1] or c["timestamp"][0] or 0, 2)] for c in r.get("chunks", [])]
        chords, key, tempo = _acordes(str(out / "no_vocals.wav"))
        return {"text": r["text"].strip(), "words": words, "chords": chords, "key": key, "tempo": round(tempo)}
