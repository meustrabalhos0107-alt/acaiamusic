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
