// =====================================================================
// LETRAS: compositor por IA (Pollinations, gratuito) + textos do Missal
// =====================================================================

const LANG_NAMES = { pt: "Português do Brasil", en: "Inglês", es: "Espanhol" };
const POLL_URL = "https://text.pollinations.ai/openai";
const POLL_KEY = (process.env.POLLINATIONS_KEY || "").trim(); // opcional: aumenta o limite

// ---------- Textos oficiais do Ordinário da Missa (Missal Romano, 3ª ed. típica, Brasil) ----------
// Por orientação litúrgica, estas partes devem manter o texto oficial.
export const OFFICIAL_TEXTS = {
  "Ato Penitencial (Kyrie)": {
    title: "Senhor, Tende Piedade",
    sections: [
      { name: "Senhor", lines: ["Senhor, tende piedade de nós.", "Senhor, tende piedade de nós."] },
      { name: "Cristo", lines: ["Cristo, tende piedade de nós.", "Cristo, tende piedade de nós."] },
      { name: "Senhor (final)", lines: ["Senhor, tende piedade de nós.", "Senhor, tende piedade de nós."] },
    ],
  },
  "Glória": {
    title: "Glória a Deus nas Alturas",
    sections: [
      { name: "Refrão", lines: ["Glória a Deus nas alturas,", "e paz na terra aos homens por ele amados."] },
      {
        name: "Estrofe 1",
        lines: [
          "Senhor Deus, rei dos céus, Deus Pai todo-poderoso:",
          "nós vos louvamos, nós vos bendizemos,",
          "nós vos adoramos, nós vos glorificamos,",
          "nós vos damos graças por vossa imensa glória.",
        ],
      },
      {
        name: "Estrofe 2",
        lines: [
          "Senhor Jesus Cristo, Filho Unigênito,",
          "Senhor Deus, Cordeiro de Deus, Filho de Deus Pai,",
          "vós que tirais o pecado do mundo, tende piedade de nós.",
          "Vós que tirais o pecado do mundo, acolhei a nossa súplica.",
          "Vós que estais à direita do Pai, tende piedade de nós.",
        ],
      },
      {
        name: "Estrofe 3",
        lines: [
          "Só vós sois o Santo, só vós, o Senhor,",
          "só vós, o Altíssimo, Jesus Cristo,",
          "com o Espírito Santo, na glória de Deus Pai. Amém.",
        ],
      },
    ],
  },
  "Santo": {
    title: "Santo",
    sections: [
      { name: "Santo", lines: ["Santo, Santo, Santo,", "Senhor, Deus do universo!", "O céu e a terra proclamam a vossa glória."] },
      { name: "Hosana", lines: ["Hosana nas alturas!"] },
      { name: "Bendito", lines: ["Bendito o que vem em nome do Senhor!"] },
      { name: "Hosana (final)", lines: ["Hosana nas alturas!"] },
    ],
  },
  "Cordeiro de Deus": {
    title: "Cordeiro de Deus",
    sections: [
      { name: "Invocação 1", lines: ["Cordeiro de Deus, que tirais o pecado do mundo,", "tende piedade de nós."] },
      { name: "Invocação 2", lines: ["Cordeiro de Deus, que tirais o pecado do mundo,", "tende piedade de nós."] },
      { name: "Invocação 3", lines: ["Cordeiro de Deus, que tirais o pecado do mundo,", "dai-nos a paz."] },
    ],
  },
};

