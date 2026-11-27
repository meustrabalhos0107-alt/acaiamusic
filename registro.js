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

// Lê o texto carimbado (a fonte da verdade) em partes: cabeçalho e seções com título sublinhado
function parseRegistro(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const meta = [], sections = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^=+$/.test(l) || (i === 0 && /^REGISTRO DE CRIA/.test(l))) continue;
    if (/^-{3,}$/.test(lines[i + 1] || "")) {
      cur = { name: l.trim(), lines: [] };
      sections.push(cur);
      i++;
      continue;
    }
    if (!cur) {
      const m = /^([^:]{2,60}):\s(.+)$/.exec(l);
      if (m) meta.push([m[1].trim(), m[2].trim()]);
      continue;
    }
    cur.lines.push(l);
  }
  for (const s of sections) {
    while (s.lines.length && !s.lines.at(-1).trim()) s.lines.pop();
    while (s.lines.length && !s.lines[0].trim()) s.lines.shift();
  }
  return { meta, sections };
}

// Página do registro, para imprimir ou salvar em PDF (certificado em A4)
export function registroPage({ song, reg, text, base }) {
  const h = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const tz = { timeZone: "America/Sao_Paulo" };
  const at = new Date(reg.at);
  const when = at.toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "medium", ...tz });
  const year = at.toLocaleDateString("pt-BR", { year: "numeric", ...tz });
  const num = `ACA-${at.toLocaleDateString("en-CA", tz).replace(/-/g, "")}-${String(reg.docSha256).slice(0, 8).toUpperCase()}`;
  const { meta, sections } = parseRegistro(text);
  const M = Object.fromEntries(meta);
  const sec = (re) => sections.find((s) => re.test(s.name));
  const o = song.options || {};

  // [Refrão] vira etiqueta; o resto, versos
  const verses = (ls) => {
    const blocks = [];
    let b = null;
    for (const l of ls) {
      const m = /^\[([^\]]+)\]\s*$/.exec(l.trim());
      if (m) {
        b = { name: m[1], lines: [] };
        blocks.push(b);
      } else if (l.trim()) {
        if (!b) blocks.push((b = { name: "", lines: [] }));
        b.lines.push(l);
      }
    }
    return blocks;
  };
  const stanzas = (ls, line) =>
    verses(ls)
      .map((b) => `<div class="stanza">${b.name ? `<span class="tag">${h(b.name)}</span>` : ""}${b.lines.map(line).join("")}</div>`)
      .join("");
  // cifra: o acorde fica em cima da sílaba, como numa cifra impressa
  const chordLine = (l) => {
    const parts = l.split(/(\[[^\]]+\])/).filter((x) => x !== "");
    let out = "", pend = "";
    for (const p of parts) {
      const m = /^\[([^\]]+)\]$/.exec(p);
      if (m) {
        if (pend) out += `<span class="cw"><b>${h(pend)}</b><i>&nbsp;</i></span>`;
        pend = m[1];
      } else {
        out += `<span class="cw"><b>${h(pend)}</b><i>${h(p)}</i></span>`;
        pend = "";
      }
    }
    if (pend) out += `<span class="cw"><b>${h(pend)}</b><i>&nbsp;</i></span>`;
    return `<p class="cl">${out}</p>`;
  };
  const cifra = sec(/^CIFRA/);
  let cifraHead = "", cifraBody = [];
  if (cifra) {
    const k = cifra.lines.findIndex((l) => /^Tom:/.test(l));
    if (k >= 0) cifraHead = cifra.lines[k];
    cifraBody = cifra.lines.filter((_, i) => i !== k);
  }

  // declaração de IA: parágrafo + grupos com marcadores
  const decl = sec(/DECLARA/);
  const groups = [], intro = [];
  for (const l of decl?.lines || []) {
    if (/^\s*•\s/.test(l)) groups.at(-1)?.items.push(l.replace(/^\s*•\s/, ""));
    else if (/:\s*$/.test(l.trim())) groups.push({ title: l.trim().replace(/:$/, ""), items: [] });
    else if (l.trim()) intro.push(l.trim());
  }
  const human = groups.find((g) => /humana/i.test(g.title)), ai = groups.find((g) => /intelig/i.test(g.title));
  const card = (g, cls, icon) =>
    g ? `<div class="decl ${cls}"><h4><span class="ic">${icon}</span>${h(g.title)}</h4><ul>${g.items.map((x) => `<li>${h(x)}</li>`).join("")}</ul></div>` : "";

  const refs = sec(/REFER/);
  const obs = sec(/OBSERVA/);
  const kicker = [o.mode === "catolica" ? "Canto litúrgico" : song.genre, o.mode === "catolica" && o.moment, o.season].filter(Boolean).join(" · ");
  const rows = [
    ["Obra", M["Obra"] || song.title],
    ["Responsável pela criação", M["Responsável pela criação"] || reg.author],
    ["Música criada em", M["Música criada em"]],
    ["Registro gerado em", M["Registro gerado em"] || when],
    ["Duração do áudio", M["Duração do áudio"]],
    ["Carimbo de tempo", `OpenTimestamps · ${(n => n > 1 ? n + " servidores públicos" : "1 servidor público")(reg.calendars?.length || 1)}`],
  ].filter((r) => r[1]);
  let n = 0;
  const head = (t) => `<h2><span class="n">${++n}</span>${t}</h2>`;
  const lyricLines = sec(/^LETRA/)?.lines || [];

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Registro de Criação · ${h(song.title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/icon.svg">
<style>
  @font-face{font-family:Inter;src:url(/fonts/InterVariable.woff2) format("woff2");font-weight:100 900;font-display:swap}
  :root{--ink:#1c1726;--soft:#5d5670;--line:#e7e1f0;--paper:#fff;--bg:#efeaf6;--rose:#ec4899;--violet:#7c3aed;--cyan:#06b6d4}
  *{box-sizing:border-box}
  html{background:var(--bg)}
  body{margin:0;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:var(--ink);line-height:1.55;font-size:15px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .serif{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif}
  .bar{position:sticky;top:0;z-index:5;display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 18px;background:rgba(20,12,32,.94);backdrop-filter:blur(8px)}
  .bar span{color:#e9defc;font-size:.82rem;margin-right:auto;font-weight:600;letter-spacing:.02em}
  .bar a,.bar button{font:inherit;font-size:.84rem;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:transparent;color:#fff;text-decoration:none;cursor:pointer;font-weight:600}
  .bar .primary{background:linear-gradient(135deg,var(--violet),var(--rose));border:0}
  .sheet{max-width:860px;margin:28px auto 60px;background:var(--paper);border-radius:18px;box-shadow:0 24px 70px -24px rgba(60,20,100,.35);overflow:hidden}
  .cover{position:relative;padding:44px 52px 40px;color:#fff;background:radial-gradient(120% 140% at 100% 0%,#5b21b6 0%,#2a1140 46%,#120a1d 100%);overflow:hidden}
  .cover:before{content:"";position:absolute;left:-80px;bottom:-140px;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(6,182,212,.22),transparent 65%)}
  .cover:after{content:"";position:absolute;right:-90px;bottom:-200px;width:460px;height:460px;border-radius:50%;background:radial-gradient(circle,rgba(236,72,153,.34),transparent 65%)}
  .cover > *{position:relative;z-index:1}
  .brand{display:flex;align-items:center;gap:12px}
  .brand img{width:46px;height:46px;border-radius:12px;box-shadow:0 0 0 1px rgba(255,255,255,.15)}
  .brand b{letter-spacing:.32em;font-size:.84rem}
  .brand small{display:block;letter-spacing:.06em;color:#cdbdf0;font-size:.7rem;font-weight:500;font-style:italic}
  .doc-type{margin:38px 0 8px;font-size:.74rem;letter-spacing:.3em;text-transform:uppercase;color:#f9a8d4;font-weight:700}
  .cover h1{margin:0;font-size:2.6rem;line-height:1.1;font-weight:600;max-width:72%}
  .kicker{margin:12px 0 0;color:#d8ccf5;font-size:.95rem}
  .num{display:inline-flex;gap:10px;align-items:center;margin-top:28px;padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);font-size:.76rem;letter-spacing:.08em;text-transform:uppercase;color:#e9defc}
  .num code{font-family:Consolas,ui-monospace,monospace;font-weight:700;color:#fff;font-size:.86rem;letter-spacing:.04em;text-transform:none}
  .seal{position:absolute!important;right:48px;top:44px;width:124px;height:124px;border-radius:50%;padding:3px;background:conic-gradient(from 210deg,#f9a8d4,#c4b5fd,#67e8f9,#f9a8d4);box-shadow:0 10px 30px -8px rgba(236,72,153,.5)}
  .seal div{width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 50% 35%,#2b1747,#140c22);display:grid;place-items:center;align-content:center;gap:3px;text-align:center;font-size:.56rem;letter-spacing:.18em;text-transform:uppercase;color:#d8ccf5;outline:1px dashed rgba(255,255,255,.28);outline-offset:-9px}
  .seal strong{font-size:1.55rem;letter-spacing:.02em;color:#fff;line-height:1;font-weight:700}
  .seal em{font-style:normal;color:#f9a8d4;font-weight:700}
  .content{padding:40px 52px 44px}
  section{margin:0 0 36px}
  h2{display:flex;align-items:center;gap:10px;margin:0 0 16px;font-size:.76rem;letter-spacing:.22em;text-transform:uppercase;color:var(--violet);break-after:avoid}
  h2:after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--line),transparent)}
  h2 .n{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#f3ecff;color:var(--violet);font-size:.72rem;letter-spacing:0}
  .facts{display:grid;grid-template-columns:repeat(2,1fr);margin:0;border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .facts div{padding:13px 18px;border-top:1px solid var(--line);break-inside:avoid}
  .facts div:nth-child(-n+2){border-top:0}
  .facts div:nth-child(odd):not(.wide){border-right:1px solid var(--line)}
  .facts .wide{grid-column:1/-1;background:#fbfaff}
  .facts dt{font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--soft);font-weight:600}
  .facts dd{margin:3px 0 0;font-weight:600}
  .hash{font-family:Consolas,ui-monospace,monospace;font-size:.76rem;word-break:break-all;color:#3b3450;font-weight:500!important;letter-spacing:.02em}
  .intro{margin:0 0 14px;color:var(--soft)}
  .decls{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .decl{border-radius:14px;padding:16px 18px;break-inside:avoid;border:1px solid var(--line)}
  .decl.human{background:linear-gradient(180deg,#fff4f9,#fff 70%);border-color:#fbcfe8}
  .decl.ai{background:linear-gradient(180deg,#effafe,#fff 70%);border-color:#bae6fd}
  .decl h4{display:flex;gap:9px;align-items:center;margin:0 0 8px;font-size:.92rem}
  .decl .ic{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:9px;font-size:.88rem}
  .human .ic{background:#fce7f3}.ai .ic{background:#e0f2fe}
  .decl ul{margin:0;padding-left:18px;font-size:.86rem;color:#3b3450}
  .decl li{margin:6px 0}
  .lyric{columns:2;column-gap:44px;column-rule:1px solid #f1ecf7}
  .stanza{break-inside:avoid;margin:0 0 20px}
  .stanza p{margin:0;font-size:1.04rem}
  .tag{display:inline-block;margin-bottom:6px;font-family:Inter,sans-serif;font-size:.64rem;letter-spacing:.18em;text-transform:uppercase;color:var(--rose);font-weight:700}
  .chordhead{display:inline-flex;gap:8px;margin:0 0 18px;padding:7px 14px;border-radius:999px;background:#f3ecff;color:#5b21b6;font-size:.82rem;font-weight:600}
  .cl{margin:0 0 4px!important;line-height:1.15}
  .cw{display:inline-flex;flex-direction:column;vertical-align:bottom;white-space:pre}
  .cw b{font-size:.74rem;color:var(--violet);min-height:1.1em;font-family:Inter,sans-serif;font-weight:700}
  .cw i{font-style:normal;font-size:.95rem}
  .refs{display:flex;flex-wrap:wrap;gap:8px}
  .refs span{padding:6px 13px;border-radius:999px;border:1px solid var(--line);font-size:.86rem;background:#faf8fd}
  .steps{counter-reset:s;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0;padding:0;list-style:none}
  .steps li{counter-increment:s;border:1px solid var(--line);border-radius:14px;padding:14px 16px;font-size:.85rem;break-inside:avoid;background:#fdfcff}
  .steps li:before{content:counter(s);display:grid;place-items:center;width:26px;height:26px;border-radius:50%;margin-bottom:8px;background:linear-gradient(135deg,var(--violet),var(--rose));color:#fff;font-weight:700;font-size:.8rem}
  .warn{margin-top:12px;padding:12px 16px;border-radius:12px;background:#fffbeb;border:1px solid #fde68a;font-size:.84rem;color:#6b4e0b}
  .note{font-size:.8rem;color:var(--soft)}
  details.raw{margin-top:14px;border:1px solid var(--line);border-radius:12px;padding:10px 14px}
  details.raw summary{cursor:pointer;font-weight:600;font-size:.86rem;color:var(--violet)}
  details.raw pre{white-space:pre-wrap;font-family:Consolas,ui-monospace,monospace;font-size:.74rem;margin:10px 0 0}
  .sign{display:grid;grid-template-columns:1fr auto;gap:30px;align-items:end;margin-top:46px;break-inside:avoid}
  .sign .line{border-top:1px solid #9d94b0;padding-top:8px;font-weight:600;max-width:340px}
  .sign .line small,.sign .when small{display:block;color:var(--soft);font-size:.7rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase}
  .sign .when{text-align:right;font-size:.88rem;font-weight:600}
  .foot{display:flex;justify-content:space-between;gap:16px;padding:14px 52px;background:#faf8fd;border-top:1px solid var(--line);font-size:.7rem;color:var(--soft)}
  .muted{color:var(--soft)}
  @media (max-width:720px){
    .sheet{margin:0;border-radius:0}
    .cover,.content{padding-left:22px;padding-right:22px}.foot{padding:12px 22px;flex-direction:column}
    .cover h1{font-size:1.9rem;max-width:100%}
    .seal{position:relative!important;right:auto;top:auto;margin:22px 0 0;width:100px;height:100px}
    .facts,.decls,.steps{grid-template-columns:1fr}.facts div{border-right:0!important;border-top:1px solid var(--line)!important}.facts div:first-child{border-top:0!important}
    .lyric{columns:1}.sign{grid-template-columns:1fr}.sign .when{text-align:left}
  }
  @page{size:A4;margin:12mm}
  @media print{
    html,body{background:#fff;font-size:13.5px}.bar,.noprint{display:none!important}
    .sheet{margin:0;max-width:none;box-shadow:none;border-radius:0;overflow:visible}
    .cover{border-radius:14px}.content{padding:26px 4px 6px}.foot{background:none;padding:10px 4px}
    section{margin-bottom:26px}
  }
</style></head><body>
<div class="bar noprint">
  <span>📜 Registro de Criação · ${h(num)}</span>
  <button class="primary" onclick="print()">🖨 Imprimir / salvar em PDF</button>
  <a href="${base}/texto">⬇ Registro (.txt)</a>
  <a href="${base}/prova">⬇ Prova (.ots)</a>
  <a href="/audio/${h(song.id)}.mp3" download>⬇ Áudio (MP3)</a>
</div>
<main class="sheet">
  <header class="cover">
    <div class="brand"><img src="/icon.svg" alt=""><div><b>ACAIAMUSIC</b><small>Ao Céu Ascende, Inteira, a Alma que canta</small></div></div>
    <div class="seal" title="Carimbo de tempo gratuito do OpenTimestamps, gravado na blockchain do Bitcoin"><div><span>Carimbo de</span><strong>${h(year)}</strong><em>tempo</em><span>Bitcoin</span></div></div>
    <p class="doc-type">Registro de Criação de Obra Musical</p>
    <h1 class="serif">${h(song.title)}</h1>
    ${kicker ? `<p class="kicker">${h(kicker)}</p>` : ""}
    <div class="num">Nº do registro <code>${h(num)}</code></div>
  </header>

  <div class="content">
    <section>
      ${head("Identificação da obra")}
      <dl class="facts">
        ${rows.map(([k, v]) => `<div><dt>${h(k)}</dt><dd>${h(v)}</dd></div>`).join("")}
        <div class="wide"><dt>Impressão digital do áudio (SHA-256)</dt><dd class="hash">${h(reg.audioSha256)}</dd></div>
        <div class="wide"><dt>Impressão digital deste registro (SHA-256)</dt><dd class="hash">${h(reg.docSha256)}</dd></div>
      </dl>
    </section>

    ${decl ? `<section>
      ${head("Declaração de uso de inteligência artificial")}
      ${intro.length ? `<p class="intro">${h(intro.join(" "))}</p>` : ""}
      <div class="decls">${card(human, "human", "✍️")}${card(ai, "ai", "✨")}</div>
    </section>` : ""}

    <section>
      ${head("Letra")}
      <div class="lyric serif">${stanzas(lyricLines, (l) => `<p>${h(l)}</p>`) || `<p class="muted">(instrumental)</p>`}</div>
    </section>

    ${cifra ? `<section>
      ${head("Cifra")}
      ${cifraHead ? `<div class="chordhead">🎸 ${h(cifraHead)}</div>` : ""}
      <div class="lyric">${stanzas(cifraBody, chordLine)}</div>
    </section>` : ""}

    ${refs ? `<section>
      ${head("Referências bíblicas")}
      <div class="refs">${refs.lines.join(" ").split(/;\s*/).filter(Boolean).map((r) => `<span>${h(r)}</span>`).join("")}</div>
    </section>` : ""}

    <section>
      ${head("Como comprovar a data")}
      <ol class="steps">
        <li>Guarde juntos os 3 arquivos: o <b>registro (.txt)</b>, a <b>prova (.ots)</b> e o <b>áudio (MP3)</b>.</li>
        <li>Em <b>opentimestamps.org</b>, arraste a prova <b>.ots</b> e depois o <b>.txt</b>: aparece a data gravada na blockchain do Bitcoin (confirma algumas horas depois).</li>
        <li>Para provar que o áudio é o mesmo, a impressão digital SHA-256 do MP3 deve ser igual à da seção 1.</li>
      </ol>
      <div class="warn"><b>Importante:</b> não altere o arquivo .txt (nem um espaço). Qualquer mudança troca a impressão digital e a prova deixa de valer.</div>
      ${obs ? `<p class="note">${h(obs.lines.join(" "))}</p>` : ""}
      <details class="raw noprint"><summary>Ver o texto original carimbado</summary><pre>${h(text)}</pre></details>
    </section>

    <div class="sign">
      <div class="line">${h(reg.author)}<small>Responsável pela criação</small></div>
      <div class="when"><small>Registrado em</small>${h(when)}</div>
    </div>
  </div>
  <footer class="foot"><span>ACAIAMUSIC · Registro ${h(num)}</span><span>Comprova a existência da obra na data do carimbo. Não substitui o registro na Biblioteca Nacional.</span></footer>
</main>
</body></html>`;
}
