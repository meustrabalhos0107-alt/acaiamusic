// Liturgia do dia (leituras, salmo, antífonas e orações) para montar a "Missa pronta".
// Fonte gratuita: liturgia.up.railway.app (Liturgia Diária da CNBB). Sem internet,
// calcula ao menos o tempo litúrgico pela data da Páscoa.

import { cancaoNova } from "./cancaonova.js";

const cache = new Map(); // "AAAA-MM-DD" -> liturgia

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const DAY = 86400000;
function seasonByDate(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const e = easter(y).getTime(), t = d.getTime();
  const xmas = Date.UTC(y, 11, 25);
  const adv1 = xmas - (((new Date(xmas).getUTCDay() || 7) + 21) * DAY); // 4 domingos antes do Natal
  if (t >= e - 46 * DAY && t < e - 7 * DAY) return "Quaresma";
  if (t >= e - 7 * DAY && t < e) return "Semana Santa";
  if (t >= e && t < e + 49 * DAY) return "Páscoa";
  if (t === e + 49 * DAY) return "Pentecostes";
  if (t >= adv1 && t < xmas) return "Advento";
  if (t >= xmas || t <= Date.UTC(y, 0, 13)) return "Natal";
  return "Tempo Comum";
}

// Escolhe a opção de "tempo" do app a partir do nome da celebração
function seasonFor(title, iso) {
  const s = title || "";
  if (/pentecostes/i.test(s)) return "Pentecostes";
  if (/ramos|paix[aã]o|semana santa|ceia do senhor|sexta-feira santa/i.test(s)) return "Semana Santa";
  if (/advento/i.test(s)) return "Advento";
  if (/quaresma|cinzas/i.test(s)) return "Quaresma";
  if (/p[aá]scoa|ressurrei/i.test(s)) return "Páscoa";
  if (/natal|epifania|sagrada fam[ií]lia|santa maria, m[aã]e de deus/i.test(s)) return "Natal";
  if (/nossa senhora|virgem maria|imaculada|assun[cç][aã]o|maria/i.test(s)) return "Solenidade / Festa Mariana";
  if (/fi[eé]is defuntos|exéquias/i.test(s)) return "Missa de Exéquias / 7º dia";
  const base = seasonByDate(iso);
  if (base === "Tempo Comum" && /\b(s[aã]o|santa|santo|santos|m[aá]rtir|m[aá]rtires|ap[oó]stolo)\b/i.test(s) && !/domingo/i.test(s)) return "Festa de Santo";
  return base;
}

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;
const clean = (t = "") => String(t).replace(/(\s)\d{1,3}(?=[A-Za-zÀ-ú“"])/g, "$1").replace(/\s+/g, " ").trim(); // tira os números dos versículos

export async function getLiturgy(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso = new Date().toISOString().slice(0, 10);
  if (cache.has(iso)) return cache.get(iso);
  const [y, m, d] = iso.split("-").map(Number);
  let out;
  try {
    const r = await fetch(`https://liturgia.up.railway.app/v2/?dia=${d}&mes=${m}&ano=${y}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const L = j.leituras || {};
    const read = (x) => x && { ref: x.referencia || "", title: x.titulo || "", text: clean(x.texto) };
    const ps = first(L.salmo);
    out = {
      date: iso,
      title: j.liturgia || "",
      color: j.cor || "",
      season: seasonFor(j.liturgia, iso),
      sunday: new Date(iso + "T12:00:00Z").getUTCDay() === 0,
      readings: {
        first: read(first(L.primeiraLeitura)),
        psalm: ps && { ref: ps.referencia || "", refrain: clean(ps.refrao), text: clean(ps.texto) },
        second: read(first(L.segundaLeitura)),
        gospel: read(first(L.evangelho)),
      },
      antiphons: { entrance: clean(j.antifonas?.entrada), communion: clean(j.antifonas?.comunhao) },
      prayers: { collect: clean(j.oracoes?.coleta), offerings: clean(j.oracoes?.oferendas), communion: clean(j.oracoes?.comunhao) },
      source: "Liturgia Diária (CNBB)",
    };
  } catch {
    out = { date: iso, title: "", color: "", season: seasonByDate(iso), sunday: new Date(iso + "T12:00:00Z").getUTCDay() === 0, readings: {}, antiphons: {}, prayers: {}, source: "" };
  }
  // Leituras, salmo, aclamação e evangelho: Canção Nova (fonte principal). Antífonas e orações: a outra fonte.
  try {
    const cn = await cancaoNova(iso);
    if (cn?.readings?.gospel) {
      const title = cn.title.replace(/\s*\|\s*[^|]*-feira$|\s*\|\s*(Sábado|Domingo)$/i, "").trim() || out.title;
      out = { ...out, title, color: cn.color || out.color, season: seasonFor(title, iso), readings: { ...out.readings, ...Object.fromEntries(Object.entries(cn.readings).filter(([, v]) => v)) }, source: cn.source };
    }
  } catch (e) {
    console.log("Canção Nova indisponível:", e.message);
  }
  cache.set(iso, out);
  return out;
}

// Que momentos cantar e em que texto cada um se inspira
export function massPlan(lit) {
  const R = lit.readings || {}, A = lit.antiphons || {}, P = lit.prayers || {};
  const gospel = R.gospel ? `${R.gospel.ref}: ${R.gospel.text}` : "";
  const noGloria = /advento|quaresma/i.test(lit.season) && !/solenidade|imaculada/i.test(lit.title);
  const lent = /quaresma|semana santa/i.test(lit.season);
  const items = [
    { moment: "Acolhida", reading: gospel },
    { moment: "Entrada", reading: [A.entrance && `Antífona de entrada: ${A.entrance}`, gospel].filter(Boolean).join("\n\n") },
    { moment: "Aspersão", reading: gospel },
    { moment: "Ato Penitencial (Kyrie)" },
    !noGloria && { moment: "Glória" },
    { moment: "Bíblia (Entrada da Palavra)", reading: gospel },
    R.psalm && { moment: "Salmo Responsorial", idea: `Use EXATAMENTE este refrão do salmo do dia: "${R.psalm.refrain}"`, reading: `${R.psalm.ref} — Refrão: ${R.psalm.refrain}\n${R.psalm.text}` },
    R.acclamation && {
      // texto litúrgico: refrão (Aleluia ou, na Quaresma, louvor a Cristo) + o versículo do dia, sem invenção
      moment: "Aclamação ao Evangelho",
      fixed: (() => {
        const verse = R.acclamation.split("\n").map((l) => l.trim()).filter((l) => l && !/^aleluia[, !.aleluia]*$/i.test(l));
        const refrain = lent ? ["Louvor e honra a vós, Senhor Jesus!"] : ["Aleluia, aleluia, aleluia!"];
        return {
          title: lent ? "Louvor e honra a vós" : "Aleluia do dia",
          sections: [{ name: "Refrão", lines: refrain }, { name: "Versículo", lines: verse.length ? verse : refrain }, { name: "Refrão", lines: refrain }],
          references: [R.gospel?.ref].filter(Boolean),
          notes: "Versículo da aclamação da liturgia do dia.",
          official: true,
        };
      })(),
    },
    !R.acclamation && {
      moment: "Aclamação ao Evangelho",
      idea: [lent ? "Sem aleluia (tempo penitencial): use \"Louvor a vós, ó Cristo\"" : "", R.acclamation ? `Use o versículo da aclamação do dia: "${R.acclamation.split("\n").pop()}"` : ""].filter(Boolean).join(". "),
      reading: [R.acclamation && `Aclamação do dia: ${R.acclamation}`, gospel].filter(Boolean).join("\n\n"),
    },
    { moment: "Apresentação das Oferendas", reading: [P.offerings && `Oração sobre as oferendas: ${P.offerings}`, gospel].filter(Boolean).join("\n\n") },
    { moment: "Santo" },
    { moment: "Cordeiro de Deus" },
    { moment: "Comunhão", reading: [A.communion && `Antífona da comunhão: ${A.communion}`, gospel].filter(Boolean).join("\n\n") },
    { moment: "Ação de Graças (Pós-Comunhão)", reading: gospel },
    { moment: "Aniversário" },
    { moment: "Final (Envio)", reading: gospel },
  ].filter(Boolean);
  return items.map((it) => ({ ...it, reading: (it.reading || "").slice(0, 3800) }));
}