// O que cada momento da Missa pede da letra
const MOMENT_GUIDE = {
  "Acolhida": "Canto de acolhida, antes da Entrada: dá boas-vindas à comunidade e aos visitantes, alegria do encontro, Deus que nos reúne como família; tom caloroso e simples.",
  "Aspersão": "Rito da aspersão com água benta (memória do Batismo, sobretudo aos domingos e no Tempo Pascal): água viva, purificação, renovação das promessas batismais, Ez 36,25-26; Sl 50(51); Jo 7,37-39; tom sereno e processional.",
  "Bíblia (Entrada da Palavra)": "Canto para a entrada/entronização da Bíblia: Palavra de Deus como luz, alimento e caminho (Sl 118(119),105; Hb 4,12; Is 55,10-11); reverência e alegria ao acolher a Palavra; tom processional.",
  "Vela": "Canto para o acendimento das velas (coroa do Advento, vela do Batismo, Círio Pascal, procissão de luz): Cristo, luz do mundo (Jo 8,12), sermos luz (Mt 5,14-16), esperança que vence as trevas; tom contemplativo e luminoso.",
  "Aniversário": "Canto para a bênção dos aniversariantes na Missa: gratidão a Deus pelo dom da vida e por mais um ano, pedido de bênção e proteção (Nm 6,24-26; Sl 138(139)); tom alegre, festivo e orante, sem parecer 'parabéns' profano.",
  "Entrada": "Canto de abertura: reúne a assembleia, introduz o mistério do dia e o tempo litúrgico; tom de acolhida e caminhada do povo de Deus.",
  "Salmo Responsorial": "Use FIELMENTE o salmo indicado na leitura base: o refrão é a resposta do povo (curto, 1 ou 2 versos) e as estrofes parafraseiam de perto os versículos do salmo, sem inventar conteúdo.",
  "Aclamação ao Evangelho": "Aclamação: refrão com 'Aleluia' (ou, na Quaresma, SEM aleluia, usando 'Louvor e glória a ti, Senhor Jesus Cristo, Palavra de Deus'); um único versículo curto ligado ao Evangelho do dia.",
  "Apresentação das Oferendas": "Ofertório: oferta do pão e do vinho, fruto da terra e do trabalho humano, entrega da vida a Deus, partilha.",
  "Comunhão": "Comunhão: Eucaristia, Corpo e Sangue de Cristo, unidade, intimidade com Jesus; ligada ao Evangelho do dia; tom sereno e processional.",
  "Ação de Graças (Pós-Comunhão)": "Ação de graças após a comunhão: louvor, gratidão, contemplação.",
  "Final (Envio)": "Canto final: envio em missão, alegria, testemunho; pode ser mariano.",
  "Canto a Maria": "Canto mariano: Maria como Mãe de Deus e nossa, modelo de fé, que conduz a Jesus. Nunca atribua a Maria adoração ou divindade (adoração só a Deus).",
  "Adoração ao Santíssimo": "Adoração eucarística: contemplação de Jesus presente na Eucaristia, silêncio, entrega; frases curtas, repetitivas, orantes.",
  "Louvor / Grupo de Oração": "Louvor carismático: louvor a Deus, ação do Espírito Santo, alegria; linguagem atual mas fiel à doutrina.",
  "Casamento / Sacramentos": "Para celebração de sacramento: amor de Deus, aliança, graça, família, fidelidade.",
  "Livre (tema religioso)": "Canto religioso católico livre sobre o tema pedido.",
};

// Como cada momento deve SOAR (vai para o gerador de música)
const MOMENT_TAGS = {
  "Acolhida": "warm welcoming, joyful gathering song",
  "Entrada": "processional entrance hymn, festive, majestic",
  "Aspersão": "flowing water imagery, serene processional, baptismal",
  "Ato Penitencial (Kyrie)": "penitential litany, humble, call and response",
  "Glória": "festive gloria, jubilant, bright",
  "Bíblia (Entrada da Palavra)": "reverent processional, solemn and joyful",
  "Salmo Responsorial": "responsorial psalm, cantor verses and congregational refrain, gentle",
  "Aclamação ao Evangelho": "short festive acclamation, alleluia, bright and uplifting",
  "Apresentação das Oferendas": "offertory hymn, gentle, flowing",
  "Santo": "sanctus acclamation, majestic, triumphant hosanna",
  "Cordeiro de Deus": "agnus dei litany, calm, supplicant",
  "Comunhão": "communion hymn, intimate, meditative, gentle processional",
  "Ação de Graças (Pós-Comunhão)": "thanksgiving hymn, contemplative, grateful",
  "Aniversário": "joyful blessing song, festive and prayerful",
  "Final (Envio)": "recessional sending hymn, joyful, energetic",
  "Vela": "luminous, contemplative, candlelight atmosphere",
  "Canto a Maria": "marian hymn, tender, devotional",
  "Adoração ao Santíssimo": "eucharistic adoration, very soft, meditative, sustained",
  "Louvor / Grupo de Oração": "charismatic praise, uplifting, joyful",
  "Casamento / Sacramentos": "wedding sacred song, romantic and reverent",
};

