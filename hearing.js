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
  const segs = heard.chords.filter((c) => c[2] !== "N");
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
