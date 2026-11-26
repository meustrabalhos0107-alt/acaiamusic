// Registro de Criação: documento com letra, cifra, impressão digital do áudio, data, autoria e a
// declaração honesta do uso de IA. A impressão digital do documento é carimbada de graça no
// OpenTimestamps (fica gravada na blockchain do Bitcoin): prova verificável de que o documento já
// existia naquela data. Só o código (hash) sai do app; a letra e o nome não são enviados.
import { createHash } from "node:crypto";

const sha256 = (buf) => createHash("sha256").update(buf).digest();
const CALENDARS = [
  "https://alice.btc.calendar.opentimestamps.org",
  "https://bob.btc.calendar.opentimestamps.org",
  "https://finney.calendar.eternitywall.com",
];
// cabeçalho do arquivo .ots (formato do OpenTimestamps)
const OTS_MAGIC = Buffer.from("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294", "hex");

// Envia o hash aos calendários públicos e monta o arquivo .ots (prova "pendente": em algumas horas
// ela é confirmada no Bitcoin; o site opentimestamps.org completa e verifica sozinho).
export async function stamp(digest) {
  const answers = [];
  for (const c of CALENDARS) {
    try {
      const r = await fetch(`${c}/digest`, {
        method: "POST",
        headers: { Accept: "application/vnd.opentimestamps.v1", "Content-Type": "application/x-www-form-urlencoded" },
        body: digest,
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) answers.push({ calendar: c, proof: Buffer.from(await r.arrayBuffer()) });
    } catch {}
  }
  if (!answers.length) throw new Error("Os carimbos de tempo gratuitos (OpenTimestamps) não responderam agora. Tente de novo em alguns minutos.");
  // vários calendários = vários ramos: todos menos o último começam com 0xff
  const branches = answers.map((a, i) => (i < answers.length - 1 ? Buffer.concat([Buffer.from([0xff]), a.proof]) : a.proof));
  const ots = Buffer.concat([OTS_MAGIC, Buffer.from([0x01, 0x08]), digest, ...branches]);
  return { ots, calendars: answers.map((a) => a.calendar) };
}

const SOURCE = {
  propria: "Letra escrita pela autora.",
  ia: "Letra composta por inteligência artificial (Gemini, do Google) a partir do tema, da ideia e das escolhas da autora; revisada e aprovada pela autora.",
  missal: "Texto litúrgico oficial (tradução da CNBB) — NÃO é de autoria própria.",
};

// Texto do registro (exatamente este texto é o que recebe o carimbo de tempo)
export function registroText(song, { author, audioSha256, at }) {
  const o = song.options || {}, sp = song.spec || {};
  const date = new Date(at).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "medium", timeZone: "America/Sao_Paulo" });
  const lyric = (song.sections || []).map((s) => `[${s.name}]\n${s.lines.join("\n")}`).join("\n\n");
  const chords = song.chords?.sections?.length
    ? song.chords.sections.map((s) => `[${s.name}]\n${s.lines.join("\n")}`).join("\n\n")
    : "";
  const choices = [
    o.mode === "catolica" && `Canto litúrgico · momento: ${o.moment || "—"}${o.season ? ` · tempo: ${o.season}` : ""}`,
    song.genre && `Estilo: ${song.genre}`,
    song.voice && `Voz: ${song.voice}`,
    o.moods?.length && `Clima: ${o.moods.join(", ")}`,
    o.instruments?.length && `Instrumentos: ${o.instruments.join(", ")}`,
    o.bpm && `Andamento: ${o.bpm} BPM`,
    o.key && `Tom pedido: ${o.key}`,
  ].filter(Boolean);
  const human = [
    sp.idea && `Ideia/tema escrito pela autora: "${String(sp.idea).slice(0, 600)}"`,
    SOURCE[sp.lyricsSource] || SOURCE.ia,
    `Escolhas artísticas feitas pela autora: ${choices.join(" · ") || "—"}`,
    song.edit?.changes?.length && `Edições de áudio feitas pela autora: ${song.edit.changes.join(", ")}`,
    sp.takes > 1 && `Seleção entre ${sp.takes} gravações (a mais clara foi escolhida)`,
    `Sistema ACAIAMUSIC idealizado e operado pela autora.`,
  ].filter(Boolean);
  const ai = [
    `Música (melodia, arranjo, vozes e instrumentos): gerada pelo modelo ACE-Step 1.5 (licença MIT, uso comercial permitido), rodando no estúdio da autora (${sp.engine || "—"}).`,
    sp.lyricsSource === "ia" && "Letra: modelo Gemini (Google).",
    sp.pronunciation != null && `Revisão de pronúncia: Whisper (OpenAI) — ${sp.pronunciation}% da letra reconhecida.`,
    song.chords?.source === "audio" ? "Cifra: acordes detectados automaticamente no áudio e alinhados à letra pelo Whisper." : song.chords ? "Cifra: sugerida por inteligência artificial a partir da letra." : null,
    "Masterização automática (ffmpeg).",
  ].filter(Boolean);
  return [
    "REGISTRO DE CRIAÇÃO — ACAIAMUSIC",
    "=================================",
    "",
    `Obra: ${song.title}`,
    `Responsável pela criação: ${author}`,
    `Música criada em: ${new Date(song.createdAt).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short", timeZone: "America/Sao_Paulo" })}${song.remadeAt ? ` (refeita em ${new Date(song.remadeAt).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short", timeZone: "America/Sao_Paulo" })})` : ""}`,
    `Registro gerado em: ${date}`,
    `Duração do áudio: ${Math.floor((song.duration || 0) / 60)}:${String(Math.round(song.duration || 0) % 60).padStart(2, "0")}`,
    `Impressão digital do áudio (SHA-256): ${audioSha256}`,
    "",
    "DECLARAÇÃO DE USO DE INTELIGÊNCIA ARTIFICIAL",
    "--------------------------------------------",
    "Esta obra foi criada com auxílio de inteligência artificial, como descrito abaixo.",
    "",
    "Contribuição humana (da autora):",
    ...human.map((h) => `  • ${h}`),
    "",
    "Ferramentas de inteligência artificial usadas:",
    ...ai.map((a) => `  • ${a}`),
    "",
    "LETRA",
    "-----",
    lyric || "(instrumental)",
    "",
    ...(chords ? ["CIFRA", "-----", `Tom: ${song.chords.key || "—"}${song.chords.progression ? ` · Progressão: ${song.chords.progression}` : ""}`, "", chords, ""] : []),
    ...(song.references?.length ? ["REFERÊNCIAS BÍBLICAS", "--------------------", song.references.join("; "), ""] : []),
    "OBSERVAÇÕES",
    "-----------",
    "Este documento comprova a existência desta obra (letra, cifra e áudio identificado pela impressão digital",
    "acima) na data do carimbo de tempo do OpenTimestamps. Não substitui o registro na Biblioteca Nacional.",
    "Textos litúrgicos oficiais e traduções bíblicas citados pertencem aos seus detentores.",
  ].join("\n");
}

export async function createRegistro(song, { author, audio }) {
  const at = new Date().toISOString();
  const audioSha256 = sha256(audio).toString("hex");
  const text = registroText(song, { author, audioSha256, at });
  const docDigest = sha256(Buffer.from(text, "utf8"));
  const { ots, calendars } = await stamp(docDigest);
  return { at, author, audioSha256, docSha256: docDigest.toString("hex"), calendars, text, ots };
}

// Página do registro, para imprimir ou salvar em PDF
export function registroPage({ song, reg, text, base }) {
  const h = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const when = new Date(reg.at).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "medium", timeZone: "America/Sao_Paulo" });
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Registro de Criação · ${h(song.title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:Inter,Segoe UI,system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 20px;color:#1d1b24;line-height:1.5}
  header{border-bottom:3px solid #a855f7;padding-bottom:14px;margin-bottom:20px}
  header small{letter-spacing:.14em;text-transform:uppercase;color:#a855f7;font-weight:700}
  h1{margin:4px 0;font-size:1.9rem}
  .meta{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:.92rem;margin:14px 0}
  .meta b{color:#555}
  code{font-family:Consolas,monospace;font-size:.8rem;word-break:break-all;background:#f3effa;padding:1px 5px;border-radius:4px}
  pre{white-space:pre-wrap;font-family:Consolas,monospace;font-size:.82rem;background:#faf8fd;border:1px solid #e6def3;border-radius:10px;padding:16px}
  .box{border:1px solid #e6def3;border-radius:10px;padding:12px 16px;margin:16px 0;background:#fcfbfe;font-size:.9rem}
  .actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}
  .actions a,.actions button{font:inherit;padding:9px 16px;border-radius:9px;border:1px solid #a855f7;background:#fff;color:#7c3aed;text-decoration:none;cursor:pointer;font-weight:600}
  .actions .primary{background:linear-gradient(135deg,#a855f7,#ec4899);color:#fff;border:0}
  @media print{.actions,.noprint{display:none}body{margin:0}pre{border:0;background:none;padding:0}}
</style></head><body>
<header><small>ACAIAMUSIC · Registro de Criação</small><h1>${h(song.title)}</h1></header>
<div class="meta">
  <b>Responsável</b><span>${h(reg.author)}</span>
  <b>Registrado em</b><span>${h(when)}</span>
  <b>Áudio (SHA-256)</b><code>${h(reg.audioSha256)}</code>
  <b>Documento (SHA-256)</b><code>${h(reg.docSha256)}</code>
  <b>Carimbo de tempo</b><span>OpenTimestamps (blockchain do Bitcoin) · ${reg.calendars.length} servidores públicos · gratuito</span>
</div>
<div class="actions">
  <button class="primary" onclick="print()">🖨 Imprimir / salvar em PDF</button>
  <a href="${base}/texto">⬇ Registro (.txt)</a>
  <a href="${base}/prova">⬇ Prova do carimbo (.ots)</a>
  <a href="/audio/${h(song.id)}.mp3" download>⬇ Áudio (MP3)</a>
</div>
<div class="box noprint"><b>Como comprovar a data (de graça):</b> guarde juntos os 3 arquivos (registro .txt, prova .ots e o MP3).
Em <b>opentimestamps.org</b>, arraste a prova <b>.ots</b> e depois o <b>.txt</b>: o site mostra a data em que o registro foi gravado na blockchain do Bitcoin
(a confirmação leva algumas horas depois de criado). Para conferir que o áudio é o mesmo, a impressão digital SHA-256 do MP3 tem que ser igual à de cima.
<br><br><b>Atenção:</b> não altere o arquivo .txt (nem um espaço), senão a impressão digital muda e a prova deixa de valer.</div>
<pre>${h(text)}</pre>
</body></html>`;
}
