// Ferramentas de estúdio: separação de faixas (Demucs) e vídeo para Status (ffmpeg)
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import { stemsToMp3, pitchFilters, tuningRatio } from "./audio.js";
import { getSettings } from "./kaggle.js";
import { animateCover, harmonize, illustrate } from "./hearing.js";
import { storyboard } from "./lyrics.js";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const STEMS_HOST = process.env.STEMS_HOST || "nakas-demucs-playground.hf.space";
const STEM_NAMES = ["vocals", "bass", "drums", "other"];

// ---------- Separação rápida: Demucs na GPU do seu estúdio no Modal (~20 s) ----------
export function modalSeparatorUrl() {
  const s = getSettings();
  if (s.modalSepUrl) return s.modalSepUrl;
  // ex.: https://conta--acaiamusic-estudio-estudio.us-east.modal.run -> ...-separar.us-east.modal.run
  const re = /-estudio((?:\.[a-z0-9-]+)?)\.modal\.run\/?$/;
  return re.test(s.modalUrl || "") ? s.modalUrl.replace(re, "-separar$1.modal.run") : "";
}
async function demucsModal(mp3Buffer, onStatus) {
  onStatus("Separando voz e instrumentos na GPU do seu estúdio (Modal)…");
  const r = await fetch(modalSeparatorUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: getSettings().modalKey, audio: mp3Buffer.toString("base64") }),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || !j.vocals) throw new Error(j.error || `o separador do Modal respondeu ${r.status}`);
  return ["vocals", "bass", "drums", "other"].map((n) => Buffer.from(j[n], "base64"));
}

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
// onTime(segundos) recebe o andamento (para mostrar a porcentagem)
function ffmpeg(args, timeoutMs = 5 * 60 * 1000, onTime) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", ...args], { windowsHide: true });
    let stderr = "", buf = "", killed = false;
    const t = setTimeout(() => ((killed = true), p.kill("SIGKILL")), timeoutMs);
    p.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const l of lines) {
        const m = /^out_time_us=(\d+)/.exec(l);
        if (m && onTime) onTime(Number(m[1]) / 1e6);
      }
    });
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    p.on("error", (e) => (clearTimeout(t), reject(e)));
    p.on("close", (code) => {
      clearTimeout(t);
      if (killed) return reject(new Error("a montagem demorou demais e foi cancelada"));
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg saiu com código ${code}`));
    });
  });
}

const int = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

export function registerStudio(app, { loadSongs, updateSongs, SONGS_DIR, jobs, HF_TOKEN, songTimeline, trackTask = () => {} }) {
  const MEDIA = (id) => path.join(SONGS_DIR, "media", id);
  let stemChain = Promise.resolve();
  let videoChain = Promise.resolve();

  const newJob = () => {
    const id = randomUUID();
    const job = { status: "waiting", message: "Aguardando…", createdAt: Date.now() };
    jobs.set(id, job);
    // cancelado pela fila: não atualiza mais (e as etapas seguintes são puladas)
    const set = (p) => {
      if (job.canceled) return;
      Object.assign(job, p, { updatedAt: Date.now() });
    };
    return { id, set, job };
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
        const status = (message) => set({ status: "generating", message });
        let wavs = null;
        if (modalSeparatorUrl()) {
          try {
            wavs = await demucsModal(mp3, status);
          } catch (e) {
            console.log("Separador do Modal falhou, usando o gratuito:", e.message);
          }
        }
        wavs ||= await demucs(mp3, HF_TOKEN, status);
        set({ status: "saving", message: "Mixando o playback e salvando em MP3…" });
        const dir = MEDIA(song.id);
        mkdirSync(dir, { recursive: true });
        const out = {};
        for (const name of await stemsToMp3(wavs, dir)) out[name] = `/audio/media/${song.id}/${name}.mp3`;
        await saveField(song.id, { stems: out });
        set({ status: "done", message: "Faixas separadas!", song: { ...song, stems: out } });
      } catch (e) {
        console.error("Erro separação:", e.message);
        set({ status: "error", error: e.message });
      }
    });
    res.json({ jobId: id });
  });

  // ===== Vídeo "história animada": a letra contada em cenas animadas, com a letra discreta embaixo =====
  // 1) linha do tempo da letra (Whisper) → 2) o trecho é dividido em cenas, nas trocas de verso →
  // 3) a IA escreve o roteiro (mesmo estilo e personagens) → 4) cada cena vira imagem e depois
  // animação na GPU (3 ao mesmo tempo) → 5) o ffmpeg junta as cenas com transições suaves, a letra
  // acendendo palavra por palavra (pequena, embaixo), o título discreto e uma barra fina.
  const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
  const filterPath = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const assTime = (s) => {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${h}:${String(m).padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
  };
  const assEsc = (t) => String(t).replace(/[{}\\]/g, "");
  function lyricsAss(lines, start, len, OW, OH, vertical) {
    const size = Math.round(vertical ? OW * 0.056 : OH * 0.05);
    const head = [
      "[Script Info]",
      "ScriptType: v4.00+",
      `PlayResX: ${OW}`,
      `PlayResY: ${OH}`,
      "WrapStyle: 0",
      "ScaledBorderAndShadow: yes",
      "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      `Style: Letra,Poppins SemiBold,${size},&H00FFFFFF,&H70FFFFFF,&H78000000,&H96000000,0,0,0,0,100,100,0.5,0,1,1.2,0.8,2,${Math.round(OW * 0.09)},${Math.round(OW * 0.09)},${Math.round(OH * (vertical ? 0.085 : 0.1))},1`,
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ].join("\n");
    const inWin = lines.filter((l) => l.end > start + 0.3 && l.t < start + len - 0.5);
    const ev = inWin.map((l, i) => {
      const a = Math.max(0, l.t - start - 0.3);
      const nextT = inWin[i + 1] ? inWin[i + 1].t - start - 0.3 : len;
      const b = Math.min(len - 0.2, Math.max(a + 1, Math.min(l.end - start + 0.8, nextT)));
      // \kf: cada palavra acende suavemente no tempo em que é cantada
      let txt = `{\\fad(220,220)}{\\k${Math.round(Math.max(0, l.t - start - a) * 100)}}`;
      l.words.forEach((w, k) => {
        const next = l.words[k + 1] ? l.words[k + 1][1] : w[2];
        txt += `{\\kf${Math.max(5, Math.round((next - w[1]) * 100))}}${assEsc(w[0])}${k < l.words.length - 1 ? " " : ""}`;
      });
      return `Dialogue: 0,${assTime(a)},${assTime(b)},Letra,,0,0,0,,${txt}`;
    });
    return head + "\n" + ev.join("\n") + "\n";
  }
  // divide o trecho em cenas de ~7 s, cortando nas entradas dos versos
  function storyScenes(lines, start, len, title) {
    const n = Math.max(4, Math.min(9, Math.round(len / 7)));
    const starts = lines.map((l) => l.t - start).filter((t) => t > 2 && t < len - 3);
    const cuts = [0];
    for (let k = 1; k < n; k++) {
      const target = (k * len) / n;
      const snap = starts.filter((t) => Math.abs(t - target) <= 2.5 && t - cuts.at(-1) >= 4).sort((x, y) => Math.abs(x - target) - Math.abs(y - target))[0];
      const c = snap ?? target;
      if (c - cuts.at(-1) >= 4 && len - c >= 4) cuts.push(Math.round(c * 100) / 100);
    }
    cuts.push(len);
    return cuts.slice(0, -1).map((a, i) => {
      const b = cuts[i + 1];
      const text = lines.filter((l) => l.end - start > a + 0.5 && l.t - start < b - 0.5).map((l) => l.text).join(" / ");
      return { a, b, dur: b - a, text: text || (i === 0 ? `abertura instrumental da música "${title}"` : `momento instrumental da música "${title}"`) };
    });
  }
  async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
          const i = next++;
          out[i] = await fn(items[i], i).catch((e) => ({ error: e }));
        }
      }),
    );
    return out;
  }
  async function storyVideo({ song, b, set, job, vertical, start, len, OW, OH, FPS, bar, overlayB64, id }) {
    const dir = MEDIA(song.id);
    mkdirSync(dir, { recursive: true });
    set({ status: "generating", message: "Ouvindo a música para sincronizar a letra…", progress: 2 });
    const tl = await songTimeline(song);
    const scenes = storyScenes(tl.lines, start, len, song.title);
    const tag = vertical ? "v" : "h";
    const key = `${tag}-${start}-${scenes.map((s) => s.text).join("|").length}-${scenes.length}`;
    const sdir = path.join(dir, `historia-${key}`);
    mkdirSync(sdir, { recursive: true });
    const manifestFile = path.join(sdir, "cenas.json");
    let manifest = existsSync(manifestFile) && !b.novo ? JSON.parse(await fs.readFile(manifestFile, "utf8")) : null;
    if (!manifest || manifest.scenes?.length !== scenes.length) {
      set({ status: "generating", message: "A IA está escrevendo o roteiro das cenas…", progress: 5 });
      const o = song.options || {};
      const board = await storyboard({ title: song.title, scenes: scenes.map((s) => s.text), mode: o.mode, moment: o.moment, season: o.season, genre: song.genre, moods: o.moods || [] });
      manifest = { scenes: scenes.map((s, i) => ({ ...s, ...board[i] })) };
      for (const old of await fs.readdir(sdir)) await fs.rm(path.join(sdir, old), { force: true });
      await fs.writeFile(manifestFile, JSON.stringify(manifest));
    }
    // imagens e animações (as que já existem são reaproveitadas)
    const began = Date.now();
    // limite para a animação: se a GPU do Modal estiver em fila, não deixa a pessoa esperando
    // meia hora; o que não ficou pronto até aqui sai com movimento de câmera na imagem
    const LIMIT = 8 * 60 * 1000;
    const until = began + LIMIT;
    let done = 0;
    const total = manifest.scenes.length;
    const tick = setInterval(() => {
      if (job?.canceled) return;
      const ms = Date.now() - began, s = Math.round(ms / 1000);
      const hint = s > 150 && done === 0 ? ` · a GPU está ocupada; em até ${Math.max(1, Math.ceil((LIMIT - ms) / 60000))} min sai de qualquer jeito` : " (uns 3 a 5 min na 1ª vez)";
      // a barra anda pelo tempo também, para não parecer travada
      set({ status: "generating", message: `Animando as cenas com IA: ${done} de ${total} prontas · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}${hint}`, progress: Math.min(70, 8 + Math.floor(Math.max((done / total) * 62, (ms / LIMIT) * 62))) });
    }, 3000);
    try {
      await pool(manifest.scenes, 3, async (sc, i) => {
        if (job?.canceled) return;
        const img = path.join(sdir, `cena${i}.png`), clip = path.join(sdir, `cena${i}.mp4`);
        if (!existsSync(img)) await fs.writeFile(img, await illustrate(sc.image));
        if (!existsSync(clip) && Date.now() < until - 60000) {
          try {
            await fs.writeFile(clip, await animateCover(await fs.readFile(img), sc.motion, vertical ? "vertical" : "horizontal", { story: true, frames: 121, until }));
          } catch (e) {
            console.log(`História: a cena ${i + 1} ficou sem animação (vai com movimento de câmera):`, e.message);
          }
        }
        done++;
      });
    } finally {
      clearInterval(tick);
    }
    if (job?.canceled) throw new Error("cancelado");
    if (!manifest.scenes.some((_, i) => existsSync(path.join(sdir, `cena${i}.png`)))) throw new Error("as imagens das cenas não foram criadas (o ilustrador está indisponível agora)");
    // montagem
    const ass = path.join(os.tmpdir(), `acaia-${id}.ass`);
    const ovl = path.join(os.tmpdir(), `acaia-${id}-ov.png`);
    await fs.writeFile(ass, lyricsAss(tl.lines, start, len, OW, OH, vertical));
    if (overlayB64) await fs.writeFile(ovl, Buffer.from(overlayB64, "base64"));
    const X = 0.6; // duração de cada transição
    const TRANS = ["fade", "smoothleft", "fadeblack", "circleopen", "smoothup", "dissolve", "slideleft", "fade", "radial"];
    const inputs = [], filters = [];
    let k = 2; // 0: camada de cima, 1: áudio
    manifest.scenes.forEach((sc, i) => {
      const clip = path.join(sdir, `cena${i}.mp4`);
      let img = path.join(sdir, `cena${i}.png`);
      if (!existsSync(img)) img = path.join(sdir, `cena${manifest.scenes.findIndex((_, j) => existsSync(path.join(sdir, `cena${j}.png`)))}.png`);
      const D = sc.dur + (i < total - 1 ? X : 0);
      const base = `scale=${OW}:${OH}:force_original_aspect_ratio=increase,crop=${OW}:${OH},setsar=1`;
      if (existsSync(clip)) {
        // a cena (5 s) é levemente desacelerada para preencher o tempo; se faltar, segura o último quadro
        const slow = Math.min(1.6, Math.max(1, D / 5.04));
        inputs.push("-i", clip);
        filters.push(`[${k}:v]setpts=${slow.toFixed(3)}*PTS,${base},fps=${FPS},tpad=stop_mode=clone:stop_duration=${Math.ceil(D)},trim=duration=${D.toFixed(2)},setpts=PTS-STARTPTS,format=yuv420p[s${i}]`);
      } else {
        // sem animação: aproximação lenta na imagem (movimento de câmera)
        inputs.push("-loop", "1", "-framerate", String(FPS), "-t", D.toFixed(2), "-i", img);
        filters.push(`[${k}:v]scale=${Math.round(OW * 1.18)}:${Math.round(OH * 1.18)}:force_original_aspect_ratio=increase,crop=${OW}:${OH}:x='(iw-ow)/2*(1-0.6*t/${D.toFixed(2)})':y='(ih-oh)/2',setsar=1,fps=${FPS},trim=duration=${D.toFixed(2)},setpts=PTS-STARTPTS,format=yuv420p[s${i}]`);
      }
      k++;
    });
    let lastLabel = "s0", acc = 0;
    for (let i = 1; i < total; i++) {
      acc += manifest.scenes[i - 1].dur;
      filters.push(`[${lastLabel}][s${i}]xfade=transition=${TRANS[(i - 1) % TRANS.length]}:duration=${X}:offset=${acc.toFixed(2)}[x${i}]`);
      lastLabel = `x${i}`;
    }
    filters.push(
      `[0:v]scale=${OW}:${OH},format=rgba[ov]`,
      `[${lastLabel}][ov]overlay=0:0,subtitles=filename='${filterPath(ass)}':fontsdir='${filterPath(FONTS)}',fade=t=in:st=0:d=0.8,fade=t=out:st=${len - 1}:d=1[bg]`,
      `[1:a]atrim=0:${len},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1,afade=t=out:st=${len - 2}:d=2,aformat=channel_layouts=stereo[aout]`,
      `color=c=white@0.18:s=${bar.w}x${bar.h}:r=${FPS}:d=${len},format=yuva420p[track]`,
      `color=c=0xf9a8d4:s=${bar.w}x${bar.h}:r=${FPS}:d=${len}[fill]`,
      `[track][fill]overlay=x='-w+w*t/${len}':y=0:shortest=1[barv]`,
      `[bg][barv]overlay=${bar.x}:${bar.y}:shortest=1,format=yuv420p[vout]`,
    );
    const name = `video-${vertical ? "vertical" : "horizontal"}-${start}-historia.mp4`;
    let lastPct = -1;
    try {
      await ffmpeg(
        [
          "-threads", "1", "-filter_complex_threads", "1",
          "-loop", "1", "-framerate", String(FPS), "-t", String(len), "-i", overlayB64 ? ovl : path.join(sdir, "cena0.png"),
          "-ss", String(start), "-t", String(len), "-i", path.join(SONGS_DIR, `${song.id}.mp3`),
          ...inputs,
          "-filter_complex", filters.join(";"),
          "-map", "[vout]", "-map", "[aout]",
          "-t", String(len), "-r", String(FPS),
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "27", "-threads", "1",
          "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
          path.join(dir, name),
        ],
        20 * 60 * 1000,
        (secs) => {
          const pct = Math.min(99, Math.floor((secs / len) * 100));
          if (pct !== lastPct) set({ status: "generating", message: `Montando a história animada… ${pct}%`, progress: Math.floor(72 + pct * 0.28) }), (lastPct = pct);
        },
      );
    } finally {
      fs.rm(ass, { force: true }).catch(() => {});
      fs.rm(ovl, { force: true }).catch(() => {});
    }
    const animated = manifest.scenes.filter((_, i) => existsSync(path.join(sdir, `cena${i}.mp4`))).length;
    // ?v=: o nome do arquivo se repete, então muda o endereço para o navegador não mostrar o vídeo antigo
    return { url: `/audio/media/${song.id}/${name}?v=${Date.now()}`, animated, total, approximate: tl.approximate };
  }

  // tom da música: tônica (0 = Dó) e se é menor
  function toneOf(s) {
    const raw = String(s.hearing?.key || s.chords?.key || s.options?.key || "").trim();
    const m = /^([A-Ga-g](?:#|b)?)\s*(m(?!aj)|min|minor)?/.exec(raw);
    if (!m) return null;
    const n = m[1][0].toUpperCase() + m[1].slice(1);
    if (NOTES[n] == null) return null;
    return { tonic: NOTES[n], minor: Boolean(m[2]) || /minor/i.test(raw), name: raw.replace(/ major/i, "").replace(/ minor/i, "m") };
  }
  // ===== Medley: trechos de 2 a 4 músicas, no mesmo tom, emendados com transição suave =====
  // De cada música entra o trecho do refrão (pela linha do tempo da letra); as outras são levadas
  // ao tom da 1ª (mudando o tom sem mudar o andamento) e a passagem é um cruzamento de 3 s.
  const NOTES = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
  function songKey(s) {
    const raw = String(s.hearing?.key || s.chords?.key || s.options?.key || "").trim();
    const m = /^([A-G](?:#|b)?)\s*(m(?!aj)|min|minor)?/i.exec(raw.replace(/^([a-g])/, (c) => c.toUpperCase()));
    if (!m || NOTES[m[1]] == null) return null;
    let pc = NOTES[m[1]];
    const minor = Boolean(m[2]) || /minor/i.test(raw);
    if (minor) pc = (pc + 3) % 12; // compara pelo tom maior relativo (Em ~ G)
    return { pc, name: raw };
  }
  function excerptOf(s, tl, seconds) {
    const d = Number(s.duration) || 120;
    const lines = tl.lines || [];
    const chorus = lines.find((l) => /refr|chorus|resposta|ant[ií]fona/i.test(l.sec)) || lines.find((l) => l.t > 5) || lines[0];
    let a = chorus ? Math.max(0, chorus.t - 1.5) : Math.min(15, d * 0.15);
    if (a + seconds > d - 1) a = Math.max(0, d - 1 - seconds);
    // termina no fim de um verso (perto do tempo pedido), para não cortar no meio da frase
    const target = a + seconds;
    const ends = lines.map((l) => l.end + 0.8).filter((e) => e > a + seconds * 0.6 && e < Math.min(d, target + 6));
    const b = Math.min(d, ends.length ? ends.reduce((x, y) => (Math.abs(y - target) < Math.abs(x - target) ? y : x)) : target);
    const sung = lines.filter((l) => l.t >= a - 0.3 && l.end <= b + 0.5).map((l) => l.text);
    return { a: Math.round(a * 100) / 100, b: Math.round(b * 100) / 100, lines: sung.filter((t, i) => sung.indexOf(t) === i) };
  }
  app.post("/api/medley", async (req, res) => {
    const b = req.body || {};
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 4);
    const all = await loadSongs();
    const songs = ids.map((id) => all.find((s) => s.id === id)).filter(Boolean);
    if (songs.length < 2) return res.status(400).json({ error: "Escolha de 2 a 4 músicas para o medley." });
    const seconds = int(b.seconds, 20, 90, 45);
    const { id, set } = newJob();
    videoChain = videoChain.then(async () => {
      const tmp = [];
      try {
        const parts = [];
        for (const [k, s] of songs.entries()) {
          set({ status: "generating", message: `Achando o refrão de “${s.title}” (${k + 1} de ${songs.length})…`, progress: Math.round((k / songs.length) * 40) });
          const tl = await songTimeline(s);
          parts.push({ s, ...excerptOf(s, tl, seconds) });
        }
        // tom: todas vão para o tom da 1ª (o menor caminho, até 6 semitons)
        const k0 = songKey(songs[0]);
        for (const p of parts) {
          const k = songKey(p.s);
          let shift = k0 && k ? (k0.pc - k.pc + 12) % 12 : 0;
          if (shift > 6) shift -= 12;
          p.shift = shift;
        }
        const X = 3; // segundos de cruzamento entre as músicas
        set({ status: "generating", message: "Emendando as músicas no mesmo tom…", progress: 45 });
        // 1) cada trecho cortado e no tom certo (WAV), 2) tudo emendado com cruzamento
        for (const [i, p] of parts.entries()) {
          const out = path.join(os.tmpdir(), `acaia-${id}-${i}.wav`);
          tmp.push(out);
          const len = p.b - p.a;
          const fade = `afade=t=in:st=0:d=${i ? 0.4 : 1.5},afade=t=out:st=${(len - (i < parts.length - 1 ? 0.4 : 3)).toFixed(2)}:d=${i < parts.length - 1 ? 0.4 : 3}`;
          const pitch = p.shift ? `rubberband=pitch=${Math.pow(2, p.shift / 12).toFixed(5)}:formant=preserved,` : "";
          const args = (pf) => ["-ss", String(p.a), "-t", len.toFixed(2), "-i", path.join(SONGS_DIR, `${p.s.id}.mp3`), "-af", `aresample=44100,aformat=channel_layouts=stereo,${pf}${fade}`, "-c:a", "pcm_s16le", out];
          try {
            await ffmpeg(args(pitch));
          } catch (e) {
            if (!pitch) throw e;
            // sem o rubberband: muda o tom pela taxa de amostragem e corrige o andamento
            const r = Math.pow(2, p.shift / 12);
            console.log("Medley: rubberband indisponível, usando o método simples:", e.message.slice(0, 120));
            await ffmpeg(args(`asetrate=${Math.round(44100 * r)},aresample=44100,atempo=${(1 / r).toFixed(5)},`));
          }
          set({ status: "generating", message: "Emendando as músicas no mesmo tom…", progress: 45 + Math.round(((i + 1) / parts.length) * 35) });
        }
        const newId = randomUUID();
        const inputs = tmp.flatMap((f) => ["-i", f]);
        let chain = "[0:a]";
        const filters = [];
        for (let i = 1; i < tmp.length; i++) {
          filters.push(`${chain}[${i}:a]acrossfade=d=${X}:c1=tri:c2=tri[m${i}]`);
          chain = `[m${i}]`;
        }
        filters.push(`${chain}loudnorm=I=-14:TP=-1.2:LRA=11[out]`);
        set({ status: "saving", message: "Salvando o medley…", progress: 85 });
        await ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", path.join(SONGS_DIR, `${newId}.mp3`)], 10 * 60 * 1000);
        const total = parts.reduce((a, p) => a + (p.b - p.a), 0) - X * (parts.length - 1);
        const first = songs[0];
        const medley = {
          id: newId,
          title: String(b.title || "").trim().slice(0, 120) || `Medley: ${songs.map((s) => s.title).join(" · ")}`.slice(0, 160),
          styles: [],
          sections: parts.map((p) => ({ name: p.s.title.slice(0, 40), lines: p.lines.length ? p.lines : ["♪"] })),
          references: [],
          notes: `Medley no tom de ${k0?.name || "da 1ª música"}: ${parts.map((p) => `${p.s.title} (${Math.round(p.b - p.a)} s${p.shift ? `, ${p.shift > 0 ? "+" : ""}${p.shift} semitons` : ""})`).join(" → ")}.`,
          genre: "Medley",
          ...(first.keyboard ? { keyboard: first.keyboard } : {}),
          mood: first.mood || "",
          voice: first.voice,
          options: { ...(first.options || {}), key: first.options?.key || "" },
          cover: Math.floor(Math.random() * 1e6),
          favorite: false,
          duration: Math.round(total),
          createdAt: new Date().toISOString(),
          spec: { medley: parts.map((p) => ({ id: p.s.id, title: p.s.title, start: p.a, end: p.b, shift: p.shift })), lyricsSource: first.spec?.lyricsSource || "ia", language: first.spec?.language || "pt", engine: "Medley (trechos das músicas)" },
          url: `/audio/${newId}.mp3`,
        };
        await updateSongs((list) => [medley, ...list]);
        set({ status: "done", message: "Medley pronto!", song: medley, progress: 100 });
      } catch (e) {
        console.error("Erro medley:", e.message);
        set({ status: "error", error: "Não consegui montar o medley: " + e.message.slice(0, 200) });
      } finally {
        for (const f of tmp) fs.rm(f, { force: true }).catch(() => {});
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
    // clipe animado: camada de cima transparente (textos) + clipe da imagem do tema por baixo
    const om = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.overlay || ""));
    const ill = om && song.illustration?.file ? song.illustration : null;
    const start = int(b.start, 0, Math.max(0, (song.duration || 60) - 5), 0);
    const len = Math.min(60, Math.max(5, (song.duration || 60) - start));
    const L = b.layout || {};
    const wave = { x: int(L.wave?.x, 0, W, 40), y: int(L.wave?.y, 0, H, H - 360), w: int(L.wave?.w, 16, W, W - 80), h: int(L.wave?.h, 16, H, 150) };
    const bar = { x: int(L.bar?.x, 0, W, 40), y: int(L.bar?.y, 0, H, H - 170), w: int(L.bar?.w, 16, W, W - 80), h: int(L.bar?.h, 2, 40, 8) };
    // O servidor grátis tem pouca CPU e memória: o vídeo sai em 2/3 do tamanho da arte (480p,
    // ótimo para o Status), 20 quadros/s e codificação leve. Antes, em 720p/30 fps, o ffmpeg
    // acumulava memória até travar e era cancelado.
    const k = 2 / 3, FPS = 20;
    const sc = (v) => Math.round(v * k);
    const even = (v) => v - (v % 2);
    const OW = even(sc(W) + 1), OH = even(sc(H) + 1);
    for (const o of [wave, bar]) for (const p of ["x", "y", "w", "h"]) o[p] = sc(o[p]);
    wave.w = even(Math.max(16, wave.w));
    wave.h = Math.max(16, wave.h - (wave.h % 4));
    bar.w = even(Math.max(16, bar.w));
    bar.h = Math.max(2, even(bar.h));
    const half = wave.h / 2;

    const { id, set, job } = newJob();
    // entra na fila de criação (a pessoa pode fechar a janela e continuar usando o app)
    trackTask({ id, label: `🎬 ${b.story ? "História animada" : "Vídeo"} · ${song.title}`, songId: song.id, kind: "video" });
    if (b.story) {
      videoChain = videoChain.then(async () => {
        try {
          // barra de progresso fina, colada na borda de baixo (discreta)
          const r = await storyVideo({ song, b, set, job, vertical, start, len, OW, OH, FPS, bar: { x: 0, y: OH - 4, w: OW, h: 4 }, overlayB64: om?.[1], id });
          const warn = r.animated < r.total ? ` (${r.total - r.animated} de ${r.total} cenas só com movimento de câmera)` : "";
          if (job.canceled) return;
          // guarda na música: ao abrir de novo (ou recarregar a página) o vídeo continua lá
          await saveField(song.id, { video: { url: r.url, at: new Date().toISOString() } }).catch(() => {});
          set({ status: "done", message: `História animada pronta!${warn}`, url: r.url, songId: song.id });
        } catch (e) {
          console.error("Erro história animada:", e.message);
          set({ status: "error", error: "Não consegui montar a história animada: " + e.message.slice(0, 200) });
        }
      });
      return res.json({ jobId: id });
    }
    videoChain = videoChain.then(async () => {
      const tmp = path.join(os.tmpdir(), `acaia-${id}.png`);
      try {
        set({ status: "generating", message: "Montando o vídeo…" });
        const dir = MEDIA(song.id);
        mkdirSync(dir, { recursive: true });
        // 1) clipe da capa (feito uma vez por imagem e formato, depois reaproveitado)
        let clipFile = null, clipError = "", clipMade = false;
        if (ill) {
          const tag = vertical ? "v" : "h";
          const f = path.join(dir, `clipe-${tag}-${path.parse(ill.file).name}.mp4`);
          if (existsSync(f)) clipFile = f;
          else {
            const began = Date.now();
            const tick = setInterval(() => {
              const s = Math.round((Date.now() - began) / 1000);
              // de 0 a 60%: a GPU criando o clipe (estimativa de ~2 min, contando a GPU ligar)
              set({ status: "generating", message: `Criando o clipe animado da capa com IA… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} (leva de 1 a 2 min)`, progress: Math.min(60, Math.floor((s / 120) * 60)) });
            }, 3000);
            try {
              const vid = await animateCover(await fs.readFile(path.join(dir, ill.file)), ill.prompt || song.title, vertical ? "vertical" : "horizontal");
              for (const old of await fs.readdir(dir)) if (old.startsWith(`clipe-${tag}-`)) await fs.rm(path.join(dir, old), { force: true });
              await fs.writeFile(f, vid);
              clipFile = f;
              clipMade = true;
            } catch (e) {
              clipError = e.message;
              console.log("Clipe da capa falhou, vídeo com a imagem parada:", e.message);
            } finally {
              clearInterval(tick);
            }
          }
        }
        const p0 = clipMade ? 60 : 0; // a barra continua de onde o clipe parou
        await fs.writeFile(tmp, Buffer.from((clipFile ? om : m)[1], "base64"));
        const name = `video-${vertical ? "vertical" : "horizontal"}-${start}${clipFile ? "-clipe" : ""}.mp4`;
        const filter = [
          ...(clipFile
            ? [
                `[2:v]scale=${OW}:${OH}:force_original_aspect_ratio=increase,crop=${OW}:${OH},fps=${FPS},setsar=1,format=yuv420p[clipv]`,
                `[0:v]scale=${OW}:${OH},format=rgba[ov]`,
                `[clipv][ov]overlay=0:0:shortest=1,format=yuv420p,fade=t=in:st=0:d=0.8,fade=t=out:st=${len - 1}:d=1[bg]`,
              ]
            : [`[0:v]scale=${OW}:${OH},setsar=1,format=yuv420p,fade=t=in:st=0:d=0.8,fade=t=out:st=${len - 1}:d=1[bg]`]),
          `[1:a]atrim=0:${len},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1,afade=t=out:st=${len - 2}:d=2,aformat=channel_layouts=stereo,asplit=2[aout][av]`,
          // equalizador (barras de frequência) com reflexo
          `[av]aformat=channel_layouts=mono,showfreqs=s=${wave.w}x${half}:mode=bar:ascale=cbrt:fscale=log:colors=0xf472b6:win_size=1024:rate=${FPS},format=yuva420p,split[f1][f2]`,
          `[f2]vflip,colorchannelmixer=aa=0.3[f2r]`,
          `[f1][f2r]vstack[wv]`,
          // barra de progresso: o preenchimento anda dentro do trilho
          `color=c=white@0.2:s=${bar.w}x${bar.h}:r=${FPS}:d=${len},format=yuva420p[track]`,
          `color=c=0xec4899:s=${bar.w}x${bar.h}:r=${FPS}:d=${len}[fill]`,
          `[track][fill]overlay=x='-w+w*t/${len}':y=0:shortest=1[barv]`,
          `[bg][wv]overlay=${wave.x}:${wave.y}:shortest=1[v1]`,
          `[v1][barv]overlay=${bar.x}:${bar.y}:shortest=1,format=yuv420p[vout]`,
        ].join(";");
        let lastPct = -1;
        await ffmpeg(
          [
            "-threads", "1", "-filter_complex_threads", "1",
            "-loop", "1", "-framerate", String(FPS), "-t", String(len), "-i", tmp,
            "-ss", String(start), "-t", String(len), "-i", path.join(SONGS_DIR, `${song.id}.mp3`),
            ...(clipFile ? ["-stream_loop", "-1", "-t", String(len), "-i", clipFile] : []),
            "-filter_complex", filter,
            "-map", "[vout]", "-map", "[aout]",
            "-t", String(len), "-r", String(FPS),
            "-c:v", "libx264", "-preset", "ultrafast", ...(clipFile ? [] : ["-tune", "stillimage"]), "-crf", "28", "-threads", "1",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
            path.join(dir, name),
          ],
          20 * 60 * 1000,
          (secs) => {
            const pct = Math.min(99, Math.floor((secs / len) * 100));
            if (pct !== lastPct) set({ status: "generating", message: `Montando o vídeo${clipFile ? " com o clipe" : ""}… ${pct}%`, progress: Math.floor(p0 + (pct * (100 - p0)) / 100) }), (lastPct = pct);
          },
        );
        const url = `/audio/media/${song.id}/${name}?v=${Date.now()}`;
        if (job.canceled) return;
        await saveField(song.id, { video: { url, at: new Date().toISOString() } }).catch(() => {});
        set({ status: "done", message: clipError ? `Vídeo pronto, com a imagem parada (o clipe não deu certo: ${clipError.slice(0, 120)})` : "Vídeo pronto!", url, clipError: clipError || undefined });
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
    // dueto: a IA canta a 2ª voz (terça acima ou abaixo) junto com a sua
    const duet = b.duet === "up" || b.duet === "down" ? b.duet : "";
    const tone = duet ? toneOf(song) : null;
    if (duet && !song.stems?.vocals) return res.status(400).json({ error: "Para o dueto, separe as faixas (aba Faixas) primeiro." });
    if (duet && !tone) return res.status(400).json({ error: "Não sei o tom desta música para fazer a 2ª voz. Gere a cifra (aba Cifra) e tente de novo." });
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
        let harm = null;
        if (duet) {
          set({ message: `A IA está cantando a 2ª voz (terça ${duet === "up" ? "acima" : "abaixo"}, no tom de ${tone.name})… leva 1 a 3 min` });
          const voc = await fs.readFile(path.join(SONGS_DIR, song.stems.vocals.replace(/^\/audio\//, "")));
          harm = path.join(dir, "segunda-voz-ia.flac");
          await fs.writeFile(harm, await harmonize(voc, { tonic: tone.tonic, minor: tone.minor, dir: duet }));
        }
        // a 2ª voz entra um pouco mais baixa e levemente para o lado, com o mesmo ambiente
        const harmChain = ["aresample=48000", "aformat=channel_layouts=mono", "highpass=f=110", "equalizer=f=3000:width_type=o:width=1.5:g=-2", ...(reverb ? [reverb] : []), "volume=-5dB", "pan=stereo|c0=0.8*c0|c1=1.0*c0"].join(",");
        const filter = [
          `[0:a]${voice}[v]`,
          "[1:a]aresample=48000,volume=-1.5dB[i]",
          ...(harm ? [`[2:a]${harmChain}[h]`, "[v][i][h]amix=inputs=3:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.2:LRA=11[out]"] : ["[v][i]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.2:LRA=11[out]"]),
        ].join(";");
        set({ message: harm ? "Juntando a sua voz, a 2ª voz da IA e o playback…" : "Juntando a sua voz com o playback…" });
        const out = path.join(SONGS_DIR, `${newId}.mp3`);
        await ffmpeg(["-i", raw, "-i", inst, ...(harm ? ["-i", harm] : []), "-filter_complex", filter, "-map", "[out]", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", out]);
        const mine = {
          ...song,
          id: newId,
          title: `${song.title} (${duet ? "dueto com a IA" : "minha voz"})`,
          url: `/audio/${newId}.mp3`,
          createdAt: new Date().toISOString(),
          favorite: false,
          parentId: song.id,
          stems: undefined,
          karaoke: { voice: `/audio/media/${newId}/voz-gravada.${ext}`, reverb: b.reverb || "igreja", enhanced: enhance, ...(duet ? { duet, key: tone.name } : {}) },
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

  // ===== Afinação 432 / 528 / 440 Hz de uma música pronta (cria uma música nova; sem GPU) =====
  const TUNE_LABEL = { 440: "440 Hz", 432: "432 Hz", 528: "528 Hz" };
  app.post("/api/songs/:id/retune", async (req, res) => {
    const song = (await loadSongs()).find((s) => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: "Música não encontrada." });
    const to = String(req.body?.tuning || "");
    if (!TUNE_LABEL[to]) return res.status(400).json({ error: "Escolha a afinação." });
    const from = song.spec?.tuning || "440";
    if (to === from) return res.status(400).json({ error: `Esta música já está em ${TUNE_LABEL[to]}.` });
    const { id, set } = newJob();
    editChain = editChain.then(async () => {
      const newId = randomUUID();
      try {
        set({ status: "generating", message: `Afinando em ${TUNE_LABEL[to]}…`, progress: 10 });
        const src = path.join(SONGS_DIR, `${song.id}.mp3`), out = path.join(SONGS_DIR, `${newId}.mp3`);
        let ok = false;
        for (const p of pitchFilters(tuningRatio(to, from))) {
          try {
            await ffmpeg(["-i", src, "-af", `aresample=44100,${p}alimiter=limit=0.89`, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "256k", out], 10 * 60 * 1000);
            ok = true;
            break;
          } catch (e) {
            console.log("Afinação: tentando o método simples:", e.message.slice(0, 100));
          }
        }
        if (!ok) throw new Error("não consegui mudar a afinação");
        const base = song.title.replace(/\s*\((432|528|440) Hz\)$/, "");
        const copy = {
          ...song,
          id: newId,
          title: to === "440" ? `${base} (440 Hz)` : `${base} (${TUNE_LABEL[to]})`,
          url: `/audio/${newId}.mp3`,
          createdAt: new Date().toISOString(),
          favorite: false,
          parentId: song.id,
          stems: undefined,
          alt: undefined,
          timing: undefined,
          lastVideo: undefined,
          spec: { ...(song.spec || {}), tuning: to === "440" ? undefined : to, engine: `${song.spec?.engine || "ACAIAMUSIC"} · afinada em ${TUNE_LABEL[to]}` },
        };
        await updateSongs((songs) => [copy, ...songs]);
        set({ status: "done", message: `Pronta em ${TUNE_LABEL[to]}!`, song: copy, progress: 100 });
      } catch (e) {
        fs.rm(path.join(SONGS_DIR, `${newId}.mp3`), { force: true }).catch(() => {});
        set({ status: "error", error: "Não consegui mudar a afinação: " + e.message.slice(0, 200) });
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
