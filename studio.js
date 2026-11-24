// Ferramentas de estúdio: separação de faixas (Demucs) e vídeo para Status (ffmpeg)
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import { encodeMp3, mixTracks, parseWav } from "./audio.js";

const STEMS_HOST = process.env.STEMS_HOST || "nakas-demucs-playground.hf.space";
const STEM_NAMES = ["vocals", "bass", "drums", "other"];

// ---------- Separação: Space Gradio 3 (protocolo WebSocket legado) ----------
function demucs(mp3Buffer, token, onStatus) {
  return new Promise(async (resolve, reject) => {
    const auth = token ? { Authorization: `Bearer ${token}` } : {};
    let fnIndex = 0;
    try {
      const cfg = await (await fetch(`https://${STEMS_HOST}/config`, { headers: auth })).json();
      fnIndex = Math.max(0, cfg.dependencies.findIndex((d) => d.api_name === "predict"));
    } catch {
      return reject(new Error("O separador gratuito está fora do ar agora. Tente mais tarde."));
    }
    const hash = Math.random().toString(36).slice(2);
    const ws = new WebSocket(`wss://${STEMS_HOST}/queue/join`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("A separação demorou demais. Tente de novo mais tarde."));
    }, 60 * 60 * 1000);
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Falha de conexão com o separador gratuito."));
    };
    ws.onmessage = async (ev) => {
      const m = JSON.parse(ev.data);
      if (m.msg === "send_hash") ws.send(JSON.stringify({ fn_index: fnIndex, session_hash: hash }));
      else if (m.msg === "estimation") onStatus(m.rank > 0 ? `Na fila do separador: ${m.rank} na frente…` : "Separando as faixas…");
      else if (m.msg === "send_data")
        ws.send(JSON.stringify({ fn_index: fnIndex, session_hash: hash, event_data: null, data: [{ name: "song.mp3", data: `data:audio/mpeg;base64,${mp3Buffer.toString("base64")}` }] }));
      else if (m.msg === "process_starts") onStatus("Separando voz e instrumentos com IA…");
      else if (m.msg === "queue_full") {
        clearTimeout(timer);
        ws.close();
        reject(new Error("O separador gratuito está lotado. Tente em alguns minutos."));
      } else if (m.msg === "process_completed") {
        clearTimeout(timer);
        ws.close();
        if (!m.success || !m.output?.data) return reject(new Error("O separador não conseguiu processar esta música."));
        try {
          onStatus("Baixando as faixas separadas…");
          const files = await Promise.all(
            m.output.data.slice(0, 4).map(async (f) => {
              const r = await fetch(`https://${STEMS_HOST}/file=${f.name}`, { headers: auth });
              if (!r.ok) throw new Error(`download ${r.status}`);
              return Buffer.from(await r.arrayBuffer());
            }),
          );
          resolve(files);
        } catch (e) {
          reject(new Error("Falha ao baixar as faixas: " + e.message));
        }
      }
    };
  });
}

// ---------- ffmpeg ----------
// Roda o ffmpeg com limite de tempo: se travar, é encerrado e a fila segue
function ffmpeg(args, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      ["-hide_banner", "-loglevel", "error", "-y", ...args],
      { maxBuffer: 1 << 24, timeout: timeoutMs, killSignal: "SIGKILL", windowsHide: true },
      (err, _o, stderr) => {
        if (err?.killed) return reject(new Error("a montagem demorou demais e foi cancelada"));
        err ? reject(new Error(stderr || err.message)) : resolve();
      },
    );
  });
}

const int = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

