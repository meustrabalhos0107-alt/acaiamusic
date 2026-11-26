// Utilidades de áudio: ler WAV (PCM 16 bits) e codificar MP3
import { Mp3Encoder } from "@breezystack/lamejs";

export function parseWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("não é WAV");
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    if (id === "data") data = buf.subarray(pos + 8, Math.min(buf.length, pos + 8 + size));
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("WAV inválido");
  const n = fmt.channels;
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytes * n));
  const left = new Int16Array(frames);
  const right = new Int16Array(frames);
  const read = (o) => {
    if (fmt.bits === 16) return data.readInt16LE(o);
    if (fmt.bits === 32 && fmt.format === 3) return Math.max(-32768, Math.min(32767, Math.round(data.readFloatLE(o) * 32767)));
    if (fmt.bits === 32) return data.readInt32LE(o) >> 16;
    if (fmt.bits === 24) return (data.readIntLE(o, 3) >> 8);
    throw new Error(`WAV de ${fmt.bits} bits não suportado`);
  };
  for (let i = 0; i < frames; i++) {
    const o = i * bytes * n;
    left[i] = read(o);
    right[i] = n > 1 ? read(o + bytes) : left[i];
  }
  return { rate: fmt.rate, left, right, seconds: frames / fmt.rate };
}

export function encodeMp3({ left, right, rate }, kbps = 192) {
  const enc = new Mp3Encoder(2, rate, kbps);
  const parts = [];
  const BLOCK = 1152 * 20;
  for (let i = 0; i < left.length; i += BLOCK) {
    const chunk = enc.encodeBuffer(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK));
    if (chunk.length) parts.push(Buffer.from(chunk));
  }
  parts.push(Buffer.from(enc.flush()));
  return Buffer.concat(parts);
}

export function wavToMp3(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF") return { mp3: buf, seconds: 0 }; // já é MP3
  const pcm = parseWav(buf);
  return { mp3: encodeMp3(pcm), seconds: pcm.seconds };
}

// Soma várias faixas (mesma taxa) com limitação para não estourar
export function mixTracks(tracks) {
  const len = Math.min(...tracks.map((t) => t.left.length));
  const left = new Int16Array(len);
  const right = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    let l = 0, r = 0;
    for (const t of tracks) {
      l += t.left[i];
      r += t.right[i];
    }
    left[i] = Math.max(-32768, Math.min(32767, l));
    right[i] = Math.max(-32768, Math.min(32767, r));
  }
  return { rate: tracks[0].rate, left, right, seconds: len / tracks[0].rate };
}

// ---------- Masterização (ffmpeg) ----------
// Deixa a música no padrão das plataformas de streaming: tira o ronco grave, limpa o "embolado"
// dos médios-graves, dá brilho leve, cola a mixagem com compressão suave e acerta o volume em
// -13 LUFS (perto do padrão do Spotify/YouTube, com presença no celular) sem estourar (pico máximo -1 dBTP). Duas passadas:
// a 1ª mede a música, a 2ª aplica a correção exata (mais natural que a correção "ao vivo").
import { spawn as spawnProc } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpegBin from "ffmpeg-static";

function runFfmpeg(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const p = spawnProc(ffmpegBin, ["-hide_banner", "-nostats", "-y", "-threads", "1", ...args], { windowsHide: true });
    try { os.setPriority(p.pid, 19); } catch {} // prioridade baixa: o app continua respondendo
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-20000)));
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", (e) => (clearTimeout(t), reject(e)));
    p.on("close", (code) => (clearTimeout(t), code === 0 ? resolve(err) : reject(new Error(err.trim().split("\n").pop() || `ffmpeg ${code}`))));
  });
}

// Faixas separadas (voz, bateria, baixo, outros: WAV ou MP3) -> MP3 de cada uma + playback
// (bateria + baixo + outros). Tudo no ffmpeg, fora do processo do app: em JavaScript isso
// travava o servidor grátis por minutos.
export async function stemsToMp3(files, dir) {
  const id = randomUUID();
  const names = ["vocals", "bass", "drums", "other"];
  const srcs = names.map((n) => path.join(os.tmpdir(), `acaia-stem-${id}-${n}`));
  await Promise.all(files.slice(0, 4).map((b, i) => fsp.writeFile(srcs[i], b)));
  try {
    const enc = ["-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k"];
    await runFfmpeg(["-i", srcs[1], "-i", srcs[2], "-i", srcs[3], "-filter_complex", "amix=inputs=3:normalize=0:duration=longest,alimiter=limit=0.95", ...enc, path.join(dir, "instrumental.mp3")], 300000);
    for (const [i, n] of names.entries()) await runFfmpeg(["-i", srcs[i], ...enc, path.join(dir, `${n}.mp3`)], 300000);
  } finally {
    await Promise.all(srcs.map((s) => fsp.rm(s, { force: true })));
  }
  return ["instrumental", ...names];
}

const TONE = "highpass=f=28,equalizer=f=280:t=q:w=1.2:g=-1.5,treble=g=1.5:f=9500,acompressor=threshold=-20dB:ratio=1.8:attack=25:release=280:makeup=1.5";

export async function master(buf) {
  const id = randomUUID();
  const src = path.join(os.tmpdir(), `acaia-src-${id}`);
  const out = path.join(os.tmpdir(), `acaia-master-${id}.mp3`);
  try {
    await fsp.writeFile(src, buf);
    const log1 = await runFfmpeg(["-i", src, "-af", `${TONE},loudnorm=I=-13:TP=-1:LRA=11:print_format=json`, "-f", "null", "-"]);
    const m = JSON.parse(log1.slice(log1.lastIndexOf("{"), log1.lastIndexOf("}") + 1));
    const ln = `loudnorm=I=-13:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    const log2 = await runFfmpeg(["-i", src, "-af", `${TONE},${ln}`, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "256k", out]);
    const d = /time=(\d+):(\d+):([\d.]+)/g;
    let secs = 0;
    for (const x of log2.matchAll(d)) secs = Number(x[1]) * 3600 + Number(x[2]) * 60 + Number(x[3]);
    return { mp3: await fsp.readFile(out), seconds: secs, mastered: true };
  } finally {
    fsp.rm(src, { force: true }).catch(() => {});
    fsp.rm(out, { force: true }).catch(() => {});
  }
}

// Masteriza; se o ffmpeg falhar por qualquer motivo, salva a música como veio (nunca perde a música)
export async function masterOrPlain(buf) {
  try {
    return await master(buf);
  } catch (e) {
    console.log("Masterização pulada:", e.message);
  }
  // reserva: só converte para MP3, também à parte (nunca dentro do processo do app)
  const id = randomUUID();
  const src = path.join(os.tmpdir(), `acaia-plain-${id}`), out = src + ".mp3";
  try {
    await fsp.writeFile(src, buf);
    await runFfmpeg(["-i", src, "-c:a", "libmp3lame", "-b:a", "192k", out]);
    return { mp3: await fsp.readFile(out), seconds: 0, mastered: false };
  } catch (e) {
    console.log("Conversão simples falhou, salvando como veio:", e.message);
    return { mp3: buf, seconds: 0, mastered: false };
  } finally {
    fsp.rm(src, { force: true }).catch(() => {});
    fsp.rm(out, { force: true }).catch(() => {});
  }
}