const FORM_GUIDE = {
  "Refrão + estrofes": "Forma de assembleia: REFRÃO curto e marcante (2 a 4 versos) que se repete depois de cada ESTROFE. Todas as estrofes com o mesmo número de versos, a mesma métrica e o mesmo esquema de rima. Nomeie as seções 'Refrão', 'Estrofe 1', 'Estrofe 2'… e repita a seção 'Refrão' entre elas.",
  "Hino estrófico": "Hino: apenas estrofes (4 versos cada), todas com a mesma métrica e rima, para serem cantadas com a mesma melodia; última estrofe doxológica (louvor à Santíssima Trindade).",
  "Responsorial (solista e povo)": "Forma responsorial: seções 'Solista' (versos do salmista) alternadas com 'Resposta' (o povo repete sempre o mesmo refrão curto).",
  "Mantra / Repetitivo (estilo Taizé)": "Mantra orante: 1 ou 2 frases curtas e bíblicas, repetidas várias vezes; poucas palavras, muita oração.",
};

const SYSTEM_CATHOLIC = `Você é um compositor de música litúrgica católica, com formação em liturgia, teologia e música sacra, que escreve cantos para serem cantados pela assembleia na Santa Missa no Brasil.
Princípios obrigatórios:
1. Fidelidade à Sagrada Escritura, ao Catecismo e ao Missal; nada de erros doutrinais. Adoração só à Santíssima Trindade; Maria e os santos são venerados e intercedem.
2. Texto da assembleia: prefira "nós" (povo de Deus) a "eu"; linguagem reverente, poética e simples, sem gírias.
3. Cantabilidade: versos curtos, mesma métrica (mesmo número de sílabas poéticas) entre versos correspondentes, rimas naturais e consistentes, refrão fácil de memorizar.
4. Respeite o tempo litúrgico: Advento (espera, vigilância, esperança, sem Glória); Natal (encarnação, alegria); Quaresma (conversão, penitência, misericórdia, SEM a palavra "aleluia"); Páscoa (ressurreição, aleluia); Pentecostes (Espírito Santo); Tempo Comum (seguimento, Palavra).
5. Se houver leitura base, inspire-se nela de perto e cite as referências bíblicas usadas.
6. Escreva ORIGINAL: não copie cantos existentes.
7. SENTIDO acima de tudo: a letra tem UMA ideia central, dita no refrão; cada estrofe desenvolve essa ideia num passo claro (ex.: quem é Deus → o que Ele faz por nós → nossa resposta). Cada verso é uma frase completa e compreensível, ligada ao verso anterior. Nada de versos soltos só para rimar.
8. Português natural e correto: ordem direta das palavras (sem inversões forçadas tipo "a ti louvor nós vamos dar"), concordância e regência corretas, palavras que o povo usa. Se a rima forçar uma frase estranha, troque a rima, não o sentido.
9. Imagens concretas e coerentes (luz, pão, caminho, pastor), sem misturar metáforas que se contradizem.
Responda SOMENTE com JSON válido, sem texto fora dele:
{"title":"título curto","styles":["4 a 6 tags EM INGLÊS do som sacro: estilo, instrumentos, clima"],"references":["referências bíblicas usadas, ex.: Jo 6,35"],"notes":"1 frase sobre como cantar (quem canta o quê)","sections":[{"name":"Refrão|Estrofe 1|…","lines":["verso","verso"]}]}
Cada verso com no máximo 70 caracteres.`;

