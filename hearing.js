// "Ouvido" do app (roda na GPU do Modal): o Whisper ouve o que foi cantado e os acordes são
// detectados no acompanhamento. Serve para:
//   - conferir a pronúncia (quantas palavras da letra dá para entender no canto);
//   - montar a cifra a partir do áudio real (os acordes que tocam em cada palavra).
import { getSettings } from "./kaggle.js";

// https://conta--acaiamusic-estudio-estudio.us-east.modal.run -> https://conta--acaiamusic-ouvido-ouvir.us-east.modal.run
export function hearingUrl() {
  const s = getSettings();
  if (s.ouvidoUrl) return s.ouvidoUrl;
  return /acaiamusic-estudio-estudio/.test(s.modalUrl || "") ? s.modalUrl.replace("acaiamusic-estudio-estudio", "acaiamusic-ouvido-ouvir").replace(/\/+$/, "") : "";
}

export async function listen(audio, language = "pt") {
  const url = hearingUrl();
  if (!url) throw new Error("O ouvido (Whisper) precisa do estúdio no Modal.");
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: getSettings().modalKey, language, audio: Buffer.from(audio).toString("base64") }),
    signal: AbortSignal.timeout(12 * 60 * 1000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || typeof j.text !== "string") throw new Error(j.error || `o ouvido respondeu ${r.status}`);
  return { text: j.text, words: j.words || [], chords: j.chords || [], key: j.key || "", tempo: j.tempo || 0 };
}

// palavra sem acento, minúscula, só letras
const norm = (w) => String(w).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const tokens = (t) => String(t).split(/\s+/).map(norm).filter(Boolean);

// pares (i, j) da maior sequência de palavras em comum (na ordem)
function lcsPairs(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// % das palavras da letra que o Whisper reconheceu no canto, na ordem certa
export function lyricScore(lyricsText, heardText) {
  const a = tokens(lyricsText), b = tokens(heardText);
  if (!a.length) return 100;
  return Math.round((100 * lcsPairs(a, b).length) / a.length);
}

// Cifra a partir do áudio: cada palavra da letra recebe o tempo em que foi cantada (pelo Whisper)
// e o acorde que tocava nesse instante. Marca o acorde só onde ele muda (e no começo de cada verso).
// order: as seções na ordem cantada (o mesmo objeto de refrão pode aparecer várias vezes).
export function chordSheetFromAudio(order, heard) {
  const lyr = []; // { sec, line, word }
  order.forEach((sec, si) => sec.lines.forEach((line, li) => line.split(/\s+/).filter(Boolean).forEach((word) => lyr.push({ si, li, word }))));
  const hw = heard.words.map((w) => ({ n: norm(w[0]), t: Number(w[1]) || 0 }));
  const times = new Array(lyr.length).fill(null);
  for (const [i, j] of lcsPairs(lyr.map((x) => norm(x.word)), hw.map((x) => x.n))) times[i] = hw[j].t;
  // palavras que o Whisper não reconheceu: tempo estimado entre as vizinhas
  const known = times.map((t, i) => (t == null ? -1 : i)).filter((i) => i >= 0);
  if (known.length < 3) return null;
  for (let i = 0; i < times.length; i++) {
    if (times[i] != null) continue;
    const prev = [...known].reverse().find((k) => k < i), next = known.find((k) => k > i);
    if (prev == null) times[i] = times[next] - (next - i) * 0.4;
    else if (next == null) times[i] = times[prev] + (i - prev) * 0.4;
    else times[i] = times[prev] + ((times[next] - times[prev]) * (i - prev)) / (next - prev);
  }
  // nome das notas conforme o tom: em tons com bemóis, Db em vez de C#, etc.
  const FLAT_KEYS = /^(F|Bb|Eb|Ab|Db|Gb|Dm|Gm|Cm|Fm|Bbm|Ebm)$/;
  const toFlat = { "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb" };
  const toSharp = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#" };
  const flat = FLAT_KEYS.test(heard.key || "");
  const spell = (c) => c.replace(/^([A-G][#b]?)/, (r) => (flat ? toFlat[r] : toSharp[r]) || r);
  const segs = heard.chords.filter((c) => c[2] !== "N").map((c) => [c[0], c[1], spell(c[2])]);
  const chordAt = (t) => {
    let cur = segs[0]?.[2] || "";
    for (const [t0, , name] of segs) if (t0 <= t + 0.15) cur = name;
    else break;
    return cur;
  };
  // monta cada vez que a seção é cantada; para o refrão repetido fica a vez em que a harmonia
  // apareceu com mais clareza (mais trocas de acorde detectadas)
  const best = new Map(); // seção -> { lines, changes }
  const out = [];
  let k = 0;
  order.forEach((sec) => {
    const lines = [];
    let changes = 0;
    sec.lines.forEach((line) => {
      let last = "";
      const words = line.split(/\s+/).filter(Boolean).map((word, wi) => {
        const c = chordAt(times[k++]);
        const mark = c && (wi === 0 || c !== last);
        if (mark && wi > 0) changes++;
        if (c && c !== last && last) changes++;
        last = c || last;
        return mark ? `[${c}]${word}` : word;
      });
      lines.push(words.join(" "));
    });
    const cur = best.get(sec);
    if (!cur) {
      const item = { name: sec.name, lines, changes };
      best.set(sec, item);
      out.push(item);
    } else if (changes > cur.changes) Object.assign(cur, { lines, changes });
  });
  out.forEach((s) => delete s.changes);
  // progressão do refrão (ou da 1ª seção): acordes na ordem, sem repetir em seguida
  const pick = out.find((s) => /refr|chorus|resposta/i.test(s.name)) || out[0];
  const seq = [];
  for (const m of (pick?.lines.join(" ") || "").matchAll(/\[([^\]]+)\]/g)) if (seq[seq.length - 1] !== m[1]) seq.push(m[1]);
  return { key: heard.key, progression: [...new Set(seq)].slice(0, 6).join(" – "), sections: out, source: "audio" };
}

// Capa ilustrada: imagem gerada na GPU do Modal (SDXL Lightning); sem o Modal, tenta o Pollinations (grátis)
export function illustratorUrl() {
  const s = getSettings();
  return /acaiamusic-estudio-estudio/.test(s.modalUrl || "") ? s.modalUrl.replace("acaiamusic-estudio-estudio", "acaiamusic-ouvido-ilustrar").replace(/\/+$/, "") : "";
}
export async function illustrate(prompt, seed = Math.floor(Math.random() * 2 ** 31)) {
  const url = illustratorUrl();
  if (url) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: getSettings().modalKey, prompt, seed }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.image) return Buffer.from(j.image, "base64");
      console.log("Ilustrador do Modal falhou:", j.error || r.status);
    } catch (e) {
      console.log("Ilustrador do Modal falhou:", e.message);
    }
  }
  const r = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error("O gerador de imagens gratuito está ocupado agora. Tente de novo em 1 minuto.");
  return Buffer.from(await r.arrayBuffer());
}