export function registerStudio(app, { loadSongs, updateSongs, SONGS_DIR, jobs, HF_TOKEN }) {
  const MEDIA = (id) => path.join(SONGS_DIR, "media", id);
  let stemChain = Promise.resolve();
  let videoChain = Promise.resolve();

  const newJob = () => {
    const id = randomUUID();
    const job = { status: "waiting", message: "Aguardando…", createdAt: Date.now() };
    jobs.set(id, job);
    const set = (p) => Object.assign(job, p, { updatedAt: Date.now() });
    return { id, set };
  };
  const saveField = (songId, patch) =>
    updateSongs((songs) => songs.map((s) => (s.id === songId ? { ...s, ...patch } : s)));

  // ===== Separar faixas =====
  app.post("/api/songs/:id/stems", async (req, res) => {
    const song = (await loadSongs()).find((s) => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: "Música não encontrada." });
    if (song.stems) return res.json({ done: true, song });
    const { id, set } = newJob();
    stemChain = stemChain.then(async () => {
      try {
        set({ status: "generating", message: "Enviando para o separador de IA…" });
        const mp3 = await fs.readFile(path.join(SONGS_DIR, `${song.id}.mp3`));
        const wavs = await demucs(mp3, HF_TOKEN, (message) => set({ status: "generating", message }));
        set({ status: "saving", message: "Mixando o playback e salvando em MP3…" });
        const pcm = wavs.map(parseWav);
        const [vocals, bass, drums, other] = pcm;
        const dir = MEDIA(song.id);
        mkdirSync(dir, { recursive: true });
        const out = {};
        const write = async (name, track) => {
          await fs.writeFile(path.join(dir, `${name}.mp3`), encodeMp3(track, 192));
          out[name] = `/audio/media/${song.id}/${name}.mp3`;
        };
        await write("instrumental", mixTracks([bass, drums, other]));
        await write("vocals", vocals);
        await write("drums", drums);
        await write("bass", bass);
        await write("other", other);
        await saveField(song.id, { stems: out });
        set({ status: "done", message: "Faixas separadas!", song: { ...song, stems: out } });
      } catch (e) {
        console.error("Erro separação:", e.message);
        set({ status: "error", error: e.message });
      }
    });
    res.json({ jobId: id });
  });

  // ===== Vídeo para Status (1 min) =====
  app.post("/api/songs/:id/video", async (req, res) => {
    const song = (await loadSongs()).find((s) => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: "Música não encontrada." });
    const b = req.body || {};
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || ""));
    if (!m) return res.status(400).json({ error: "Imagem do vídeo inválida." });
    const vertical = b.format !== "horizontal";
    const W = vertical ? 720 : 1280, H = vertical ? 1280 : 720;
    const start = int(b.start, 0, Math.max(0, (song.duration || 60) - 5), 0);
    const len = Math.min(60, Math.max(5, (song.duration || 60) - start));
    const L = b.layout || {};
    const wave = { x: int(L.wave?.x, 0, W, 40), y: int(L.wave?.y, 0, H, H - 360), w: int(L.wave?.w, 16, W, W - 80), h: int(L.wave?.h, 16, H, 150) };
    const bar = { x: int(L.bar?.x, 0, W, 40), y: int(L.bar?.y, 0, H, H - 170), w: int(L.bar?.w, 16, W, W - 80), h: int(L.bar?.h, 2, 40, 8) };
    wave.w -= wave.w % 2;
    wave.h -= wave.h % 4;
    const half = wave.h / 2;

    const { id, set } = newJob();
    videoChain = videoChain.then(async () => {
      const tmp = path.join(os.tmpdir(), `acaia-${id}.png`);
      try {
        set({ status: "generating", message: "Montando o vídeo…" });
        await fs.writeFile(tmp, Buffer.from(m[1], "base64"));
        const dir = MEDIA(song.id);
        mkdirSync(dir, { recursive: true });
        const name = `video-${vertical ? "vertical" : "horizontal"}-${start}.mp4`;
        const filter = [
          `[0:v]scale=${W}:${H},format=rgba,fade=t=in:st=0:d=0.8,fade=t=out:st=${len - 1}:d=1[bg]`,
          `[1:a]atrim=0:${len},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1,afade=t=out:st=${len - 2}:d=2,asplit=2[aout][av]`,
          // equalizador (barras de frequência) com reflexo
          `[av]aformat=channel_layouts=mono,showfreqs=s=${wave.w}x${half}:mode=bar:ascale=cbrt:fscale=log:colors=0xf472b6:win_size=2048,fps=30,format=rgba,split[f1][f2]`,
          `[f2]vflip,colorchannelmixer=aa=0.3[f2r]`,
          `[f1][f2r]vstack[wv]`,
          `[bg][wv]overlay=${wave.x}:${wave.y}:shortest=1[v1]`,
          // barra de progresso: o preenchimento anda dentro do trilho (tudo com duração definida)
          `color=c=white@0.2:s=${bar.w}x${bar.h}:r=30:d=${len},format=rgba[track]`,
          `color=c=0xec4899:s=${bar.w}x${bar.h}:r=30:d=${len}[fill]`,
          `[track][fill]overlay=x='-w+w*t/${len}':y=0:shortest=1[barv]`,
          `[v1][barv]overlay=${bar.x}:${bar.y}:shortest=1[v2]`,
          `[v2]format=yuv420p[vout]`,
        ].join(";");
        await ffmpeg([
          "-loop", "1", "-framerate", "30", "-t", String(len), "-i", tmp,
          "-ss", String(start), "-t", String(len), "-i", path.join(SONGS_DIR, `${song.id}.mp3`),
          "-filter_complex", filter,
          "-map", "[vout]", "-map", "[aout]",
          "-t", String(len), "-r", "30", "-shortest", "-max_muxing_queue_size", "1024",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-maxrate", "1600k", "-bufsize", "3200k", "-profile:v", "high",
          "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
          path.join(dir, name),
        ]);
        const url = `/audio/media/${song.id}/${name}`;
        set({ status: "done", message: "Vídeo pronto!", url });
      } catch (e) {
        console.error("Erro vídeo:", e.message);
        set({ status: "error", error: "Não consegui montar o vídeo: " + e.message.slice(0, 200) });
      } finally {
        fs.rm(tmp, { force: true }).catch(() => {});
      }
    });
    res.json({ jobId: id });
  });

  // ===== Karaokê: tempo de cada verso (a letra aparece na hora em que é cantada) =====
  // Ouve a faixa de VOZ separada: acha os trechos cantados (entre as pausas) e encaixa cada verso
  // no momento certo, proporcional ao tamanho do verso dentro do tempo realmente cantado.
  function voicedSegments(file) {
    return new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        ["-hide_banner", "-i", file, "-af", "aformat=channel_layouts=mono,silencedetect=noise=-32dB:d=0.32", "-f", "null", "-"],
        { maxBuffer: 1 << 24, timeout: 120000, windowsHide: true },
        (err, _o, stderr) => {
          if (err && !stderr) return reject(err);
          const dur = Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(stderr)?.slice(1).reduce((a, x, i) => a + x * [3600, 60, 1][i], 0)) || 0;
          const segs = [];
          let start = 0;
          for (const m of stderr.matchAll(/silence_(start|end): ([\d.]+)/g)) {
            const t = Number(m[2]);
            if (m[1] === "start") {
              if (t - start > 0.25) segs.push([start, t]);
            } else start = t;
          }
          if (dur - start > 0.25 && !/silence_start: [\d.]+\s*$/.test(stderr.trim())) segs.push([start, dur]);
          resolve({ segs, dur });
        },
      );
    });
  }
  function alignLines(lines, segs) {
    const voiced = segs.reduce((a, [s, e]) => a + (e - s), 0);
    if (!lines.length || !voiced) return [];
    const weight = lines.map((l) => Math.max(4, l.replace(/[^\p{L}\p{N}]/gu, "").length)); // versos maiores levam mais tempo
    const total = weight.reduce((a, b) => a + b, 0);
    const atVoiced = (v) => {
      // converte "tempo cantado" em tempo real da música
      for (const [s, e] of segs) {
        if (v <= e - s) return s + v;
        v -= e - s;
      }
      return segs.at(-1)[1];
    };
    let acc = 0;
    return lines.map((_, k) => {
      let t = atVoiced((acc / total) * voiced);
      acc += weight[k];
      // gruda no começo de frase mais próximo (até 1,5 s), que é onde o verso realmente começa
      const near = segs.map(([s]) => s).filter((s) => Math.abs(s - t) <= 1.5).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
      return Math.round((near ?? t) * 100) / 100;
    }).map((t, k, arr) => (k && t <= arr[k - 1] ? arr[k - 1] + 0.4 : t)); // sempre em ordem
  }
  app.get("/api/songs/:id/timing", async (req, res) => {
    const song = (await loadSongs()).find((s) => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: "Música não encontrada." });
    const lines = (song.sections || []).flatMap((s) => s.lines);
    const sig = lines.join("\n").length + ":" + lines.length;
    if (song.timing?.sig === sig) return res.json(song.timing);
    if (!song.stems?.vocals) return res.json({ times: [], approximate: true });
    try {
      const { segs, dur } = await voicedSegments(path.join(SONGS_DIR, song.stems.vocals.replace(/^\/audio\//, "")));
      const timing = { sig, times: alignLines(lines, segs), dur, firstVoice: segs[0]?.[0] ?? 0 };
      await saveField(song.id, { timing });
      res.json(timing);
    } catch (e) {
      res.json({ times: [], approximate: true, error: e.message });
    }
  });

  // ===== Karaokê: junta a voz gravada pela pessoa com o playback e melhora a gravação =====
  let karaokeChain = Promise.resolve();
  const REVERBS = {
    igreja: "aecho=0.8:0.72:70|150|260:0.32|0.22|0.14",
    estudio: "aecho=0.8:0.6:35|80:0.18|0.1",
    seco: "",
  };
  app.post("/api/songs/:id/karaoke", async (req, res) => {
    const song = (await loadSongs()).find((s) => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: "Música não encontrada." });
    if (!song.stems?.instrumental) return res.status(400).json({ error: "Separe o playback (aba Faixas) antes do karaokê." });
    const b = req.body || {};
    const m = /^data:audio\/([\w.+-]+)(?:;[^,]*)?;base64,(.+)$/s.exec(String(b.audio || ""));
    if (!m) return res.status(400).json({ error: "Gravação inválida." });
    const offset = Math.max(-2, Math.min(3, Number(b.offset) || 0)); // segundos: positivo = a voz começou antes do playback
    const gain = Math.max(-12, Math.min(12, Number(b.voiceGain) || 0));
    const reverb = REVERBS[b.reverb] ?? REVERBS.igreja;
    const enhance = b.enhance !== false;
    const ext = m[1].includes("webm") ? "webm" : m[1].includes("ogg") ? "ogg" : m[1].includes("mp4") || m[1].includes("aac") ? "m4a" : "wav";

    const { id, set } = newJob();
    karaokeChain = karaokeChain.then(async () => {
      const newId = randomUUID();
      const dir = MEDIA(newId);
      try {
        set({ status: "generating", message: "Limpando e melhorando o som da sua voz…" });
        mkdirSync(dir, { recursive: true });
        const raw = path.join(dir, `voz-gravada.${ext}`);
        await fs.writeFile(raw, Buffer.from(m[2], "base64"));
        const inst = path.join(SONGS_DIR, song.stems.instrumental.replace(/^\/audio\//, ""));
        const align = offset > 0 ? [`atrim=start=${offset.toFixed(3)}`, "asetpts=PTS-STARTPTS"] : offset < 0 ? [`adelay=${Math.round(-offset * 1000)}`] : [];
        const voice = [
          "aresample=48000", "aformat=channel_layouts=mono", ...align,
          ...(enhance
            ? [
                "highpass=f=90", // tira ronco e vento
                "afftdn=nf=-25", // reduz chiado e ruído de fundo
                "equalizer=f=250:width_type=o:width=1:g=-2", // menos som "abafado"
                "equalizer=f=3500:width_type=o:width=1.5:g=3", // mais presença e clareza
                "deesser",
                "acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=3", // voz mais estável
              ]
            : []),
          ...(reverb ? [reverb] : []),
          `volume=${gain}dB`,
          "pan=stereo|c0=c0|c1=c0",
        ].join(",");
        const filter = [
          `[0:a]${voice}[v]`,
          "[1:a]aresample=48000,volume=-1.5dB[i]",
          "[v][i]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.2:LRA=11[out]",
        ].join(";");
        set({ message: "Juntando a sua voz com o playback…" });
        const out = path.join(SONGS_DIR, `${newId}.mp3`);
        await ffmpeg(["-i", raw, "-i", inst, "-filter_complex", filter, "-map", "[out]", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", out]);
        const mine = {
          ...song,
          id: newId,
          title: `${song.title} (minha voz)`,
          url: `/audio/${newId}.mp3`,
          createdAt: new Date().toISOString(),
          favorite: false,
          parentId: song.id,
          stems: undefined,
          karaoke: { voice: `/audio/media/${newId}/voz-gravada.${ext}`, reverb: b.reverb || "igreja", enhanced: enhance },
          spec: { ...(song.spec || {}), engine: "Karaokê · sua voz + playback (melhorada pelo ACAIAMUSIC)" },
        };
        await updateSongs((songs) => [mine, ...songs]);
        set({ status: "done", message: "Sua versão está pronta!", song: mine });
      } catch (e) {
        console.error("Erro karaokê:", e.message);
        fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        set({ status: "error", error: "Não consegui juntar a gravação: " + e.message.slice(0, 200) });
      }
    });
    res.json({ jobId: id });
  });

  // ===== Editor de áudio: cortar, fades, masterizar, tom e andamento (cria uma versão nova) =====
  let editChain = Promise.resolve();
  app.post("/api/songs/:id/edit", async (req, res) => {
    const song = (await loadSongs()).find((s) => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: "Música não encontrada." });
    const b = req.body || {};
    const dur = song.duration || 60;
    const start = Math.max(0, Math.min(dur - 3, Number(b.trimStart) || 0));
    const end = Math.max(start + 3, Math.min(dur, Number(b.trimEnd) || dur));
    const fadeIn = Math.max(0, Math.min(10, Number(b.fadeIn) || 0));
    const fadeOut = Math.max(0, Math.min(10, Number(b.fadeOut) || 0));
    const semitones = Math.max(-6, Math.min(6, Math.round(Number(b.semitones) || 0)));
    const tempo = Math.max(0.8, Math.min(1.25, Number(b.tempo) || 1));
    const master = b.master !== false;
    if (start === 0 && end >= dur && !fadeIn && !fadeOut && !semitones && tempo === 1 && !master)
      return res.status(400).json({ error: "Nenhuma alteração escolhida." });

    const { id, set } = newJob();
    editChain = editChain.then(async () => {
      try {
        set({ status: "generating", message: "Editando o áudio…" });
        const newId = randomUUID();
        const out = path.join(SONGS_DIR, `${newId}.mp3`);
        const len = (end - start) / tempo;
        const f = [`atrim=${start}:${end}`, "asetpts=PTS-STARTPTS", "aresample=48000"];
        if (semitones) {
          const r = Math.pow(2, semitones / 12);
          f.push(`asetrate=${Math.round(48000 * r)}`, "aresample=48000", `atempo=${(1 / r).toFixed(5)}`);
        }
        if (tempo !== 1) f.push(`atempo=${tempo.toFixed(3)}`);
        if (fadeIn) f.push(`afade=t=in:st=0:d=${fadeIn}`);
        if (fadeOut) f.push(`afade=t=out:st=${Math.max(0, len - fadeOut).toFixed(2)}:d=${fadeOut}`);
        if (master) f.push("acompressor=threshold=-18dB:ratio=2.5:attack=20:release=250", "loudnorm=I=-14:TP=-1.2:LRA=11");
        await ffmpeg(["-i", path.join(SONGS_DIR, `${song.id}.mp3`), "-af", f.join(","), "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", out]);
        const changes = [
          (start > 0 || end < dur) && `corte ${Math.round(start)}s–${Math.round(end)}s`,
          fadeIn && `fade in ${fadeIn}s`, fadeOut && `fade out ${fadeOut}s`,
          semitones && `tom ${semitones > 0 ? "+" : ""}${semitones} semitom(ns)`,
          tempo !== 1 && `andamento ${Math.round(tempo * 100)}%`, master && "masterizada",
        ].filter(Boolean);
        const edited = {
          ...song,
          id: newId,
          title: `${song.title} (editada)`,
          url: `/audio/${newId}.mp3`,
          duration: Math.round(len),
          createdAt: new Date().toISOString(),
          favorite: false,
          parentId: song.id,
          edit: { changes, semitones, tempo },
          stems: undefined,
          chords: semitones ? undefined : song.chords, // tom mudou: gere a cifra de novo no tom certo
        };
        if (edited.options && tempo !== 1 && edited.options.bpm) edited.options = { ...edited.options, bpm: Math.round(edited.options.bpm * tempo) };
        await updateSongs((songs) => [edited, ...songs]);
        set({ status: "done", message: "Versão editada pronta!", song: edited });
      } catch (e) {
        console.error("Erro edição:", e.message);
        set({ status: "error", error: "Não consegui editar o áudio: " + e.message.slice(0, 200) });
      }
    });
    res.json({ jobId: id });
  });

  // ===== Baixar em WAV (qualidade máxima) =====
  app.get("/api/songs/:id/wav", async (req, res) => {
    const song = (await loadSongs()).find((s) => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: "Música não encontrada." });
    const tmp = path.join(os.tmpdir(), `acaia-${randomUUID()}.wav`);
    try {
      await ffmpeg(["-i", path.join(SONGS_DIR, `${song.id}.mp3`), "-c:a", "pcm_s16le", "-ar", "48000", tmp]);
      const safe = (song.title || "musica").replace(/[\\/:*?"<>|]+/g, "").trim() || "musica";
      res.download(tmp, `${safe}.wav`, () => fs.rm(tmp, { force: true }).catch(() => {}));
    } catch (e) {
      fs.rm(tmp, { force: true }).catch(() => {});
      res.status(500).json({ error: "Não consegui converter para WAV." });
    }
  });

  return { mediaDir: MEDIA };
}