const SYSTEM_FREE = `Você é um compositor profissional. Escreva músicas ORIGINAIS, cantáveis, com rima, métrica consistente e um refrão marcante e repetível.
Nunca copie letras existentes nem cite artistas reais.
Responda SOMENTE com JSON válido, sem texto fora dele:
{"title":"título curto e criativo","styles":["5 a 8 tags EM INGLÊS: gênero, instrumentos, clima"],"references":[],"notes":"","sections":[{"name":"Intro|Verso 1|Pré-refrão|Refrão|Verso 2|Ponte|Final","lines":["verso"]}]}
Regras: a letra conta UMA história ou ideia central, com começo, meio e fim; o refrão resume essa ideia; cada verso é uma frase completa e ligada ao anterior; linguagem do dia a dia, ordem direta, gramática correta; imagens concretas; nada de versos soltos só para rimar (se a rima forçar a frase, troque a rima); revise para que faça sentido e soe natural; respeite o tamanho pedido; versos com no máximo 90 caracteres; seções instrumentais têm "lines": [].`;

// ---------- Utilidades ----------
const strList = (v, n, len = 60) =>
  (Array.isArray(v) ? v : []).map((x) => String(x).slice(0, len)).filter(Boolean).slice(0, n);
const str = (v, len, def = "") => String(v ?? def).slice(0, len);