// Clipe da capa: a imagem do tema vira um vídeo curto com movimento (LTX-Video no Modal)
export function clipUrl() {
  const s = getSettings();
  return /acaiamusic-estudio-estudio/.test(s.modalUrl || "") ? s.modalUrl.replace("acaiamusic-estudio-estudio", "acaiamusic-clipe-clipe").replace(/\/+$/, "") : "";
}
export async function animateCover(imageBuf, prompt, format = "vertical", { until: deadline, ...extra } = {}) {
  const url = clipUrl();
  if (!url) throw new Error("O clipe animado precisa do estúdio no Modal.");
  const key = getSettings().modalKey;
  const post = async (body) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, ...body }), signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `o gerador de clipes respondeu ${r.status}`);
    return j;
  };
  // começa o clipe e acompanha até ficar pronto (até 25 min, contando a GPU ligar)
  const { call_id } = await post({ image: imageBuf.toString("base64"), prompt, format, seed: Math.floor(Math.random() * 2 ** 31), ...extra });
  if (!call_id) throw new Error("o gerador de clipes não começou");
  // deadline: quem chamou não quer esperar mais que isso (a GPU pode estar em fila no Modal)
  const until = Math.min(Date.now() + 25 * 60 * 1000, deadline || Infinity);
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 10000));
    let j;
    try {
      j = await post({ call_id });
    } catch (e) {
      if (/não deu certo|Chave/i.test(e.message)) throw e;
      continue; // falha passageira de rede: tenta de novo na próxima volta
    }
    if (j.video) return Buffer.from(j.video, "base64");
  }
  post({ cancel: call_id }).catch(() => {});
  throw new Error("o clipe demorou demais (a GPU do Modal está ocupada agora)");
}

