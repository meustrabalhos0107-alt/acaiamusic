// Liturgia diária da Canção Nova (liturgia.cancaonova.com/pb): leituras, salmo, aclamação e evangelho
const BASE = "https://liturgia.cancaonova.com/pb/";
const UA = { "User-Agent": "Mozilla/5.0 (ACAIAMUSIC)" };

// &atilde; -> ã etc. (letras com acento montadas por normalização Unicode)
const MARKS = { acute: "́", grave: "̀", tilde: "̃", circ: "̂", uml: "̈", cedil: "̧" };
const NAMED = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", ordm: "º", ordf: "ª", deg: "°" };
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([A-Za-z])(acute|grave|tilde|circ|uml|cedil);/g, (_, l, m) => (l + MARKS[m]).normalize("NFC"))
    .replace(/&([a-z]+);/gi, (a, n) => NAMED[n.toLowerCase()] ?? a);
}
// parágrafos de um trecho HTML, já sem tags e sem os números dos versículos
function paragraphs(html) {
  return html
    .split(/<\/p>/i)
    .map((p) =>
      decode(
        p
          .replace(/<div class="embeds-audio">[\s\S]*?<\/div>/gi, "")
          .replace(/<strong>\s*\d{1,3}[a-z]{0,2}\s*<\/strong>/gi, "") // números de versículo (14, 16b…)
          .replace(/<br\s*\/?>/gi, " ")
          .replace(/<[^>]+>/g, ""),
      )
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}
const tab = (html, n) => {
  const m = new RegExp(`id="liturgia-${n}"[^>]*>([\\s\\S]*?)(?=<div id="liturgia-\\d|<p style="font-style: italic)`).exec(html);
  return m ? paragraphs(m[1]) : null;
};
const refOf = (line) => /\(([^)]+)\)\s*$/.exec(line)?.[1] || "";
const isClosing = (l) => /^[-—–]?\s*(palavra do senhor|graças a deus|palavra da salvação|glória a vós, senhor)/i.test(l);

function parseReading(lines) {
  if (!lines) return null;
  const [head, intro, ...rest] = lines;
  return { ref: refOf(head), title: intro || "", text: rest.filter((l) => !isClosing(l)).join(" ") };
}
function parsePsalm(lines) {
  if (!lines) return null;
  const [head, ...rest] = lines;
  const refrain = (rest[0] || "").replace(/^[-—–]\s*/, "");
  const text = rest.slice(1).filter((l) => l.replace(/^[-—–]\s*/, "") !== refrain).map((l) => l.replace(/^[-—–]\s*/, "")).join("\n");
  return { ref: head.replace(/^Respons[óo]rio\s*/i, ""), refrain, text };
}
function parseGospel(lines) {
  if (!lines) return { gospel: null, acclamation: "" };
  const [head, ...rest] = lines;
  const p = rest.findIndex((l) => /^Proclama[çc][ãa]o do Evangelho/i.test(l));
  const accl = (p > 0 ? rest.slice(0, p) : []).map((l) => l.replace(/^[-—–]\s*/, "")).join("\n");
  const body = rest.slice(p + 1).filter((l) => !isClosing(l));
  return { gospel: { ref: refOf(head), title: p >= 0 ? rest[p] : "", text: body.join(" ") }, acclamation: accl };
}

async function get(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Canção Nova ${r.status}`);
  return r.text();
}

// iso "AAAA-MM-DD" -> liturgia do dia (ou null se a Canção Nova não tiver a data)
export async function cancaoNova(iso) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  let html = await get(BASE);
  if (iso && iso !== today) {
    const [y, m, d] = iso.split("-").map(Number);
    const link = new RegExp(`href="(https://liturgia\\.cancaonova\\.com/pb/liturgia/[^"]*\\?sDia=${d}&(?:amp;)?sMes=${m}&(?:amp;)?sAno=${y})"`).exec(html)?.[1];
    if (!link) return null; // o calendário da página só traz o mês atual
    html = await get(decode(link));
  }
  const title = decode(/<h1 class="entry-title">\s*([\s\S]*?)\s*<\/h1>/.exec(html)?.[1] || "").replace(/\s+/g, " ").trim();
  const color = decode(/cor-liturgica">\s*Cor Lit[úu]rgica:\s*([^<]+)/.exec(html)?.[1] || "").trim();
  const { gospel, acclamation } = parseGospel(tab(html, 4));
  return {
    title,
    color,
    readings: { first: parseReading(tab(html, 1)), psalm: parsePsalm(tab(html, 2)), second: parseReading(tab(html, 3)), acclamation, gospel },
    source: "Liturgia Diária · Canção Nova",
  };
}