export function cleanOptions(o = {}) {
  return {
    mode: o.mode === "livre" ? "livre" : "catolica",
    moment: str(o.moment, 60),
    season: str(o.season, 60),
    occasion: str(o.occasion, 200),
    reading: str(o.reading, 4000),
    form: str(o.form, 60, "Refrão + estrofes"),
    genre: str(o.genre, 40, "Canto Litúrgico"),
    genreTags: str(o.genreTags, 160, "catholic liturgical hymn"),
    moods: strList(o.moods, 3),
    moodTags: strList(o.moodTags, 3),
    // sem andamento escolhido: 0 (o planejador musical escolhe). Antes virava 40 BPM sem querer.
    bpm: Number(o.bpm) > 0 ? Math.max(40, Math.min(200, Math.round(Number(o.bpm)))) : 0,
    tempo: str(o.tempo, 20, "auto"),
    key: str(o.key, 30),
    instruments: strList(o.instruments, 5),
    instrumentTags: strList(o.instrumentTags, 5),
    voice: str(o.voice, 40, "Feminina"),
    voiceTags: strList(o.voiceTags, 3, 80),
    voiceStyles: strList(o.voiceStyles, 2),
    quality: o.quality === "high" ? "high" : "fast",
    chordProgression: str(o.chordProgression, 80).replace(/[^A-Ga-g0-9#/ mjsuadi°º+()]/g, ""),
  };
}

// Cifra enviada pela pessoa (formato ChordPro): mantém só acordes válidos
export function sanitizeChords(c) {
  if (!c || !Array.isArray(c.sections)) return null;
  const okChord = (x) => /^[A-G](#|b)?(maj7|maj|m7|m|7M|7|sus4|sus2|sus|dim|aug|add9|add11|6|9|11|13|4|°|º|\+|\(.{1,6}\))*(\/[A-G](#|b)?)?$/.test(x.trim());
  const sections = c.sections.slice(0, 20).map((s) => ({
    name: String(s.name || "").slice(0, 40),
    lines: (Array.isArray(s.lines) ? s.lines : []).slice(0, 20).map((l) => String(l).slice(0, 240).replace(/\[([^\]]{1,12})\]/g, (a, x) => (okChord(x) ? `[${x.trim()}]` : ""))),
  }));
  if (!sections.some((s) => s.lines.some((l) => /\[/.test(l)))) return null;
  return { key: String(c.key || "").slice(0, 8), progression: String(c.progression || "").slice(0, 120), sections, fromUser: true };
}

export function cleanPlan(raw, instrumental) {
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter((s) => s && s.name)
    .slice(0, 14)
    .map((s) => ({
      name: String(s.name).slice(0, 40),
      lines: instrumental
        ? []
        : (Array.isArray(s.lines) ? s.lines : []).map((l) => String(l).trim()).filter(Boolean).slice(0, 12),
    }));
  if (!sections.length) throw new Error("letra vazia");
  return {
    title: String(raw.title || "Sem título").slice(0, 120),
    styles: (Array.isArray(raw.styles) ? raw.styles : []).map(String).slice(0, 12),
    references: strList(raw.references, 8, 80),
    notes: String(raw.notes || "").slice(0, 300),
    official: Boolean(raw.official),
    sections,
  };
}

// Tags finais para o modelo de música: escolhas do usuário primeiro, depois as da IA
export function buildTags(o, aiStyles = []) {
  const tags = [o.genreTags, ...o.moodTags, ...o.instrumentTags, ...o.voiceTags];
  if (o.key) tags.push(`key of ${o.key}`);
  if (o.chordProgression) tags.push(`chord progression ${o.chordProgression}`);
  if (o.bpm) tags.push(`${o.bpm} BPM`);
  if (o.mode === "catolica") {
    if (MOMENT_TAGS[o.moment]) tags.splice(1, 0, MOMENT_TAGS[o.moment]); // o momento vem logo após o estilo
    tags.push("sacred, reverent, singable melody for congregation");
  }
  tags.push(...aiStyles.filter((s) => !/bpm|vocal|voice|key of|high quality|clear mix|polished/i.test(s)));
  const seen = new Set();
  const uniq = (list) =>
    list
      .flatMap((t) => String(t).split(","))
      .map((t) => t.trim())
      .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  // Som humano e natural: gravação ao vivo, com músicos e cantores de verdade, em vez do som
  // "perfeito demais" (e artificial) de produção polida. Sempre entra, nunca é cortado.
  const human = uniq(humanTags(o));
  return [...uniq(tags).slice(0, 22 - human.length), ...human].join(", ");
}

function humanTags(o) {
  const instrumental = o.voice === "Instrumental";
  const t = ["live recording, real musicians playing together", "organic dynamics, natural timing and groove", "warm acoustic room ambience, analog warmth"];
  if (!instrumental)
    t.unshift(
      o.mode === "catolica"
        ? "natural human voice singing with heartfelt emotion, audible breaths, sung in a real church"
        : "natural expressive human vocals, audible breaths, emotional phrasing",
    );
  return t;
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("sem JSON");
  return JSON.parse(text.slice(start, end + 1));
}

export class LyricsError extends Error {
  constructor(msg, retryAfter = 0) {
    super(msg);
    this.retryAfter = retryAfter;
  }
}

// Compositores melhores (modelos grandes, bons em português), gratuitos, tentados antes do Pollinations:
// - Google Gemini: chave grátis em aistudio.google.com → "Get API key" (GEMINI_API_KEY)
// - Hugging Face: token com a permissão "Make calls to Inference Providers" (LYRICS_HF_TOKEN ou HF_TOKEN)
const list = (v, d) => (v || d).split(",").map((s) => s.trim()).filter(Boolean);
const PROVIDERS = [
  {
    name: "Gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    token: (process.env.GEMINI_API_KEY || "").trim(),
    models: list(process.env.GEMINI_MODELS, "gemini-2.5-flash,gemini-2.0-flash"),
    offUntil: 0,
  },
  {
    name: "Hugging Face",
    url: "https://router.huggingface.co/v1/chat/completions",
    token: (process.env.LYRICS_HF_TOKEN || process.env.HF_TOKEN || "").trim(),
    models: list(process.env.LYRICS_MODELS, "Qwen/Qwen3-235B-A22B-Instruct-2507,meta-llama/Llama-3.3-70B-Instruct"),
    offUntil: 0,
  },
];

async function callProvider(p, system, user) {
  if (!p.token || Date.now() < p.offUntil) return null;
  for (const model of p.models) {
    try {
      const r = await fetch(p.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.token}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          temperature: 0.8,
          max_tokens: 2500,
        }),
        signal: AbortSignal.timeout(90000),
      });
      // chave sem permissão ou sem créditos: deixa de lado por 6 h e usa o próximo compositor
      if ([401, 402, 403].includes(r.status)) {
        p.offUntil = Date.now() + 6 * 3600 * 1000;
        console.log(`Compositor ${p.name} indisponível (${r.status}); usando o próximo`);
        return null;
      }
      if (!r.ok) {
        console.log(`Compositor ${p.name} ${model}: ${r.status}`);
        continue;
      }
      const data = await r.json();
      return extractJson(data.choices?.[0]?.message?.content || "");
    } catch (e) {
      console.log(`Compositor ${p.name} ${model} falhou:`, e.message);
    }
  }
  return null;
}