// Linha do tempo da letra (na ordem cantada): quando cada verso e cada palavra são cantados,
// pelo que o Whisper ouviu. Serve para o modo palco e para a letra animada do vídeo.
// order: seções na ordem cantada; heard: { words: [[palavra, início, fim]], chords }
export function lyricTimeline(order, heard) {
  const lyr = [];
  order.forEach((sec, si) => sec.lines.forEach((line, li) => line.split(/\s+/).filter(Boolean).forEach((word) => lyr.push({ si, li, word }))));
  const hw = (heard?.words || []).map((w) => ({ n: norm(w[0]), t: Number(w[1]) || 0, e: Number(w[2]) || Number(w[1]) || 0 }));
  if (!lyr.length || !hw.length) return null;
  const t0 = new Array(lyr.length).fill(null), t1 = new Array(lyr.length).fill(null);
  for (const [i, j] of lcsPairs(lyr.map((x) => norm(x.word)), hw.map((x) => x.n))) (t0[i] = hw[j].t), (t1[i] = hw[j].e);
  const known = t0.map((t, i) => (t == null ? -1 : i)).filter((i) => i >= 0);
  if (known.length < Math.max(3, lyr.length * 0.25)) return null; // ouviu pouco: não dá para confiar
  for (let i = 0; i < t0.length; i++) {
    if (t0[i] != null) continue;
    const prev = [...known].reverse().find((k) => k < i), next = known.find((k) => k > i);
    if (prev == null) t0[i] = t0[next] - (next - i) * 0.4;
    else if (next == null) t0[i] = t1[prev] + (i - prev - 1) * 0.4;
    else t0[i] = t1[prev] + ((t0[next] - t1[prev]) * (i - prev)) / (next - prev + 1);
  }
  for (let i = 0; i < t0.length; i++) if (i && t0[i] < t0[i - 1]) t0[i] = t0[i - 1] + 0.05; // sempre em ordem
  for (let i = 0; i < t1.length; i++) if (t1[i] == null || t1[i] <= t0[i]) t1[i] = Math.min(t0[i] + 0.45, t0[i + 1] ?? t0[i] + 0.45);
  const segs = (heard.chords || []).filter((c) => c[2] !== "N");
  const chordAt = (t) => {
    let cur = "";
    for (const [s, , name] of segs) if (s <= t + 0.15) cur = name;
    else break;
    return cur;
  };
  const lines = [];
  let cur = null, lastChord = "";
  lyr.forEach((x, i) => {
    if (!cur || cur.si !== x.si || cur.li !== x.li) {
      lines.push((cur = { si: x.si, li: x.li, sec: order[x.si].name, words: [] }));
      lastChord = "";
    }
    const c = chordAt(t0[i]);
    cur.words.push([x.word, Math.round(Math.max(0, t0[i]) * 100) / 100, Math.round(t1[i] * 100) / 100, c && c !== lastChord ? c : ""]);
    if (c) lastChord = c;
  });
  return lines.map(({ sec, words }) => ({ sec, text: words.map((w) => w[0]).join(" "), t: words[0][1], end: words.at(-1)[2], words }));
}

// 2ª voz (dueto do karaokê): a voz da IA vira uma terça acima/abaixo, na escala do tom (Modal, só processador)
export function harmonyUrl() {
  const s = getSettings();
  return /acaiamusic-estudio-estudio/.test(s.modalUrl || "") ? s.modalUrl.replace("acaiamusic-estudio-estudio", "acaiamusic-harmonia-harmonia").replace(/\/+$/, "") : "";
}
export async function harmonize(audioBuf, { tonic, minor, dir }) {
  const url = harmonyUrl();
  if (!url) throw new Error("O dueto precisa do estúdio no Modal.");
  const key = getSettings().modalKey;
  const post = async (body) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, ...body }), signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `a 2ª voz respondeu ${r.status}`);
    return j;
  };
  const { call_id } = await post({ audio: Buffer.from(audioBuf).toString("base64"), tonic, minor, dir });
  if (!call_id) throw new Error("a 2ª voz não começou");
  const until = Date.now() + 20 * 60 * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 5000));
    let j;
    try {
      j = await post({ call_id });
    } catch (e) {
      if (/não deu certo|Chave/i.test(e.message)) throw e;
      continue;
    }
    if (j.audio) return Buffer.from(j.audio, "base64");
  }
  throw new Error("a 2ª voz demorou demais");
}