async function callLLM(system, user) {
  for (const p of PROVIDERS) {
    const out = await callProvider(p, system, user);
    if (out) return out;
  }
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(POLL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(POLL_KEY ? { Authorization: `Bearer ${POLL_KEY}` } : {}) },
        body: JSON.stringify({
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          reasoning_effort: "high", // o modelo gratuito pensa mais antes de escrever: letras mais coerentes
          seed: Math.floor(Math.random() * 1e9),
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (r.status === 402 || r.status === 429) {
        const wait = Number(r.headers.get("retry-after")) || 45;
        throw new LyricsError(`O compositor gratuito pede uma pausa de ${wait} segundos entre pedidos.`, wait);
      }
      if (!r.ok) throw new Error(`Pollinations ${r.status}`);
      const data = await r.json();
      return extractJson(data.choices?.[0]?.message?.content || "");
    } catch (e) {
      lastErr = e;
      if (e instanceof LyricsError) throw e;
    }
  }
  console.error("Erro letra:", lastErr);
  throw new LyricsError("Não consegui escrever a letra agora. Tente de novo em instantes.");
}

function sizeGuide(duration) {
  return duration <= 45
    ? "curta: refrão + 1 estrofe"
    : duration <= 100
      ? "média: refrão + 2 estrofes"
      : duration <= 200
        ? "completa: refrão + 3 estrofes (refrão repetido entre elas)"
        : "longa: refrão + 4 ou 5 estrofes, refrão repetido entre elas e no final";
}

export async function writeLyrics({ idea, language, duration, options: o }) {
  const instrumental = o.voice === "Instrumental";

  // Partes fixas do Ordinário: texto oficial do Missal
  if (o.mode === "catolica" && OFFICIAL_TEXTS[o.moment] && language === "pt") {
    const t = OFFICIAL_TEXTS[o.moment];
    return cleanPlan(
      {
        ...t,
        official: true,
        references: [],
        notes: "Texto oficial do Missal Romano (3ª edição típica). Confira sempre com o Missal da sua paróquia.",
      },
      instrumental,
    );
  }

  let system, user;
  if (o.mode === "catolica") {
    system = SYSTEM_CATHOLIC;
    user = `Componha um canto litúrgico católico:
- Momento da Missa: ${o.moment || "livre"} → ${MOMENT_GUIDE[o.moment] || MOMENT_GUIDE["Livre (tema religioso)"]}
- Tempo litúrgico: ${o.season || "Tempo Comum"}
${o.occasion ? `- Celebração/ocasião: ${o.occasion}\n` : ""}- Tema/pedido: ${idea || "inspire-se no momento e na leitura"}
${o.reading ? `- LEITURA BASE (inspire-se nela de perto):\n"""${o.reading}"""\n` : ""}- Forma: ${o.form} → ${FORM_GUIDE[o.form] || FORM_GUIDE["Refrão + estrofes"]}
- Estilo musical: ${o.genre}; clima: ${o.moods.join(", ") || "orante"}; andamento: ${o.bpm ? o.bpm + " BPM" : "adequado ao momento"}
- Quem canta: ${instrumental ? "ninguém (instrumental, lines vazio)" : [o.voice, ...o.voiceStyles].join(", ")}
- Idioma: ${LANG_NAMES[language] || language}
- Tamanho: ${sizeGuide(duration)} (cerca de ${duration} segundos)`;
  } else {
    system = SYSTEM_FREE;
    user = `Crie uma música:
- Tema/ideia: ${idea}
- Gênero: ${o.genre}
- Clima: ${o.moods.join(", ") || "à sua escolha"}
- Andamento: ${o.bpm ? `${o.bpm} BPM` : "típico do gênero"} (ajuste a métrica a esse ritmo)
- Instrumentos: ${o.instruments.join(", ") || "típicos do gênero"}
- Voz: ${instrumental ? "nenhuma (instrumental, lines vazio)" : [o.voice, ...o.voiceStyles].join(", ")}
${o.voice === "Dueto" ? "- Dueto: alterne partes entre as duas vozes e faça o refrão juntos.\n" : ""}- Idioma: ${LANG_NAMES[language] || language}
- Tamanho: ${sizeGuide(duration).replace("estrofe", "verso")}, para cerca de ${duration} segundos`;
  }

  let plan = cleanPlan(await callLLM(system, user), instrumental);
  if (!instrumental) plan = await reviewLyrics(plan, { system, language, brief: user });
  // Quaresma: nada de aleluia
  if (o.mode === "catolica" && /quaresma|semana santa/i.test(o.season)) {
    plan.sections.forEach((s) => (s.lines = s.lines.map((l) => l.replace(/\baleluia\b[!,.]?\s*/gi, "").trim()).filter(Boolean)));
  }
  return plan;
}

// ---------- Revisão: um 2º olhar que corrige o que não faz sentido ----------
// Se a revisão falhar (limite do compositor gratuito, resposta ruim), fica a 1ª versão.
async function reviewLyrics(draft, { system, language, brief }) {
  const current = draft.sections.map((s) => `[${s.name}]\n${s.lines.join("\n")}`).join("\n\n");
  const user = `Você agora é o REVISOR desta letra, recém-escrita para o pedido abaixo. Leia em voz alta, verso por verso, e corrija:
- versos sem sentido, frases incompletas ou que não se ligam ao verso anterior;
- rimas forçadas que deixaram a frase estranha ou com ordem invertida (troque a rima, preserve o sentido);
- erros de gramática, concordância, regência e palavras usadas com sentido errado;
- estrofes que fogem da ideia central do refrão ou se repetem sem acrescentar nada;
- métrica: versos correspondentes com número parecido de sílabas, para caber na mesma melodia.
Mantenha o que já está bom, o mesmo idioma (${LANG_NAMES[language] || language}), o título (a menos que não combine), os nomes e a ordem das seções. Devolva a letra COMPLETA no mesmo formato JSON.
PEDIDO ORIGINAL:
${brief}

LETRA A REVISAR — título: ${draft.title}
${current}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = cleanPlan(await callLLM(system, user), false);
      const lines = (p) => p.sections.reduce((a, s) => a + s.lines.length, 0);
      if (lines(out) < lines(draft) * 0.6) return draft; // revisão cortou demais: fica a original
      if (!out.references.length) out.references = draft.references;
      if (!out.styles.length) out.styles = draft.styles;
      return out;
    } catch (e) {
      // o compositor gratuito às vezes pede uma pausa curta entre pedidos
      if (e instanceof LyricsError && e.retryAfter && e.retryAfter <= 45 && attempt === 0) {
        await new Promise((r) => setTimeout(r, e.retryAfter * 1000));
        continue;
      }
      console.log("Revisão da letra pulada:", e.message);
      return draft;
    }
  }
  return draft;
}

// ---------- Cifra (acordes sobre a letra) ----------
const NOTE_RE = /^[A-G](#|b)?(m|maj7|m7|7|sus4|sus2|dim|aug|add9|6|9|°)?(\/[A-G](#|b)?)?$/;
export async function generateChords({ sections, key, mode, genre }) {
  const text = sections.map((s) => `[${s.name}]\n${s.lines.join("\n")}`).join("\n\n");
  const system = `Você é um músico e arranjador experiente${mode === "catolica" ? " de música litúrgica católica (ministério de música de paróquia)" : ""}.
Crie a CIFRA (acordes) para a letra, no tom pedido, com harmonia simples e bonita, fácil para violão/teclado de ${mode === "catolica" ? "ministério de música de igreja" : "músico amador"}.
Formato ChordPro: coloque cada acorde entre colchetes IMEDIATAMENTE antes da sílaba onde ele entra, ex.: "[G]Senhor, tende pie[D]dade de [Em]nós".
Use 1 a 3 acordes por verso. Use apenas acordes em notação americana (C, Dm, G7, Am/E…). NÃO altere nenhuma palavra da letra.
Responda SOMENTE com JSON: {"key":"tom","progression":"resumo da progressão do refrão, ex.: G – D – Em – C","sections":[{"name":"nome da seção","lines":["linha com [acordes]"]}]}`;
  const user = `Tom: ${key || "escolha o melhor tom para voz de assembleia (ex.: G ou D)"}\nEstilo: ${genre || "livre"}\nLetra:\n${text}`;
  const raw = await callLLM(system, user);
  const out = {
    key: String(raw.key || key || "").slice(0, 10),
    progression: String(raw.progression || "").slice(0, 120),
    sections: (Array.isArray(raw.sections) ? raw.sections : []).slice(0, 16).map((s) => ({
      name: String(s.name || "").slice(0, 40),
      // mantém só acordes válidos entre colchetes
      lines: (Array.isArray(s.lines) ? s.lines : []).slice(0, 14).map((l) =>
        String(l).slice(0, 200).replace(/\[([^\]]{1,12})\]/g, (all, c) => (NOTE_RE.test(c.trim()) ? `[${c.trim()}]` : "")),
      ),
    })),
  };
  if (!out.sections.length) throw new LyricsError("Não consegui montar a cifra agora. Tente de novo.");
  return out;
}

// ---------- Refinar uma letra existente ----------
export const REFINES = {
  biblica: "Deixe a letra mais bíblica: incorpore imagens e expressões da Sagrada Escritura (e cite as referências), sem perder a métrica.",
  simples: "Simplifique para a assembleia cantar: frases mais curtas, palavras comuns, refrão ainda mais fácil de memorizar.",
  poetica: "Deixe a letra mais poética e bela, com imagens mais ricas, mantendo a clareza e a doutrina.",
  rimas: "Melhore as rimas: rimas consistentes (mesmo esquema em todas as estrofes) e naturais, sem forçar.",
  metrica: "Corrija a métrica: versos correspondentes com o MESMO número de sílabas poéticas, para caber na mesma melodia.",
  refrao: "Reescreva só o refrão para ficar mais forte, curto e marcante; mantenha as estrofes.",
  estrofe: "Acrescente mais uma estrofe coerente com as outras (mesma métrica e rima) e repita o refrão depois dela.",
  curta: "Encurte a letra: mantenha o refrão e as melhores estrofes, com no máximo 2 estrofes.",
};

export async function refineLyrics({ plan, action, custom, options: o, language }) {
  const instruction = custom ? String(custom).slice(0, 500) : REFINES[action];
  if (!instruction) throw new LyricsError("Escolha como melhorar a letra.");
  const system = o.mode === "catolica" ? SYSTEM_CATHOLIC : SYSTEM_FREE;
  const current = plan.sections.map((s) => `[${s.name}]\n${s.lines.join("\n")}`).join("\n\n");
  const user = `Revise esta letra${o.mode === "catolica" ? ` de canto litúrgico (momento: ${o.moment || "livre"}; tempo: ${o.season || "Tempo Comum"})` : ""}.
Instrução: ${instruction}
Mantenha o mesmo idioma (${LANG_NAMES[language] || language}), o mesmo título (a menos que a instrução peça) e devolva a letra COMPLETA no mesmo formato JSON.
Título atual: ${plan.title}
Letra atual:
${current}`;
  const out = cleanPlan(await callLLM(system, user), false);
  if (!out.references.length) out.references = plan.references || [];
  return out;
}
