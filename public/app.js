/* =========================================================
   AcaiaMusic · Estúdio (front-end)
   ========================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------------- Utilidades ----------------
function toast(msg, isErr = false, ms = 4500) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", isErr);
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), ms);
}
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, credentials: "same-origin", ...opts });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && data.login) showLogin();
  if (!r.ok) throw Object.assign(new Error(data.error || `Erro ${r.status}`), { retryAfter: data.retryAfter || 0 });
  return data;
}
// Tela de entrada (só aparece quando o app está publicado com senha)
function showLogin() {
  const el = document.getElementById("login-screen");
  if (!el || !el.classList.contains("hidden")) return;
  el.classList.remove("hidden");
  setTimeout(() => document.getElementById("login-pass")?.focus(), 50);
}
document.getElementById("login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter || e.target.querySelector("button");
  btn.disabled = true;
  try {
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: document.getElementById("login-pass").value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Não consegui entrar.");
    location.reload();
  } catch (err) {
    document.getElementById("login-err").textContent = err.message;
    btn.disabled = false;
  }
});
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (sec) => (isFinite(sec) && sec >= 0 ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}` : "0:00");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STOP = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "em", "no", "na", "um", "uma", "the", "of", "la", "el", "y", "ao", "à"]);
const initials = (t) => {
  const words = (t || "").replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  const main = words.filter((w) => !STOP.has(w.toLowerCase()));
  return (main.length ? main : words).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "♪";
};
const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>';

// ---------------- Capas geradas ----------------
const PALETTES = [
  ["#1a0b2e", "#a855f7", "#ec4899", "#f97316"], ["#03142b", "#3b82f6", "#22d3ee", "#a5f3fc"],
  ["#1c0a0a", "#e11d48", "#f97316", "#fde047"], ["#021a14", "#10b981", "#84cc16", "#facc15"],
  ["#0f0b1f", "#6366f1", "#a855f7", "#f0abfc"], ["#1f1306", "#f59e0b", "#ef4444", "#fef3c7"],
  ["#071a1f", "#14b8a6", "#6366f1", "#f472b6"], ["#150a19", "#d946ef", "#8b5cf6", "#38bdf8"],
];
function rng(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function coverArt(seed, size = "") {
  const r = rng(seed);
  const [bg, c1, c2, c3] = PALETTES[Math.floor(r() * PALETTES.length)];
  const id = "g" + (seed >>> 0).toString(36) + Math.floor(r() * 1e6).toString(36);
  const style = Math.floor(r() * 3);
  let shapes = "";
  if (style === 0) {
    for (let i = 0; i < 4; i++) shapes += `<circle cx="${r() * 100}" cy="${r() * 100}" r="${25 + r() * 35}" fill="${[c1, c2, c3][i % 3]}" opacity="${0.55 + r() * 0.4}"/>`;
  } else if (style === 1) {
    const cx = 30 + r() * 40, cy = 30 + r() * 40;
    for (let i = 9; i > 0; i--) shapes += `<circle cx="${cx}" cy="${cy}" r="${i * 9}" fill="none" stroke="${[c1, c2, c3][i % 3]}" stroke-width="${2 + r() * 4}" opacity="${0.3 + i / 14}"/>`;
  } else {
    for (let i = 0; i < 6; i++) {
      const y = 15 + i * 15 + r() * 8, a = 8 + r() * 14;
      shapes += `<path d="M-10 ${y} C 25 ${y - a}, 55 ${y + a}, 110 ${y - a / 2}" fill="none" stroke="${[c1, c2, c3][i % 3]}" stroke-width="${3 + r() * 5}" stroke-linecap="round" opacity="${0.5 + r() * 0.5}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="art" viewBox="0 0 100 100" ${size} preserveAspectRatio="xMidYMid slice"><defs><filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${style === 0 ? 9 : 0.4}"/></filter><radialGradient id="${id}l" cx="25%" cy="20%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="100" height="100" fill="${bg}"/><g filter="url(#${id}b)">${shapes}</g><rect width="100" height="100" fill="url(#${id}l)"/></svg>`;
}
const coverHtml = (song, size, extra = "") =>
  song.illustration?.url
    ? `<div class="cover ${size} pic" ${extra}><img class="art" src="${esc(song.illustration.url)}" alt="" loading="lazy" decoding="async" /></div>` // capa com a imagem do tema
    : `<div class="cover ${size}" ${extra}>${coverArt(song.cover ?? 1)}<span>${esc(initials(song.title))}</span></div>`;
// imagem de capa de uma música (a ilustrada, se houver) — para mosaicos e fundos
const coverImg = (s) => (s.illustration?.url ? `<img class="art" src="${esc(s.illustration.url)}" alt="" loading="lazy" />` : coverArt(s.cover ?? 1));

// =========================================================
// CATÁLOGOS
// =========================================================
const MOMENTS = [
  ["Ritos iniciais", ["Acolhida", "Entrada", "Aspersão", "Ato Penitencial (Kyrie)", "Glória"]],
  ["Liturgia da Palavra", ["Bíblia (Entrada da Palavra)", "Salmo Responsorial", "Aclamação ao Evangelho"]],
  ["Liturgia Eucarística", ["Apresentação das Oferendas", "Santo", "Cordeiro de Deus", "Comunhão", "Ação de Graças (Pós-Comunhão)"]],
  ["Ritos finais", ["Aniversário", "Final (Envio)"]],
  ["Momentos especiais", ["Vela", "Canto a Maria", "Adoração ao Santíssimo", "Louvor / Grupo de Oração", "Casamento / Sacramentos", "Livre (tema religioso)"]],
];
const OFFICIAL = new Set(["Ato Penitencial (Kyrie)", "Glória", "Santo", "Cordeiro de Deus"]);
const SEASONS = [
  ["Tempo Comum", "#16a34a"], ["Advento", "#7c3aed"], ["Natal", "#fbbf24"], ["Quaresma", "#7c3aed"],
  ["Semana Santa", "#dc2626"], ["Páscoa", "#fde68a"], ["Pentecostes", "#dc2626"],
  ["Solenidade / Festa Mariana", "#60a5fa"], ["Festa de Santo", "#f87171"], ["Missa de Exéquias / 7º dia", "#9ca3af"],
];
const FORMS = [
  ["Refrão + estrofes", "assembleia canta o refrão"],
  ["Hino estrófico", "estrofes na mesma melodia"],
  ["Responsorial (solista e povo)", "salmista e resposta"],
  ["Mantra / Repetitivo (estilo Taizé)", "frases curtas e orantes"],
];
// [rótulo, tags em inglês para o modelo de música, BPM típico]
const GENRES = {
  "Católica": [
    ["Canto Litúrgico", "catholic liturgical hymn, congregational singing, church organ, reverent", 84],
    ["Louvor Católico", "catholic praise and worship, contemporary christian, acoustic guitar, uplifting", 96],
    ["Coral a 4 Vozes", "SATB choir, polyphonic sacred choral music, cathedral reverb", 72],
    ["Gregoriano", "gregorian chant inspired, monophonic sacred chant, cathedral reverb", 60],
    ["Violão de Missa", "acoustic folk hymn, fingerpicked guitar, simple congregational song", 88],
    ["Adoração", "soft adoration worship, ambient piano, intimate, contemplative", 68],
    ["Taizé / Meditativo", "taize style meditative chant, repetitive, choir and organ, peaceful", 66],
    ["Sertanejo Católico", "sertanejo, christian devotional, viola caipira, accordion", 92],
    ["Pop Católico", "christian pop, modern worship, uplifting", 108],
    ["Orquestral Sacro", "sacred orchestral, strings and choir, majestic", 76],
    ["Renovação Carismática", "charismatic catholic praise, full band, joyful clapping, uplifting worship", 112],
    ["Rock Católico", "christian rock, electric guitars, live drums, worship anthem", 120],
    ["Coral Gospel", "black gospel choir, hammond organ, soulful call and response, hand claps", 90],
    ["Celta Sacro", "celtic sacred hymn, tin whistle, harp, bodhran, ethereal choir", 80],
    ["Barroco Sacro", "baroque sacred music, harpsichord, chamber strings, choir, counterpoint", 76],
    ["A Cappella Sacro", "a cappella sacred vocal ensemble, rich close harmony, no instruments, church acoustics", 70],
    ["Forró Católico", "forró pé de serra, christian devotional, accordion, zabumba, triangle", 115],
    ["Samba Católico", "samba, christian devotional, cavaquinho, pandeiro, joyful community singing", 98],
    ["Reggae Católico", "christian reggae, offbeat guitar, warm bass, peaceful praise", 78],
    ["Infantil Católico", "children christian song, playful, simple melody, kids choir, hand claps", 108],
    ["Mariano Tradicional", "traditional marian hymn, gentle organ, tender devotional choir", 72],
    ["Natal Sacro", "christmas carol, sleigh bells, choir, warm orchestral, joyful nativity", 88],
  ],
  Brasileiros: [
    ["Sertanejo", "sertanejo, brazilian country, viola caipira, acoustic guitar", 95], ["Sertanejo Universitário", "sertanejo universitario, modern brazilian country pop, accordion, live band", 100],
    ["Modão / Moda de Viola", "moda de viola, traditional brazilian country, viola caipira duo, rustic", 85], ["Arrocha", "arrocha, romantic brazilian, keyboard, saxophone", 120],
    ["Pagode", "pagode, brazilian samba pop, cavaquinho, pandeiro, banjo", 100], ["Samba", "samba, brazilian samba, cavaquinho, pandeiro, surdo", 100],
    ["Samba de Raiz", "samba de raiz, roots samba, acoustic roda de samba, seven string guitar", 96], ["Samba-Enredo", "samba enredo, carnival parade, big percussion bateria, crowd choir", 140],
    ["Pagode Baiano", "pagode baiano, swingueira, bahia percussion, dance", 128], ["MPB", "mpb, brazilian popular music, acoustic, sophisticated harmony", 90],
    ["Bossa Nova", "bossa nova, smooth brazilian jazz, nylon guitar, soft vocals", 80], ["Choro", "choro, brazilian instrumental, flute, cavaquinho, seven string guitar, pandeiro", 110],
    ["Forró Pé de Serra", "forró pé de serra, accordion, zabumba, triangle, northeastern brazilian", 120], ["Forró Eletrônico", "forró eletrônico, keyboards, accordion, dance", 130],
    ["Piseiro", "piseiro, forró eletrônico, synth keyboard, danceable", 135], ["Xote", "xote, slow forró, accordion, romantic northeastern", 95],
    ["Baião", "baião, northeastern brazilian, accordion, zabumba, triangle", 115], ["Frevo", "frevo, pernambuco carnival, fast brass, horns", 150],
    ["Maracatu", "maracatu, afro-brazilian drums, alfaia, pernambuco", 100], ["Axé", "axé, brazilian carnival, bahia, brass and percussion", 125],
    ["Brega", "brega, romantic brazilian, keyboard, nostalgic", 110], ["Tecnobrega", "tecnobrega, electronic brega, para, synths", 140],
    ["Carimbó", "carimbó, amazonian brazilian, curimbó drums, banjo, maracas", 120], ["Lambada", "lambada, brazilian dance, accordion, guitar, tropical", 125],
    ["Vaneira / Gaúcho", "vaneira, southern brazilian gaucho music, accordion, acoustic", 125], ["Funk Carioca", "brazilian funk, baile funk, tamborzão beat", 130],
    ["Funk Melody", "funk melody, romantic brazilian funk, smooth vocals", 125], ["Rap Nacional", "brazilian rap, portuguese hip hop, boom bap", 90],
    ["Trap BR", "brazilian trap, 808 bass, hi-hats, melodic rap", 140], ["Rock Nacional", "brazilian rock, 80s brazilian rock band", 125],
    ["Reggae Nacional", "brazilian reggae, roots reggae, maranhão", 80], ["Gospel", "brazilian gospel, worship, powerful vocals, band", 85],
    ["Seresta", "seresta, brazilian serenade, nylon guitar, romantic nostalgic", 80], ["Jovem Guarda", "jovem guarda, brazilian 60s pop rock, organ, twang guitar", 125],
  ],
  Pop: [
    ["Pop", "pop, catchy", 110], ["Balada", "pop ballad, emotional, piano", 72], ["Indie Pop", "indie pop, dreamy", 105], ["Dance Pop", "dance pop, upbeat", 122],
    ["Synthpop", "synthpop, 80s synthesizers, retro", 115], ["Electropop", "electropop, glossy synths, punchy beat", 120], ["Teen Pop", "teen pop, bright, catchy hooks", 118],
    ["K-Pop", "k-pop, dynamic korean pop, layered production", 124], ["J-Pop", "j-pop, bright japanese pop", 130], ["Pop Acústico", "acoustic pop, guitar and piano, intimate", 95],
    ["Pop Anos 80", "80s pop, gated reverb drums, synths", 118], ["Pop Anos 90", "90s pop, r&b influenced, nostalgic", 100], ["Bedroom Pop", "bedroom pop, lo-fi, soft vocals", 90],
  ],
  Rock: [
    ["Rock", "rock, electric guitars", 120], ["Acústico", "acoustic rock, unplugged", 95], ["Pop Rock", "pop rock", 118], ["Rock Clássico", "classic rock, 70s, guitar solos", 120],
    ["Hard Rock", "hard rock, distorted guitars, powerful drums", 130], ["Alternativo", "alternative rock, 90s", 120], ["Indie Rock", "indie rock, jangly guitars", 125],
    ["Grunge", "grunge, heavy distorted guitars, raw vocals", 110], ["Punk Rock", "punk rock, fast, energetic", 170], ["Pop Punk", "pop punk, energetic, catchy", 165],
    ["Emo", "emo, emotional rock, dynamic", 150], ["Heavy Metal", "heavy metal, distorted guitars, double bass drums", 140], ["Metal Sinfônico", "symphonic metal, orchestra, choir, operatic vocals", 130],
    ["Blues Rock", "blues rock, gritty guitar", 105], ["Rock Progressivo", "progressive rock, complex arrangement, keyboards", 110], ["Surf Rock", "surf rock, reverb guitar, retro", 150],
    ["Rockabilly", "rockabilly, upright bass, slapback echo", 170], ["Post-Rock", "post-rock, atmospheric, crescendo, instrumental guitars", 100],
  ],
  Latino: [
    ["Reggaeton", "reggaeton, dembow beat, latin urban", 95], ["Bachata", "bachata, romantic, requinto guitar, bongos", 128], ["Salsa", "salsa, brass section, piano montuno, congas", 180],
    ["Merengue", "merengue, fast accordion, tambora, güira", 150], ["Cumbia", "cumbia, accordion, guacharaca, latin folk", 95], ["Tango", "tango, bandoneon, violin, piano, dramatic", 115],
    ["Flamenco", "flamenco, spanish guitar, palmas, passionate vocals", 120], ["Bolero", "bolero, romantic, nylon guitar, trio vocals", 80], ["Mariachi", "mariachi, trumpets, violins, vihuela", 120],
    ["Pop Latino", "latin pop, catchy, spanish guitar", 105], ["Latin Jazz", "latin jazz, congas, piano, brass", 100], ["Vallenato", "vallenato, accordion, caja, colombian", 110],
  ],
  "Hip-Hop / R&B": [
    ["Rap", "hip hop, rap, punchy drums", 90], ["Trap", "trap, 808 bass, rolling hi-hats", 140], ["Boom Bap", "boom bap, 90s hip hop, vinyl samples", 90],
    ["Lo-fi", "lo-fi hip hop, chill, vinyl crackle", 80], ["R&B", "r&b, smooth soul", 85], ["Neo Soul", "neo soul, warm rhodes, live bass", 80],
    ["Soul", "classic soul, 60s motown, horns", 100], ["Funk", "funk, slap bass, wah guitar, tight groove", 110], ["Disco", "disco, four on the floor, strings, funky bass", 120],
    ["Gospel Americano", "american gospel, choir, hammond organ, uplifting", 95], ["Drill", "drill, sliding 808, dark", 142],
  ],
  "Eletrônica": [
    ["Eletrônica", "electronic dance music", 126], ["House", "house music, four on the floor", 124], ["Deep House", "deep house, warm bass, mellow", 120],
    ["Techno", "techno, driving kick, hypnotic", 130], ["Trance", "trance, uplifting synths, euphoric", 138], ["Drum and Bass", "drum and bass, fast breakbeats, deep bass", 174],
    ["Dubstep", "dubstep, wobble bass, heavy drops", 140], ["EDM", "edm, big room, festival drop", 128], ["Synthwave", "synthwave, retro 80s, analog synths", 100],
    ["Ambient", "ambient, atmospheric pads, slow evolving", 60], ["Chillout", "chillout, downtempo, relaxing", 90], ["Afro House", "afro house, tribal percussion, deep groove", 122],
    ["Future Bass", "future bass, lush chords, vocal chops", 150], ["Tropical House", "tropical house, marimba, relaxed", 110],
  ],
  "Jazz / Blues": [
    ["Jazz", "jazz, swing", 110], ["Smooth Jazz", "smooth jazz, saxophone, mellow", 90], ["Big Band", "big band swing, brass section", 160],
    ["Jazz Vocal", "vocal jazz, piano trio, intimate club", 95], ["Bebop", "bebop, fast jazz, virtuosic", 200], ["Blues", "blues, electric guitar, 12 bar", 90],
    ["Blues Acústico", "acoustic delta blues, slide guitar, harmonica", 85], ["Swing", "swing, upbeat, vintage", 150], ["Lounge", "lounge, cocktail jazz, relaxed", 95],
  ],
  Mundo: [
    ["Country", "country, steel guitar, fiddle", 100], ["Bluegrass", "bluegrass, banjo, fiddle, mandolin", 130], ["Folk", "folk, acoustic storytelling", 95],
    ["Celta", "celtic folk, fiddle, tin whistle, bodhran", 110], ["Reggae", "reggae, offbeat guitar", 80], ["Dancehall", "dancehall, jamaican, riddim", 100],
    ["Afrobeats", "afrobeats, west african pop, percussive groove", 105], ["Amapiano", "amapiano, log drum, south african house", 112], ["Fado", "fado, portuguese guitar, melancholic", 75],
    ["Música Árabe", "arabic music, oud, darbuka, maqam", 95], ["Bollywood", "bollywood, indian film music, tabla, sitar", 110], ["Música Japonesa", "traditional japanese, koto, shakuhachi", 70],
    ["Havaiana", "hawaiian, ukulele, slide guitar, island", 95], ["Polca", "polka, accordion, oom-pah", 120], ["Klezmer", "klezmer, clarinet, violin, festive", 130],
  ],
  "Clássica / Trilha": [
    ["Clássica", "classical music, orchestra", 90], ["Piano Solo", "solo piano, expressive, intimate", 75], ["Ópera", "opera, operatic vocals, orchestra", 80],
    ["Barroco", "baroque, harpsichord, strings", 100], ["Música de Câmara", "chamber music, string quartet", 85], ["Trilha de Filme", "cinematic soundtrack, epic orchestral", 90],
    ["Épico Orquestral", "epic orchestral, choir, big drums, heroic", 100], ["Trilha de Game", "video game soundtrack, adventurous", 120], ["Musical / Broadway", "broadway musical theatre, showtune", 115],
    ["Infantil", "children song, playful", 110], ["Canção de Ninar", "lullaby, music box, very soft, soothing", 60], ["Jingle", "commercial jingle, catchy, upbeat", 120],
    ["Valsa", "waltz, 3/4 time, strings, elegant", 90], ["Marcha", "march, brass band, snare drums", 116],
  ],
};
const MOODS = {
  catolica: [
    ["Orante", "prayerful, devotional"], ["Contemplativo", "contemplative, meditative"], ["Solene", "solemn, majestic"],
    ["Festivo", "festive, joyful celebration"], ["Alegre", "joyful, bright"], ["Penitencial", "penitential, humble, sorrowful"],
    ["Esperançoso", "hopeful, uplifting"], ["Reverente", "reverent, sacred"], ["Acolhedor", "warm, welcoming"],
    ["Missionário", "missionary, triumphant, sending forth"], ["Terno", "tender, gentle"], ["Glorioso", "glorious, triumphant"],
  ],
  livre: [
    ["Feliz", "happy, joyful"], ["Animado", "energetic, upbeat"], ["Romântico", "romantic, tender"], ["Emocionante", "emotional, moving"],
    ["Triste", "sad, melancholic"], ["Relaxante", "relaxing, calm"], ["Nostálgico", "nostalgic, bittersweet"], ["Épico", "epic, powerful"],
    ["Motivacional", "motivational, uplifting"], ["Festa", "party, celebratory"], ["Sonhador", "dreamy, ethereal"], ["Engraçado", "funny, playful"],
  ],
};
const TEMPOS = [["auto", "Auto", "do estilo"], ["slow", "Lento", "60–80"], ["mid", "Moderado", "85–105"], ["fast", "Animado", "110–130"], ["vfast", "Rápido", "135+"]];
const TEMPO_BPM = { slow: 70, mid: 92, fast: 118, vfast: 140 };
const INSTRUMENTS = [
  ["Órgão de tubos", "pipe organ"], ["Órgão", "organ"], ["Piano", "piano"], ["Violão", "acoustic guitar"], ["Teclado/Synth", "synthesizer pads"],
  ["Cordas", "string section, violins"], ["Violino solo", "solo violin"], ["Violoncelo", "cello"], ["Flauta", "flute"], ["Harpa", "harp"],
  ["Sinos", "church bells"], ["Coral", "choir"], ["Baixo", "bass guitar"], ["Bateria", "drums"], ["Percussão", "percussion"],
  ["Guitarra", "electric guitar"], ["Sanfona", "accordion"], ["Viola Caipira", "viola caipira"], ["Cavaquinho", "cavaquinho"],
  ["Metais", "brass section"], ["Saxofone", "saxophone"], ["Ukulele", "ukulele"],
];
const VOICE_TYPES = [
  ["Feminina", "female vocals"], ["Masculina", "male vocals"], ["Dueto", "male and female duet vocals"],
  ["Coral (SATB)", "SATB choir vocals, four-part harmony"], ["Solista + Assembleia", "solo cantor with congregation response, call and response"],
  ["Coro infantil", "children's choir"], ["Coral feminino", "female choir"], ["Instrumental", "instrumental"],
];
const VOICE_STYLES = [
  ["Suave", "soft vocals"], ["Potente", "powerful vocals"], ["Lírica", "classical operatic vocals"], ["Emotiva", "emotional expressive vocals"],
  ["Aguda", "high-pitched vocals"], ["Grave", "deep low vocals"], ["Sussurrada", "breathy vocals"], ["Rouca", "raspy vocals"], ["Falsete", "falsetto"],
];
const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const IDEAS = {
  catolica: [
    "Comunhão sobre Jesus, o Pão da Vida (Jo 6)", "Entrada para o 1º Domingo do Advento", "Canto final mariano para o mês de maio",
    "Ofertório: entregar a vida e o trabalho a Deus", "Primeira Eucaristia das crianças", "Adoração: Jesus presente na Eucaristia",
  ],
  livre: [
    "Parabéns para minha mãe, que adora cozinhar", "Declaração de amor para 1 ano de namoro", "Hino motivacional para treinar",
    "Canção de ninar para um bebê chamado Theo", "Jingle para minha loja de açaí",
  ],
};

// =========================================================
// ESTADO
// =========================================================
const state = {
  mode: "catolica", moment: "Entrada", season: "Tempo Comum", form: "Refrão + estrofes",
  genre: GENRES["Católica"][0], genreCat: "Católica", moods: [MOODS.catolica[0]],
  tempo: "auto", bpm: 84, keyNote: "", keyScale: "major", instruments: [],
  voice: VOICE_TYPES[0], voiceStyles: [], quality: "fast",
  plan: null, songs: [], current: null, filter: "", libFilter: "all", sort: "new", lastOptions: null,
};

// =========================================================
// CONSOLE
// =========================================================
function button(cls, html, onclick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.innerHTML = html;
  b.onclick = onclick;
  return b;
}
function multiChips(box, items, key, max, onChange) {
  box.innerHTML = "";
  items.forEach((it) => {
    const on = state[key].some((x) => x[0] === it[0]);
    const full = !on && state[key].length >= max;
    box.appendChild(
      button(`chip${on ? " on" : ""}${full ? " dim" : ""}`, esc(it[0]), () => {
        if (on) state[key] = state[key].filter((x) => x[0] !== it[0]);
        else if (state[key].length < max) state[key] = [...state[key], it];
        else return toast(`Escolha no máximo ${max}.`);
        multiChips(box, items, key, max, onChange);
        onChange?.();
      }),
    );
  });
  onChange?.();
}
const sumList = (el, list, empty) => ($(el).textContent = list.length ? list.map((x) => x[0]).join(", ") : empty);

// Modo
$$("#mode-switch button").forEach((b) =>
  b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    $$("#mode-switch button").forEach((x) => x.classList.toggle("on", x === b));
    applyMode();
  }),
);
function applyMode() {
  const cat = state.mode === "catolica";
  $("#mod-liturgy").classList.toggle("hidden", !cat);
  $("#idea-title").textContent = cat ? "Tema do canto" : "Ideia da música";
  $("#idea").placeholder = cat
    ? "Ex.: Canto de comunhão sobre o amor de Jesus que se faz alimento, para a Missa de Primeira Eucaristia"
    : "Ex.: Uma música animada de aniversário para minha amiga Júlia, que ama praia e café";
  $("#ideas").innerHTML = "";
  IDEAS[state.mode].forEach((idea) =>
    $("#ideas").appendChild(button("idea", "💡 " + esc(idea), () => {
      $("#idea").value = idea;
      $("#idea").dispatchEvent(new Event("input"));
    })),
  );
  // estilo e clima coerentes com o modo
  if (cat && state.genreCat !== "Católica") {
    state.genreCat = "Católica";
    state.genre = GENRES["Católica"][0];
  } else if (!cat && state.genreCat === "Católica") {
    state.genreCat = "Pop";
    state.genre = GENRES.Pop[0];
  }
  state.moods = [MOODS[state.mode][0]];
  renderGenres();
  multiChips($("#mood-chips"), MOODS[state.mode], "moods", 3, () => sumList("#sum-mood", state.moods, "livre"));
  syncTempo();
  updateOfficial();
  updateLcd();
  if (typeof renderWizard === "function" && $("#wz-num")) renderWizard();
}

// Liturgia
MOMENTS.forEach(([group, items]) => {
  const row = document.createElement("div");
  row.className = "moment-group";
  row.innerHTML = `<span>${group}</span><div class="chips"></div>`;
  items.forEach((m) =>
    $(".chips", row).appendChild(
      button(`chip${m === state.moment ? " on" : ""}`, esc(m), (e) => {
        state.moment = m;
        $$("#moment-groups .chip").forEach((c) => c.classList.toggle("on", c === e.currentTarget));
        updateOfficial();
        updateLcd();
      }),
    ),
  );
  $("#moment-groups").appendChild(row);
});
function updateOfficial() {
  const off = state.mode === "catolica" && OFFICIAL.has(state.moment);
  $("#official-notice").classList.toggle("hidden", !off);
  $("#sum-moment").textContent = state.moment;
  $("#btn-lyrics span").textContent = off ? "Preparar texto do Missal" : "Compor letra";
}
SEASONS.forEach(([s]) => $("#season").insertAdjacentHTML("beforeend", `<option>${s}</option>`));
$("#season").addEventListener("change", (e) => {
  state.season = e.target.value;
  $("#season-dot").style.background = SEASONS.find((s) => s[0] === state.season)[1];
  $("#season-dot").style.color = $("#season-dot").style.background;
});
FORMS.forEach(([f, hint]) =>
  $("#form-opts").appendChild(
    button(f === state.form ? "on" : "", `<b>${esc(f)}</b><small>${esc(hint)}</small>`, (e) => {
      state.form = f;
      $$("#form-opts button").forEach((x) => x.classList.toggle("on", x === e.currentTarget));
    }),
  ),
);

// Estilo
function fold(t) { return String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
function renderGenres() {
  const cats = Object.keys(GENRES).filter((c) => state.mode === "catolica" || c !== "Católica");
  if (!cats.includes(state.genreCat)) state.genreCat = cats[0];
  const q = fold($("#genre-search")?.value.trim() || "");
  $("#genre-cats").innerHTML = "";
  $("#genre-cats").hidden = Boolean(q);
  cats.forEach((cat) => $("#genre-cats").appendChild(button(cat === state.genreCat ? "on" : "", esc(cat), () => ((state.genreCat = cat), renderGenres()))));
  $("#genre-chips").innerHTML = "";
  // com busca: procura em todas as categorias (nome e descrição do som)
  const list = q ? cats.flatMap((c) => GENRES[c]).filter((g) => fold(g[0] + " " + g[1]).includes(q)) : GENRES[state.genreCat];
  if (q && !list.length) $("#genre-chips").innerHTML = '<small class="dim">Nenhum estilo com esse nome.</small>';
  list.forEach((g) =>
    $("#genre-chips").appendChild(
      button(`chip${state.genre[0] === g[0] ? " on" : ""}`, esc(g[0]), () => {
        state.genre = g;
        renderGenres();
        syncTempo();
      }),
    ),
  );
  $("#sum-genre").textContent = state.genre[0];
}

$("#genre-search")?.addEventListener("input", () => renderGenres());

// Tempo
function syncTempo() {
  if (state.tempo === "auto") state.bpm = state.genre[2];
  $("#bpm").value = state.bpm;
  $("#bpm-out").textContent = state.bpm;
  $("#sum-tempo").textContent = `${state.tempo === "auto" ? "auto · " : ""}${state.bpm} BPM · ${keyLabel()}`;
  updateLcd();
}
function setBpm(v, manual = true) {
  state.bpm = Math.max(40, Math.min(180, Math.round(v)));
  if (manual && state.tempo === "auto") {
    state.tempo = "manual";
    $$("#tempo-presets button").forEach((b) => b.classList.remove("on"));
  }
  syncTempo();
}
TEMPOS.forEach(([id, label, hint]) =>
  $("#tempo-presets").appendChild(
    button(id === state.tempo ? "on" : "", `<b>${label}</b><small>${hint}</small>`, (e) => {
      state.tempo = id;
      $$("#tempo-presets button").forEach((b) => b.classList.toggle("on", b === e.currentTarget));
      if (TEMPO_BPM[id]) state.bpm = TEMPO_BPM[id];
      syncTempo();
    }),
  ),
);
$("#bpm").addEventListener("input", (e) => setBpm(Number(e.target.value)));
$("#bpm-minus").onclick = () => setBpm(state.bpm - 1);
$("#bpm-plus").onclick = () => setBpm(state.bpm + 1);
let taps = [];
$("#tap").onclick = (e) => {
  const now = performance.now();
  taps = taps.filter((t) => now - t < 2500);
  taps.push(now);
  e.currentTarget.classList.add("hit");
  setTimeout(() => e.currentTarget.classList.remove("hit"), 90);
  if (taps.length >= 3) {
    const gaps = taps.slice(1).map((t, i) => t - taps[i]);
    setBpm(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
  } else toast("Continue tocando no ritmo…", false, 1200);
};
// Tom
$("#key-note").innerHTML = `<option value="">Auto</option>` + KEYS.map((k) => `<option>${k}</option>`).join("");
$("#key-note").addEventListener("change", (e) => ((state.keyNote = e.target.value), syncTempo()));
$$("#key-scale button").forEach((b) =>
  b.addEventListener("click", () => {
    state.keyScale = b.dataset.s;
    $$("#key-scale button").forEach((x) => x.classList.toggle("on", x === b));
    syncTempo();
  }),
);
const keyLabel = () => (state.keyNote ? `${state.keyNote}${state.keyScale === "minor" ? "m" : ""}` : "tom auto");
const keyTag = () => (state.keyNote ? `${state.keyNote} ${state.keyScale === "minor" ? "minor" : "major"}` : "");

// Vocais
function syncVoice() {
  const inst = state.voice[0] === "Instrumental";
  $("#voice-style-wrap").classList.toggle("hidden", inst);
  $("#sum-voice").textContent = inst ? "sem voz" : [state.voice[0], ...state.voiceStyles.map((v) => v[0])].join(" · ");
}
VOICE_TYPES.forEach((v) =>
  $("#voice-type").appendChild(
    button(v === state.voice ? "on" : "", esc(v[0]), (e) => {
      state.voice = v;
      $$("#voice-type button").forEach((b) => b.classList.toggle("on", b === e.currentTarget));
      syncVoice();
    }),
  ),
);

// Saída
$("#duration").addEventListener("input", (e) => {
  $("#duration-out").textContent = fmt(Number(e.target.value));
  updateLcd();
});
$$("#quality button").forEach((b) =>
  b.addEventListener("click", () => {
    state.quality = b.dataset.q;
    $$("#quality button").forEach((x) => x.classList.toggle("on", x === b));
  }),
);
$("#idea").addEventListener("input", (e) => ($("#idea-count").textContent = `${e.target.value.length}/1500`));
// Pré-aquecimento: ao começar a escrever, o app já liga o estúdio de GPU (leva ~4 min);
// quando a pessoa tocar em "Criar", ele está pronto. No máximo 1 aviso a cada 4 min.
let warmedAt = 0;
function warmStudio() {
  if (Date.now() - warmedAt < 4 * 60 * 1000) return;
  warmedAt = Date.now();
  fetch("/api/studio/warm", { method: "POST" }).catch(() => {});
}
["idea", "reading", "lyrics"].forEach((id) => $("#" + id)?.addEventListener("input", warmStudio));

// Áudio de referência
$("#ref-file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 10 * 1024 * 1024) {
    e.target.value = "";
    return toast("O áudio de referência pode ter no máximo 10 MB.", true);
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.reference = { name: f.name, data: reader.result };
    $("#ref-label").textContent = f.name;
    $("#ref-sub").textContent = `${(f.size / 1024 / 1024).toFixed(1)} MB · a IA vai se inspirar neste áudio`;
    $("#ref-drop").classList.add("has");
    $("#ref-clear").classList.remove("hidden");
    $("#ref-audio").src = reader.result;
    $("#ref-audio").classList.remove("hidden");
  };
  reader.readAsDataURL(f);
});
$("#ref-clear").addEventListener("click", (e) => {
  e.preventDefault();
  state.reference = null;
  $("#ref-file").value = "";
  $("#ref-label").textContent = "Enviar um áudio para a IA se inspirar";
  $("#ref-sub").textContent = "MP3, WAV ou M4A · até 10 MB · a IA imita o estilo, o clima e a sonoridade";
  $("#ref-drop").classList.remove("has");
  $("#ref-clear").classList.add("hidden");
  $("#ref-audio").classList.add("hidden");
  $("#ref-audio").removeAttribute("src");
});

function updateLcd() {
  $("#lcd-mode").textContent = state.mode === "catolica" ? "LITÚRGICO" : "LIVRE";
  $("#lcd-bpm").textContent = state.bpm;
  $("#lcd-key").textContent = state.keyNote ? keyLabel() : "AUTO";
  $("#lcd-dur").textContent = fmt(Number($("#duration").value));
  $("#lcd-moment").textContent = (state.mode === "catolica" ? state.moment : state.genre[0]).toUpperCase();
  $("#lcd-moment").previousElementSibling.textContent = state.mode === "catolica" ? "MOMENTO" : "ESTILO";
}

function musicOptions() {
  const instrumental = state.voice[0] === "Instrumental";
  return {
    mode: state.mode,
    moment: state.mode === "catolica" ? state.moment : "",
    season: state.mode === "catolica" ? state.season : "",
    occasion: state.mode === "catolica" ? $("#occasion").value.trim() : "",
    reading: state.mode === "catolica" ? $("#reading").value.trim() : "",
    form: state.form,
    genre: state.genre[0],
    genreTags: state.genre[1],
    moods: state.moods.map((m) => m[0]),
    moodTags: state.moods.map((m) => m[1]),
    bpm: state.bpm,
    tempo: state.tempo,
    key: keyTag(),
    instruments: state.instruments.map((i) => i[0]),
    instrumentTags: state.instruments.map((i) => i[1]),
    voice: state.voice[0],
    voiceTags: [state.voice[1], ...(instrumental ? [] : state.voiceStyles.map((v) => v[1]))],
    voiceStyles: instrumental ? [] : state.voiceStyles.map((v) => v[0]),
    quality: state.quality,
  };
}

// =========================================================
// CADERNO DE LETRA
// =========================================================
const planToText = (plan) => (plan.sections || []).map((s) => `[${s.name}]\n${s.lines.join("\n")}`).join("\n\n");

// ---------- Cifras dentro da letra ----------
const CHORD_RE = /^[A-G](#|b)?(maj7|maj|m7|m|7M|7|sus4|sus2|sus|dim|aug|add9|add11|6|9|11|13|4|°|º|\+|\(.{1,6}\))*(\/[A-G](#|b)?)?$/;
const isChord = (t) => CHORD_RE.test(String(t).trim());
const isHeader = (line) => {
  const m = line.trim().match(/^\[([^\[\]]+)\]$/);
  return m && !isChord(m[1]) ? m[1].trim() : null;
};
// linha só com acordes: "G   D/F#   Em" ou "[G] [D] [Em]"
function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/^\[|\]$/g, "").replace(/[|()]/g, ""));
  return toks.length > 0 && toks.every((t) => !t || /^[-x2]+$/.test(t) || isChord(t));
}
const stripChordTokens = (line) => line.replace(/\[([^\]]{1,12})\]/g, (a, c) => (isChord(c) ? "" : a)).replace(/\s{2,}/g, " ").trim();

// Converte "acordes em cima da letra" para o formato ChordPro "[G]Se[D]nhor"
function toChordPro(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && !isHeader(l) && isChordLine(l) && !/\[/.test(l)) {
      const next = lines[i + 1];
      if (next !== undefined && next.trim() && !isHeader(next) && !isChordLine(next)) {
        const pos = [];
        l.replace(/\S+/g, (tok, p) => pos.push([p, tok]));
        let lyr = next;
        for (const [p, tok] of pos.reverse()) {
          const at = Math.min(p, lyr.length);
          lyr = lyr.slice(0, at).padEnd(at) + `[${tok}]` + lyr.slice(at);
        }
        out.push(lyr);
        i++;
        continue;
      }
      out.push(l.trim().split(/\s+/).map((t) => `[${t}]`).join(" "));
      continue;
    }
    out.push(l);
  }
  return out.join("\n");
}

// Lê a cifra escrita pela pessoa: tom (1º acorde), progressão e seções com acordes
function extractChords(text) {
  const pro = toChordPro(text);
  const sections = [];
  let cur = null;
  const all = [];
  for (const raw of pro.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = isHeader(line);
    if (h) {
      sections.push((cur = { name: h, lines: [] }));
      continue;
    }
    const chords = [...line.matchAll(/\[([^\]]{1,12})\]/g)].map((m) => m[1]).filter(isChord);
    if (!chords.length) {
      if (cur) cur.lines.push(line);
      continue;
    }
    if (!cur) sections.push((cur = { name: "Estrofe", lines: [] }));
    cur.lines.push(line);
    all.push(...chords);
  }
  if (!all.length) return null;
  const chorus = sections.find((s) => /refr|resposta|ant[ií]fona/i.test(s.name));
  const seq = (chorus ? [...chorus.lines.join(" ").matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]).filter(isChord) : all);
  const prog = [];
  for (const c of seq) if (prog[prog.length - 1] !== c && prog.length < 6) prog.push(c);
  return { key: chordKey(all[0]), progression: prog.join(" – "), sections };
}
// "Em7/B" -> "Em"; "Gmaj7" -> "G"
function chordKey(ch) {
  const m = String(ch).match(/^([A-G](?:#|b)?)(.*)$/);
  if (!m) return "";
  const rest = m[2].replace(/\/.*$/, "");
  return m[1] + (/^m(?!aj)/.test(rest) ? "m" : "");
}
function textToSections(text) {
  const sections = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const h = isHeader(raw);
    if (h) {
      sections.push((cur = { name: h, lines: [] }));
      continue;
    }
    if (!raw.trim() || isChordLine(raw)) continue; // linhas só de acordes não são cantadas
    const line = stripChordTokens(raw);
    if (!line) continue;
    if (!cur) sections.push((cur = { name: "Estrofe", lines: [] }));
    cur.lines.push(line);
  }
  return sections.filter((s) => s.lines.length || /intro|final|instrument/i.test(s.name));
}
function updateChordDetect() {
  const ch = extractChords($("#lyrics").value);
  $("#chord-detect").classList.toggle("hidden", !ch);
  if (ch) $("#chord-detect").innerHTML = `🎸 <b>Cifra detectada</b> · tom <b>${esc(ch.key)}</b> · ${esc(ch.progression)} — a música será criada nesse tom, seguindo essa progressão.`;
  return ch;
}

// Métrica aproximada (sílabas)
function syllables(line) {
  const w = line.toLowerCase().replace(/[^a-záéíóúâêôãõàüçy\s]/g, " ");
  const groups = w.match(/[aeiouáéíóúâêôãõàüy]+/g) || [];
  return groups.reduce((n, g) => n + (g.length >= 3 ? 2 : 1), 0);
}
function updateMeter() {
  const secs = textToSections($("#lyrics").value).filter((s) => s.lines.length);
  if (!secs.length) return ($("#meter").innerHTML = `<span>Métrica: escreva a letra para ver as sílabas por verso</span>`);
  $("#meter").innerHTML =
    `<span>Métrica ≈</span>` +
    secs
      .map((s) => {
        const c = s.lines.map(syllables);
        const ok = Math.max(...c) - Math.min(...c) <= 2;
        return `<span class="${ok ? "ok" : "warn"}" title="${ok ? "versos equilibrados" : "versos com tamanhos bem diferentes"}">${esc(s.name)}: ${c.join("·")}</span>`;
      })
      .join("");
}
$("#lyrics").addEventListener("input", () => (updateMeter(), updateChordDetect()));
$$("[data-sec]").forEach((b) =>
  b.addEventListener("click", () => {
    const ta = $("#lyrics");
    let name = b.dataset.sec;
    if (name === "Estrofe") name = `Estrofe ${(ta.value.match(/\[Estrofe/gi) || []).length + 1}`;
    const pos = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, pos).replace(/\n*$/, "");
    const ins = `${before ? "\n\n" : ""}[${name}]\n`;
    ta.value = before + ins + ta.value.slice(pos).replace(/^\n*/, "");
    ta.focus();
    ta.selectionStart = ta.selectionEnd = before.length + ins.length;
    updateMeter();
  }),
);

function showPlan(plan, { own = false } = {}) {
  state.plan = plan;
  $("#nb-empty").classList.add("hidden");
  $("#nb-body").classList.remove("hidden");
  $("#own-hint").classList.toggle("hidden", !own);
  $("#song-title").value = plan.title || "";
  $("#song-title").placeholder = "Título da música";
  $("#lyrics-cover").outerHTML = coverHtml(plan, "", 'id="lyrics-cover"');
  $("#styles").innerHTML = (plan.styles || []).map((s) => `<span>${esc(s)}</span>`).join("");
  const o = state.lastOptions || musicOptions();
  $("#nb-meta").textContent =
    o.mode === "catolica" ? `⛪ ${o.moment} · ${o.season}${plan.official ? " · texto oficial do Missal" : ""}` : `🎵 ${o.genre} · ${o.voice}`;
  const refs = [plan.notes, (plan.references || []).length ? `<b>Referências:</b> ${plan.references.map(esc).join(" · ")}` : ""].filter(Boolean);
  $("#refs").innerHTML = refs.map((r, i) => (i === 0 && plan.notes ? `🎤 ${esc(r)}` : r)).join("<br>");
  $("#refs").classList.toggle("hidden", !refs.length);
  $("#lyrics").value = planToText(plan);
  $("#refine-btns").parentElement.classList.toggle("hidden", !!plan.official);
  updateMeter();
  updateChordDetect();
  if (window.innerWidth < 1100) $("#notebook").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Pausa obrigatória entre pedidos do compositor gratuito
let cooldownTimer = null;
function startCooldown(sec) {
  const btns = [$("#btn-lyrics"), $("#btn-regen"), $("#btn-custom-refine"), ...$$("#refine-btns button")];
  btns.forEach((b) => (b.disabled = true));
  const label = $("#btn-lyrics span");
  const original = label.textContent;
  let left = sec;
  clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    left--;
    label.textContent = `Aguarde ${left}s…`;
    if (left <= 0) {
      clearInterval(cooldownTimer);
      btns.forEach((b) => (b.disabled = false));
      updateOfficial();
    }
  }, 1000);
  label.textContent = `Aguarde ${left}s…`;
  void original;
}
function handleLyricsError(e) {
  toast(e.message, true, 7000);
  if (e.retryAfter) startCooldown(e.retryAfter);
}

async function generateLyrics(btn) {
  warmStudio();
  const o = musicOptions();
  const idea = $("#idea").value.trim();
  if (!idea && o.mode === "livre") {
    $("#idea").focus();
    return toast("Conte a ideia da música 🙂");
  }
  if (!idea && o.mode === "catolica" && !o.reading && !OFFICIAL.has(o.moment)) {
    $("#idea").focus();
    return toast("Escreva o tema do canto ou cole a leitura do dia.");
  }
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = OFFICIAL.has(o.moment) && o.mode === "catolica" ? "Preparando…" : "✍️ Compondo a letra…";
  try {
    state.lastOptions = o;
    const plan = await api("/api/lyrics", {
      method: "POST",
      body: JSON.stringify({ idea, ...o, language: $("#language").value, duration: Number($("#duration").value) }),
    });
    plan.cover = Math.floor(Math.random() * 1e6);
    showPlan(plan);
  } catch (e) {
    handleLyricsError(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
    updateOfficial();
  }
}
$("#btn-lyrics").onclick = (e) => generateLyrics(e.currentTarget);
$("#btn-regen").onclick = (e) => generateLyrics(e.currentTarget);

// Minha própria letra
$("#btn-own").onclick = () => {
  state.lastOptions = musicOptions();
  showPlan(
    { title: "", styles: [], references: [], notes: "", own: true, cover: Math.floor(Math.random() * 1e6), sections: [] },
    { own: true },
  );
  $("#lyrics").value = "[Refrão]\n\n\n[Estrofe 1]\n\n";
  $("#lyrics").placeholder = "Cole ou escreva sua letra aqui…";
  updateMeter();
  $("#song-title").focus();
};

// Melhorar com IA
async function refine(action, custom) {
  const sections = textToSections($("#lyrics").value);
  if (!sections.length) return toast("Escreva ou gere uma letra primeiro.");
  const btns = [...$$("#refine-btns button"), $("#btn-custom-refine")];
  btns.forEach((b) => (b.disabled = true));
  toast("✨ Melhorando a letra…", false, 2500);
  try {
    const plan = { ...state.plan, title: $("#song-title").value.trim() || state.plan?.title || "Sem título", sections };
    const out = await api("/api/lyrics/refine", {
      method: "POST",
      body: JSON.stringify({ plan, action, custom, options: state.lastOptions || musicOptions(), language: $("#language").value }),
    });
    showPlan({ ...out, cover: state.plan?.cover, official: false }, { own: false });
    toast("Letra atualizada ✓", false, 2000);
  } catch (e) {
    handleLyricsError(e);
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}
$$("#refine-btns button").forEach((b) => b.addEventListener("click", () => refine(b.dataset.r)));
$("#btn-custom-refine").onclick = () => {
  const v = $("#custom-refine").value.trim();
  if (!v) return $("#custom-refine").focus();
  refine("", v);
};
$("#song-title").addEventListener("input", (e) => {
  const el = $("#lyrics-cover span");
  if (el) el.textContent = initials(e.target.value);
});

// =========================================================
// GRAVAÇÃO
// =========================================================
const PHASES = { waiting: 4, connecting: 8, queued: 12, generating: 18, saving: 94, done: 100 };
function sessionProgress(pct) {
  $$("#lanes .lane-track i").forEach((i, n) => (i.style.width = Math.max(0, Math.min(100, pct - n * 3)) + "%"));
  $("#playhead").style.left = `calc(106px + (100% - 116px) * ${Math.min(1, pct / 100)})`;
}
$("#btn-song").onclick = async () => {
  const sections = textToSections($("#lyrics").value);
  const instrumental = (state.lastOptions || musicOptions()).voice === "Instrumental";
  if (!sections.length && !instrumental) return toast("A letra está vazia.", true);
  const title = $("#song-title").value.trim() || state.plan?.title || "Minha música";
  const plan = { ...state.plan, title, sections: sections.length ? sections : [{ name: "Instrumental", lines: [] }] };
  // Se a pessoa mudou o console depois de compor, vale o console atual
  const options = { ...musicOptions(), ...(state.lastOptions ? { moment: state.lastOptions.moment, season: state.lastOptions.season } : {}) };
  // Cifra escrita na letra: define o tom (se o console estiver em "auto") e a progressão
  const chords = extractChords($("#lyrics").value);
  if (chords) {
    plan.chords = { key: chords.key, progression: chords.progression, sections: chords.sections };
    if (!state.keyNote) options.key = `${chords.key.replace(/m$/, "")} ${chords.key.endsWith("m") ? "minor" : "major"}`;
    options.chordProgression = chords.progression.replace(/ – /g, " ");
  }
  const duration = Number($("#duration").value);

  let minimized = false; // a pessoa fechou a janela: segue em segundo plano e só avisa no fim
  $("#session-hide").onclick = () => {
    minimized = true;
    $("#session").classList.add("hidden");
    toast("🎵 A música continua sendo criada. Acompanhe pela fila, no alto da tela.", false, 5000);
  };
  $("#session").classList.remove("hidden");
  $("#progress-title").textContent = title;
  sessionProgress(3);
  const t0 = Date.now();
  const eta = Math.round(30 + duration * (options.quality === "high" ? 2 : 1.2));
  const clock = setInterval(() => {
    const el = (Date.now() - t0) / 1000;
    $("#progress-clock").textContent = fmt(el).padStart(5, "0");
    $("#progress-time").textContent = el < eta ? `faltam cerca de ${fmt(eta - el)}` : "quase lá… o servidor gratuito pode estar com fila";
  }, 1000);
  try {
    const { jobId } = await api("/api/songs", {
      method: "POST",
      body: JSON.stringify({
        plan, duration, language: $("#language").value, options, meta: { cover: plan.cover }, reference: state.reference,
        idea: $("#idea").value.trim(),
        lyricsSource: state.plan?.own ? "propria" : state.plan?.official ? "missal" : "ia",
      }),
    });
    let pct = 3;
    for (;;) {
      await sleep(2000);
      let job = await api(`/api/jobs/${jobId}`);
      // erro de uma tentativa: a fila tenta de novo sozinha; só desiste se continuar em erro
      if (job.status === "error") {
        await sleep(4000);
        job = await api(`/api/jobs/${jobId}`);
      }
      if (job.status === "error" || job.status === "canceled") throw new Error(job.error || "Música cancelada.");
      $("#progress-text").textContent = job.message || "Trabalhando…";
      const target = PHASES[job.status] ?? pct;
      pct = job.status === "generating" ? Math.min(92, Math.max(target, 18 + ((Date.now() - t0) / 1000 / eta) * 74)) : Math.max(pct, target);
      sessionProgress(pct);
      if (job.status === "done") {
        state.songs.unshift(job.song);
        updateCount();
        if (minimized) {
          toast(`🎉 “${job.song.title}” está pronta! Veja na Biblioteca.`, false, 9000);
          if ($("#view-library").classList.contains("active")) renderLibrary();
        } else {
          toast("🎉 Sua música está pronta!");
          showView("library");
          play(job.song);
          openSong(job.song);
        }
        break;
      }
    }
  } catch (e) {
    toast(e.message, true, 9000);
  } finally {
    clearInterval(clock);
    $("#session").classList.add("hidden");
  }
};
// Esc também fecha a janela de gravação (a música continua em segundo plano)
document.addEventListener("keydown", (e) => e.key === "Escape" && !$("#session").classList.contains("hidden") && $("#session-hide").click());

// =========================================================
// NAVEGAÇÃO / BIBLIOTECA
// =========================================================
function showView(name) {
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  $$(".rail-nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (name === "library") (renderLibrary(), loadSongs().then(() => state.libMode === "songs" && $("#view-library").classList.contains("active") && renderLibrary())); // capas novas feitas em segundo plano
  if (name === "home") renderHome();
  if (name === "setlists") renderSetlists();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$("[data-view]").forEach((b) => b.addEventListener("click", (e) => (e.preventDefault(), showView(b.dataset.view))));

const updateCount = () => ($("#lib-count").textContent = state.songs.length || "");
async function loadSongs() {
  try {
    state.songs = await api("/api/songs");
  } catch {
    state.songs = [];
  }
  updateCount();
  loadAlbums();
}
function renderLibrary() {
  const lyr = state.libMode === "lyrics", alb = state.libMode === "albums";
  $("#lyrics-lib").classList.toggle("hidden", !lyr);
  $("#albums").classList.toggle("hidden", !alb);
  $("#library").classList.toggle("hidden", lyr || alb);
  $("#lib-tools").classList.toggle("hidden", lyr || alb);
  $("#lyr-tools").classList.toggle("hidden", !lyr);
  if (lyr) return renderLyricsLib();
  if (alb) return (renderAlbums(), loadAlbums().then(() => state.libMode === "albums" && renderAlbums()));
  const box = $("#library");
  const q = state.filter.toLowerCase();
  const sorters = {
    new: (a, b) => b.createdAt.localeCompare(a.createdAt),
    old: (a, b) => a.createdAt.localeCompare(b.createdAt),
    az: (a, b) => a.title.localeCompare(b.title, "pt-BR"),
    mass: (a, b) => massRank(a.options?.moment) - massRank(b.options?.moment) || b.createdAt.localeCompare(a.createdAt),
    long: (a, b) => (b.duration || 0) - (a.duration || 0),
  };
  const fm = $("#sf-moment").value, fs = $("#sf-season").value;
  const list = state.songs
    .filter((s) => state.libFilter !== "fav" || s.favorite)
    .filter((s) => state.libFilter !== "liturgia" || s.options?.mode === "catolica")
    .filter((s) => !fm || s.options?.moment === fm)
    .filter((s) => !fs || s.options?.season === fs)
    .filter((s) => !q || [s.title, s.genre, s.voice, s.options?.moment, s.options?.season].join(" ").toLowerCase().includes(q))
    .sort(sorters[state.sort]);
  if (!state.songs.length) {
    box.innerHTML = `<div class="empty"><h3>Nenhuma música ainda</h3><p>Vá ao estúdio e crie a primeira.</p><button class="btn primary" data-go>Abrir o estúdio</button></div>`;
    $("[data-go]", box).onclick = () => showView("create");
    return;
  }
  if (!list.length) return (box.innerHTML = `<div class="empty"><h3>Nada encontrado</h3><p>Tente outro filtro ou busca.</p></div>`);
  box.innerHTML = list.map(cardHtml).join("");
  bindCards(box);
}
function cardHtml(s) {
  const playingId = !audio.paused && state.current?.id;
  return `<article class="card${s.id === playingId ? " playing" : ""}" data-id="${s.id}">
        ${coverHtml(s, "")}
        <span class="badge">${fmt(s.duration || 0)}</span>
        ${s.options?.mode === "catolica" ? `<span class="liturgy-badge">${esc(s.options.moment)}</span>` : ""}
        <button class="heart${s.favorite ? " on" : ""}" data-fav aria-label="Favoritar">${s.favorite ? "♥" : "♡"}</button>
        <button class="fab" data-play aria-label="Tocar">${s.id === playingId ? PAUSE_SVG : PLAY_SVG}</button>
        <strong>${esc(s.title)}</strong>
        <small>${esc([s.genre, s.voice].filter(Boolean).join(" · "))}</small>
      </article>`;
}
function bindCards(box) {
  $$(".card", box).forEach((el) => {
    const song = state.songs.find((s) => s.id === el.dataset.id);
    el.onclick = (ev) => {
      if (ev.target.closest("[data-fav]")) toggleFav(song);
      else if (ev.target.closest("[data-play]")) state.current?.id === song.id ? togglePlay() : play(song);
      else openSong(song);
    };
  });
}

// ---------------- Minhas letras ----------------
state.lyricsLib = [];
state.libMode = "songs";
async function loadLyricsLib() {
  try {
    state.lyricsLib = await api("/api/lyrics-lib");
  } catch {
    state.lyricsLib = [];
  }
  $("#lyr-count").textContent = state.lyricsLib.length || "";
}
async function saveLyric(entry) {
  if (!entry.text.trim()) return toast("A letra está vazia.", true);
  try {
    const item = await api("/api/lyrics-lib", { method: "POST", body: JSON.stringify(entry) });
    state.lyricsLib.unshift(item);
    $("#lyr-count").textContent = state.lyricsLib.length;
    toast(`Letra “${item.title}” salva em Minhas letras ✓`, false, 3500);
  } catch (e) {
    toast(e.message, true);
  }
}
$("#btn-save-lyric").onclick = () => {
  const o = state.lastOptions || musicOptions();
  saveLyric({
    title: $("#song-title").value.trim() || state.plan?.title || "Sem título",
    text: $("#lyrics").value,
    mode: o.mode, moment: o.moment, season: o.season,
    references: state.plan?.references || [], notes: state.plan?.notes || "",
    source: state.plan?.own ? "propria" : state.plan?.official ? "missal" : "ia",
  });
};
$("#dlg-save-lyric").onclick = () => {
  const s = dlgSong;
  const o = s.options || {};
  // se a música tem cifra, a letra é salva com os acordes
  const text = s.chords?.sections?.length ? s.chords.sections.map((x) => `[${x.name}]\n${x.lines.join("\n")}`).join("\n\n") : planToText(s);
  saveLyric({ title: s.title, text, mode: o.mode, moment: o.moment, season: o.season, references: s.references, notes: s.notes, source: s.spec?.lyricsSource });
};
function renderLyricsLib() {
  const box = $("#lyrics-lib");
  const q = state.filter.toLowerCase();
  const fm = $("#ly-moment").value, fs = $("#ly-season").value, fo = $("#ly-source").value;
  $("#ly-clear").classList.toggle("hidden", !(fm || fs || fo));
  const sorters = {
    new: (a, b) => b.createdAt.localeCompare(a.createdAt),
    old: (a, b) => a.createdAt.localeCompare(b.createdAt),
    az: (a, b) => a.title.localeCompare(b.title, "pt-BR"),
    mass: (a, b) => massRank(a.moment) - massRank(b.moment) || b.createdAt.localeCompare(a.createdAt),
  };
  const list = state.lyricsLib
    .filter((l) => !q || [l.title, l.text, l.moment, l.season].join(" ").toLowerCase().includes(q))
    .filter((l) => !fm || l.moment === fm)
    .filter((l) => !fs || l.season === fs)
    .filter((l) => !fo || (l.source || "propria") === fo)
    .sort(sorters[$("#ly-sort").value] || sorters.new);
  if (!state.lyricsLib.length) {
    box.innerHTML = `<div class="empty"><h3>Nenhuma letra salva</h3><p>No caderno de letra ou na janela de uma música, toque em <b>Salvar letra</b>. Depois é só reutilizar a letra em outros arranjos.</p></div>`;
    return;
  }
  if (!list.length) return (box.innerHTML = `<div class="empty"><h3>Nada encontrado</h3></div>`);
  box.innerHTML = list
    .map((l) => {
      const preview = textToSections(l.text).flatMap((s) => s.lines).slice(0, 4).join("\n");
      const meta = [l.mode === "catolica" ? l.moment || "Litúrgica" : "Livre", l.mode === "catolica" ? l.season : "", LYRICS_SOURCE[l.source]].filter(Boolean);
      return `<article class="lyric-card" data-id="${l.id}">
        <h4>${esc(l.title)}</h4>
        <div class="lc-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}${extractChords(l.text) ? `<span class="chords">com cifra</span>` : ""}</div>
        <pre>${esc(preview)}</pre>
        <small>Salva em ${new Date(l.createdAt).toLocaleDateString("pt-BR")}</small>
        <div class="lc-actions">
          <button class="btn primary sm" data-act="open">Abrir</button>
          <button class="btn ghost sm" data-act="use">Criar música</button>
          <button class="btn ghost sm" data-act="copy">Copiar</button>
          <button class="btn ghost sm danger" data-act="del">Excluir</button>
        </div>
      </article>`;
    })
    .join("");
  $$(".lyric-card", box).forEach((el) => {
    const item = state.lyricsLib.find((l) => l.id === el.dataset.id);
    // clicar no cartão (fora dos botões) abre a letra
    el.addEventListener("click", (e) => !e.target.closest("button") && openLyric(item));
    $$("[data-act]", el).forEach((b) =>
      b.addEventListener("click", async () => {
        if (b.dataset.act === "open") openLyric(item);
        if (b.dataset.act === "use") useLyric(item);
        if (b.dataset.act === "copy") {
          await navigator.clipboard.writeText(`${item.title}\n\n${item.text}`);
          toast("Letra copiada ✓", false, 1800);
        }
        if (b.dataset.act === "del") {
          if (!confirm(`Excluir a letra “${item.title}”? As músicas já criadas não são afetadas.`)) return;
          await api(`/api/lyrics-lib/${item.id}`, { method: "DELETE" });
          state.lyricsLib = state.lyricsLib.filter((l) => l.id !== item.id);
          $("#lyr-count").textContent = state.lyricsLib.length || "";
          renderLyricsLib();
        }
      }),
    );
  });
}
// Abre a letra salva para ler e editar
let loItem = null;
function openLyric(item) {
  loItem = item;
  $("#lo-del").classList.toggle("hidden", !item.id);
  $("#lo-music").classList.toggle("hidden", !item.id);
  const meta = [item.mode === "catolica" ? item.moment || "Litúrgica" : "Livre", item.mode === "catolica" ? item.season : "", LYRICS_SOURCE[item.source]].filter(Boolean);
  $("#lo-meta").textContent = meta.join(" · ");
  $("#lo-title").value = item.title;
  $("#lo-text").value = item.text;
  $("#lyric-dialog").showModal();
  $("#lo-text").scrollTop = 0;
}
$("#ly-new").onclick = () => {
  openLyric({ title: "", text: "", mode: "livre", source: "propria" });
  $("#lo-meta").textContent = "Nova letra";
  $("#lo-title").placeholder = "Título da letra";
  $("#lo-text").placeholder = "[Estrofe 1]\nEscreva a letra aqui…\n\n[Refrão]\n…";
  $("#lo-title").focus();
};
$("#lo-del").onclick = async () => {
  if (!loItem?.id || !confirm(`Excluir a letra “${loItem.title}”? As músicas já criadas não são afetadas.`)) return;
  try {
    await api(`/api/lyrics-lib/${loItem.id}`, { method: "DELETE" });
    state.lyricsLib = state.lyricsLib.filter((l) => l.id !== loItem.id);
    $("#lyr-count").textContent = state.lyricsLib.length || "";
    $("#lyric-dialog").close();
    renderLyricsLib();
    toast("Letra excluída.", false, 1800);
  } catch (e) {
    toast(e.message, true);
  }
};
$("#lo-save").onclick = async () => {
  if (!loItem) return;
  if (!loItem.id) {
    // nova letra
    const text = $("#lo-text").value;
    if (!text.trim()) return toast("Escreva a letra antes de salvar.", true);
    try {
      const item = await api("/api/lyrics-lib", { method: "POST", body: JSON.stringify({ title: $("#lo-title").value.trim() || "Sem título", text, mode: "livre", source: "propria" }) });
      state.lyricsLib.unshift(item);
      $("#lyr-count").textContent = state.lyricsLib.length;
      loItem = item;
      $("#lo-del").classList.remove("hidden");
      $("#lo-music").classList.remove("hidden");
      renderLyricsLib();
      toast("Letra salva em Minhas letras ✓", false, 2000);
    } catch (e) {
      toast(e.message, true);
    }
    return;
  }
  try {
    const upd = await api(`/api/lyrics-lib/${loItem.id}`, { method: "PATCH", body: JSON.stringify({ title: $("#lo-title").value.trim() || loItem.title, text: $("#lo-text").value }) });
    const i = state.lyricsLib.findIndex((l) => l.id === upd.id);
    if (i >= 0) state.lyricsLib[i] = upd;
    loItem = upd;
    renderLyricsLib();
    toast("Letra salva ✓", false, 2000);
  } catch (e) {
    toast(e.message, true);
  }
};
$("#lo-copy").onclick = async () => {
  await navigator.clipboard.writeText(`${$("#lo-title").value}\n\n${$("#lo-text").value}`);
  toast("Letra copiada ✓", false, 1800);
};
$("#lo-music").onclick = () => {
  $("#lyric-dialog").close();
  useLyric({ ...loItem, title: $("#lo-title").value.trim() || loItem.title, text: $("#lo-text").value });
};

// Leva a letra salva para o estúdio: a pessoa só escolhe o novo arranjo e grava
function useLyric(item) {
  showView("create");
  $(`#mode-switch [data-mode="${item.mode === "livre" ? "livre" : "catolica"}"]`).click();
  if (item.mode === "catolica" && item.moment) {
    state.moment = item.moment;
    $$("#moment-groups .chip").forEach((c) => c.classList.toggle("on", c.textContent === item.moment));
    if (item.season) {
      $("#season").value = item.season;
      $("#season").dispatchEvent(new Event("change"));
      state.season = item.season;
    }
    updateOfficial();
  }
  state.lastOptions = null;
  showPlan(
    { title: item.title, styles: [], sections: [], references: item.references || [], notes: item.notes || "", own: true, cover: Math.floor(Math.random() * 1e6) },
    { own: true },
  );
  $("#lyrics").value = item.text;
  updateMeter();
  updateChordDetect();
  const steps = stepEls();
  goStep(Math.max(0, steps.findIndex((el) => el.dataset.step === "Estilo")));
  toast("Letra carregada. Escolha o novo arranjo (estilo, tempo, vozes…) e toque em Gravar música.", false, 6500);
}
$$("#lib-switch button").forEach((b) =>
  b.addEventListener("click", () => {
    state.libMode = b.dataset.l;
    $$("#lib-switch button").forEach((x) => x.classList.toggle("on", x === b));
    renderLibrary();
    if (state.libMode === "lyrics") loadLyricsLib().then(() => state.libMode === "lyrics" && renderLyricsLib());
  }),
);

// ---------------- Álbuns ----------------
state.albums = [];
state.albumOpen = null; // id do álbum aberto na biblioteca
const ALBUM_COLORS = ["#7c3aed", "#db2777", "#ea580c", "#0891b2", "#16a34a", "#ca8a04", "#4f46e5", "#be123c"];
async function loadAlbums() {
  try {
    state.albums = await api("/api/albums");
  } catch {
    state.albums = [];
  }
  $("#alb-count").textContent = state.albums.length || "";
}
const albumSongs = (a) => a.songIds.map((id) => state.songs.find((s) => s.id === id)).filter(Boolean);
const albumSecs = (a) => albumSongs(a).reduce((t, s) => t + (s.duration || 0), 0);
const fmtLong = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : `${Math.max(1, Math.round(sec / 60))} min`);
// capa: mosaico com as capas das 4 primeiras músicas (ou a cor do álbum)
function albumCover(a, size = "") {
  const ss = albumSongs(a).slice(0, 4);
  const inner = ss.length >= 4
    ? `<div class="alb-mosaic">${ss.map((s) => coverImg(s)).join("")}</div>`
    : ss.length ? coverImg(ss[0]) : "";
  return `<div class="alb-cover ${size}" style="--alb:${a.color || ALBUM_COLORS[0]}">${inner}<span class="alb-disc">${a.setlistId ? "⛪" : "📀"}</span></div>`;
}
function renderAlbums() {
  const box = $("#albums");
  const a = state.albumOpen && state.albums.find((x) => x.id === state.albumOpen);
  if (a) return renderAlbumDetail(box, a);
  state.albumOpen = null;
  const q = state.filter.toLowerCase();
  const list = state.albums.filter((x) => !q || [x.title, x.description].join(" ").toLowerCase().includes(q));
  box.innerHTML = `<div class="alb-grid">
      <button class="alb-card alb-new" data-new><span class="alb-cover"><b>＋</b></span><strong>Novo álbum</strong><small>Junte músicas numa coleção</small></button>
      ${list.map((x) => `<article class="alb-card" data-id="${x.id}">
        ${albumCover(x)}
        <button class="fab" data-play aria-label="Tocar o álbum">${PLAY_SVG}</button>
        <strong>${esc(x.title)}</strong>
        <small>${x.setlistId ? "Missa · " : ""}${albumSongs(x).length} música(s) · ${fmtLong(albumSecs(x))}</small>
      </article>`).join("")}
    </div>
    ${!state.albums.length ? `<p class="muted small alb-hint">As Missas prontas viram álbuns sozinhas assim que a primeira música delas fica pronta.</p>` : ""}`;
  $("[data-new]", box).onclick = () => editAlbum(null);
  $$(".alb-card[data-id]", box).forEach((el) => {
    const x = state.albums.find((y) => y.id === el.dataset.id);
    el.onclick = (ev) => {
      if (ev.target.closest("[data-play]")) return playAlbum(x);
      state.albumOpen = x.id;
      renderAlbums();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  });
}
function renderAlbumDetail(box, a) {
  const songs = albumSongs(a);
  box.innerHTML = `<button class="link sm alb-back" data-back>← Todos os álbuns</button>
    <header class="alb-head">
      ${albumCover(a, "lg")}
      <div>
        <span class="eyebrow">${a.setlistId ? "⛪ Álbum da Missa" : "📀 Álbum"}</span>
        <h2>${esc(a.title)}</h2>
        ${a.description ? `<p class="muted">${esc(a.description)}</p>` : ""}
        <p class="small muted">${songs.length} música(s) · ${fmtLong(albumSecs(a))} · atualizado em ${new Date(a.updatedAt || a.createdAt).toLocaleDateString("pt-BR")}</p>
        <div class="dlg-actions">
          <button class="btn primary" data-act="play">▶ Tocar</button>
          <button class="btn ghost" data-act="shuffle">🔀 Aleatório</button>
          <button class="btn ghost" data-act="add">＋ Músicas</button>
          <button class="btn ghost" data-act="edit">✎ Editar</button>
          <button class="btn ghost" data-act="share">🔗 Compartilhar</button>
          <button class="btn ghost danger" data-act="delete">Excluir</button>
        </div>
      </div>
    </header>
    ${songs.length ? `<ol class="alb-tracks">${songs.map((s, i) => `<li data-id="${s.id}" class="${state.current?.id === s.id ? "playing" : ""}">
        <span class="alb-n">${i + 1}</span>
        ${coverHtml(s, "sm")}
        <button class="alb-t" data-open><strong>${esc(s.title)}</strong><small>${esc([s.options?.mode === "catolica" && s.options.moment, s.genre].filter(Boolean).join(" · "))}</small></button>
        <span class="alb-d">${fmt(s.duration || 0)}</span>
        <span class="alb-ops">
          <button data-op="play" title="Tocar daqui">▶</button>
          <button data-op="up" title="Subir" ${i === 0 ? "disabled" : ""}>↑</button>
          <button data-op="down" title="Descer" ${i === songs.length - 1 ? "disabled" : ""}>↓</button>
          <button data-op="remove" title="Tirar do álbum">✕</button>
        </span>
      </li>`).join("")}</ol>`
    : `<div class="empty"><h3>Álbum vazio</h3><p>Toque em “＋ Músicas” para escolher as músicas da biblioteca.</p></div>`}`;
  $("[data-back]", box).onclick = () => ((state.albumOpen = null), renderAlbums());
  const acts = {
    play: () => playAlbum(a),
    shuffle: () => playAlbum(a, true),
    add: () => pickSongsFor(a),
    edit: () => editAlbum(a),
    share: () => shareAlbum(a),
    delete: () => deleteAlbum(a),
  };
  $$("[data-act]", box).forEach((b) => (b.onclick = () => acts[b.dataset.act]()));
  $$(".alb-tracks li", box).forEach((li) => {
    const id = li.dataset.id;
    const song = state.songs.find((s) => s.id === id);
    $("[data-open]", li).onclick = () => openSong(song);
    $$("[data-op]", li).forEach((b) => (b.onclick = () => {
      const ids = [...a.songIds];
      const k = ids.indexOf(id);
      if (b.dataset.op === "play") return playAlbum(a, false, albumSongs(a).findIndex((s) => s.id === id));
      if (b.dataset.op === "remove") ids.splice(k, 1);
      if (b.dataset.op === "up" && k > 0) [ids[k - 1], ids[k]] = [ids[k], ids[k - 1]];
      if (b.dataset.op === "down" && k < ids.length - 1) [ids[k + 1], ids[k]] = [ids[k], ids[k + 1]];
      saveAlbum(a, { songIds: ids });
    }));
  });
}
async function saveAlbum(a, patch) {
  try {
    const upd = await api(`/api/albums/${a.id}`, { method: "PUT", body: JSON.stringify({ ...a, ...patch }) });
    state.albums = state.albums.map((x) => (x.id === upd.id ? upd : x));
    if (state.libMode === "albums") renderAlbums();
    return upd;
  } catch (e) {
    toast(e.message, true);
  }
}
function playAlbum(a, shuffle = false, from = 0) {
  let songs = albumSongs(a).filter((s) => s.url);
  if (!songs.length) return toast("Este álbum ainda não tem músicas.");
  if (shuffle) songs = songs.map((s) => [Math.random(), s]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  else songs = songs.slice(Math.max(0, from));
  state.queue = songs.slice(1);
  play(songs[0]);
  toast(`▶ ${a.title}: ${songs.length} música(s)${shuffle ? " em ordem aleatória" : " em sequência"}`, false, 2500);
}
let adAlbum = null, adColor = ALBUM_COLORS[0];
function editAlbum(a, songIds = []) {
  adAlbum = a;
  adColor = a?.color || ALBUM_COLORS[Math.floor(Math.random() * ALBUM_COLORS.length)];
  $("#ad-eyebrow").textContent = a ? "Editar álbum" : "Novo álbum";
  $("#ad-title").value = a?.title || "";
  $("#ad-desc").value = a?.description || "";
  const paint = () => ($("#ad-colors").innerHTML = ALBUM_COLORS.map((c) => `<button type="button" class="${c === adColor ? "on" : ""}" style="--c:${c}" data-c="${c}" aria-label="Cor ${c}"></button>`).join(""));
  paint();
  $("#ad-colors").onclick = (e) => {
    const b = e.target.closest("[data-c]");
    if (b) (adColor = b.dataset.c), paint();
  };
  $("#ad-save").onclick = async () => {
    const title = $("#ad-title").value.trim();
    if (!title) return $("#ad-title").focus();
    const body = { title, description: $("#ad-desc").value.trim(), color: adColor };
    try {
      if (adAlbum) await saveAlbum(adAlbum, body);
      else {
        const created = await api("/api/albums", { method: "POST", body: JSON.stringify({ ...body, songIds }) });
        state.albums = [created, ...state.albums];
        $("#alb-count").textContent = state.albums.length;
        toast(`📀 Álbum “${created.title}” criado`);
        if (state.libMode === "albums") {
          state.albumOpen = created.id;
          renderAlbums();
          if (!songIds.length) setTimeout(() => pickSongsFor(created), 50);
        }
      }
      $("#album-dialog").close();
    } catch (e) {
      toast(e.message, true);
    }
  };
  $("#album-dialog").showModal();
  $("#ad-title").focus();
}
async function deleteAlbum(a) {
  if (!confirm(`Excluir o álbum “${a.title}”? As músicas continuam na biblioteca.`)) return;
  try {
    await api(`/api/albums/${a.id}`, { method: "DELETE" });
  } catch (e) {
    return toast(e.message, true);
  }
  state.albums = state.albums.filter((x) => x.id !== a.id);
  $("#alb-count").textContent = state.albums.length || "";
  state.albumOpen = null;
  renderAlbums();
  toast("Álbum excluído.");
}
async function shareAlbum(a) {
  const songs = albumSongs(a);
  const text = `📀 ${a.title}\n${a.description ? a.description + "\n" : ""}\n${songs.map((s, i) => `${i + 1}. ${s.title}${s.options?.moment ? ` (${s.options.moment})` : ""}`).join("\n")}\n\nFeito com ACAIAMUSIC`;
  try {
    if (navigator.share) await navigator.share({ title: a.title, text });
    else (await navigator.clipboard.writeText(text), toast("Lista do álbum copiada. Cole no WhatsApp."));
  } catch {}
}
// Diálogo de escolha com busca e caixinhas
function openPicker({ eyebrow, title, items, onSave, onNew }) {
  $("#pk-eyebrow").textContent = eyebrow;
  $("#pk-title").textContent = title;
  const checked = new Set(items.filter((i) => i.checked).map((i) => i.id));
  const draw = () => {
    const q = fold($("#pk-search").value);
    $("#pk-list").innerHTML = items.filter((i) => !q || fold(i.label + " " + (i.sub || "")).includes(q)).map((i) =>
      `<li><label><input type="checkbox" data-id="${i.id}" ${checked.has(i.id) ? "checked" : ""} /> <span><b>${esc(i.label)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span></label></li>`).join("")
      || `<li class="muted small">${items.length ? "Nada encontrado." : "Nenhum ainda."}</li>`;
  };
  $("#pk-search").value = "";
  $("#pk-search").oninput = draw;
  $("#pk-list").onchange = (e) => {
    const id = e.target.dataset.id;
    if (id) e.target.checked ? checked.add(id) : checked.delete(id);
  };
  draw();
  $("#pk-new").classList.toggle("hidden", !onNew);
  $("#pk-new").onclick = () => ($("#pick-dialog").close(), onNew());
  $("#pk-save").onclick = async () => {
    await onSave(checked);
    $("#pick-dialog").close();
  };
  $("#pick-dialog").showModal();
}
function pickSongsFor(a) {
  const songs = [...state.songs].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  openPicker({
    eyebrow: "📀 " + a.title,
    title: "Músicas do álbum",
    items: songs.map((s) => ({ id: s.id, label: s.title, sub: [s.options?.moment, s.genre, fmt(s.duration || 0)].filter(Boolean).join(" · "), checked: a.songIds.includes(s.id) })),
    onSave: (set) => saveAlbum(a, { songIds: [...a.songIds.filter((id) => set.has(id)), ...songs.map((s) => s.id).filter((id) => set.has(id) && !a.songIds.includes(id))] }),
  });
}
async function albumsForSong(song) {
  await loadAlbums();
  openPicker({
    eyebrow: "🎵 " + song.title,
    title: "Em quais álbuns?",
    items: state.albums.map((a) => ({ id: a.id, label: a.title, sub: `${a.songIds.length} música(s)`, checked: a.songIds.includes(song.id) })),
    onSave: async (set) => {
      for (const a of [...state.albums]) {
        const has = a.songIds.includes(song.id);
        if (set.has(a.id) && !has) await saveAlbum(a, { songIds: [...a.songIds, song.id] });
        if (!set.has(a.id) && has) await saveAlbum(a, { songIds: a.songIds.filter((x) => x !== song.id) });
      }
      toast("Álbuns atualizados.");
    },
    onNew: () => editAlbum(null, [song.id]),
  });
}

// ---------------- Registro de Criação (gratuito) ----------------
async function registroSong(song) {
  const last = song.registros?.at(-1);
  const name = prompt(
    `Registro de Criação de “${song.title}”\n\nGera um documento com a letra, a cifra, a impressão digital do áudio, a data, o seu nome e a declaração de uso de IA, com carimbo de tempo GRATUITO (OpenTimestamps). Só o código do documento é enviado; a letra e o seu nome não saem do app.\n\nSeu nome completo:`,
    last?.author || localStorage.getItem("acaia-autor") || "",
  );
  if (!name || !name.trim()) return;
  localStorage.setItem("acaia-autor", name.trim());
  const win = window.open("about:blank", "_blank"); // abre já: o navegador bloqueia janelas abertas depois de esperar
  toast("📜 Gerando o registro e o carimbo de tempo…", false, 4000);
  try {
    const reg = await api(`/api/songs/${song.id}/registro`, { method: "POST", body: JSON.stringify({ author: name.trim() }) });
    song.registros = [...(song.registros || []).filter((r) => r.file !== reg.file), reg];
    const url = `/api/songs/${song.id}/registro/${reg.file}/pagina`;
    if (win) win.location = url;
    else location.href = url;
  } catch (e) {
    win?.close();
    toast(e.message, true, 8000);
  }
}

// ---------------- Refazer com revisão de pronúncia ----------------
// Grava a música de novo do mesmo jeito; o Whisper ouve e, se a letra não estiver clara, o estúdio
// grava outra (até 3) e fica a melhor. A nova gravação substitui a antiga no mesmo lugar.
async function redoSong(song) {
  if (!confirm(`Refazer “${song.title}” do mesmo jeito (mesma letra, estilo e vozes)?\n\nO Whisper confere se dá para entender a letra; se não der, o estúdio grava de novo (até 3 vezes) e fica a gravação mais clara. A nova substitui a atual.`)) return;
  let r;
  try {
    r = await api(`/api/songs/${song.id}/redo`, { method: "POST", body: JSON.stringify({ check: true }) });
  } catch (e) {
    return toast(e.message, true);
  }
  toast(r.check ? "🎯 Refazendo com revisão de pronúncia. Acompanhe na fila de criação." : "Refazendo (a revisão de pronúncia precisa do estúdio no Modal).", false, 6000);
  const t0 = Date.now();
  while (Date.now() - t0 < 3 * 60 * 60 * 1000) {
    await sleep(5000);
    let j;
    try {
      j = await api(`/api/jobs/${r.jobId}`);
    } catch {
      continue;
    }
    if (j.status === "canceled") return;
    if (j.status !== "done" || !j.song) continue; // erros voltam para a fila e são tentados de novo
    const k = state.songs.findIndex((s) => s.id === j.song.id);
    if (k >= 0) state.songs[k] = j.song;
    else state.songs.unshift(j.song);
    updateCount();
    if ($("#view-library").classList.contains("active")) renderLibrary();
    if ($("#song-dialog").open && dlgSong?.id === j.song.id) openSong(j.song);
    toast(`🎯 “${j.song.title}” refeita. ${j.message.replace(/^Pronta! ?/, "")}`, false, 9000);
    return;
  }
}

// ---------------- Repertório da Missa ----------------
const MASS_ORDER = [
  "Entrada", "Ato Penitencial (Kyrie)", "Glória", "Salmo Responsorial", "Aclamação ao Evangelho",
  "Apresentação das Oferendas", "Santo", "Cordeiro de Deus", "Comunhão", "Ação de Graças (Pós-Comunhão)", "Final (Envio)",
];
state.setlists = [];
let slCur = null;
state.queue = [];
async function loadSetlists() {
  try {
    state.setlists = await api("/api/setlists");
  } catch {
    state.setlists = [];
  }
}
$("#sl-season").innerHTML = SEASONS.map(([s]) => `<option>${esc(s)}</option>`).join("");
$("#sl-add-moment").innerHTML = MOMENTS.flatMap(([, ms]) => ms).map((m) => `<option>${esc(m)}</option>`).join("");
const today = () => new Date().toISOString().slice(0, 10);
function slResolve(it) {
  if (it.kind === "song") {
    const s = state.songs.find((x) => x.id === it.ref);
    return s && { title: s.title, sections: s.sections || [], chordSecs: s.chords?.sections || null, song: s };
  }
  if (it.kind === "lyric") {
    const l = state.lyricsLib.find((x) => x.id === it.ref);
    return l && { title: l.title, sections: textToSections(l.text), chordSecs: extractChords(l.text)?.sections || null };
  }
  return null;
}
function slOptions(it) {
  const cur = it.kind && it.ref ? `${it.kind}:${it.ref}` : "";
  const songs = [...state.songs].sort((a, b) => (b.options?.moment === it.moment) - (a.options?.moment === it.moment));
  const lyrics = [...state.lyricsLib].sort((a, b) => (b.moment === it.moment) - (a.moment === it.moment));
  const opt = (v, label, match) => `<option value="${v}" ${v === cur ? "selected" : ""}>${match ? "★ " : ""}${esc(label)}</option>`;
  return (
    `<option value="">— escolher canto —</option>` +
    (songs.length ? `<optgroup label="Músicas">${songs.map((s) => opt(`song:${s.id}`, s.title, s.options?.moment === it.moment)).join("")}</optgroup>` : "") +
    (lyrics.length ? `<optgroup label="Minhas letras (só letra)">${lyrics.map((l) => opt(`lyric:${l.id}`, l.title, l.moment === it.moment)).join("")}</optgroup>` : "")
  );
}
function renderSetlists() {
  $("#sl-list").innerHTML = state.setlists.length
    ? state.setlists
        .map((s) => {
          const filled = s.items.filter((i) => i.ref).length;
          const date = s.date ? new Date(s.date + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "sem data";
          return `<button class="sl-card${slCur?.id === s.id ? " on" : ""}" data-id="${s.id}"><b>${esc(s.title)}</b><small>${esc(date)} · ${esc(s.season || "")} · ${filled}/${s.items.length} cantos</small></button>`;
        })
        .join("")
    : `<p class="muted small">Nenhum repertório ainda.</p>`;
  $$("#sl-list .sl-card").forEach((b) => (b.onclick = () => openSetlist(state.setlists.find((s) => s.id === b.dataset.id))));
  $("#sl-empty").classList.toggle("hidden", !!slCur);
  $("#sl-form").classList.toggle("hidden", !slCur);
}
function openSetlist(sl) {
  slCur = JSON.parse(JSON.stringify(sl));
  $("#sl-title").value = slCur.title || "";
  $("#sl-date").value = slCur.date || "";
  $("#sl-season").value = slCur.season || "Tempo Comum";
  $("#sl-notes").value = slCur.notes || "";
  renderSlItems();
  renderSetlists();
}
function renderSlItems() {
  updateRecordBtn();
  $("#sl-items").innerHTML = slCur.items
    .map(
      (it, i) => `<div class="sl-row" data-i="${i}">
        <span class="n">${i + 1}</span>
        <span class="m">${esc(it.moment)}</span>
        <select aria-label="Canto para ${esc(it.moment)}">${slOptions(it)}</select>
        <div class="acts">
          ${it.kind === "lyric" ? `<button data-a="rec" class="rec" title="Gravar a música desta letra">🎵</button>` : `<button data-a="play" title="Ouvir">▶</button>`}
          <button data-a="up" title="Subir">↑</button>
          <button data-a="down" title="Descer">↓</button>
          <button data-a="del" title="Remover">✕</button>
        </div>
      </div>`,
    )
    .join("");
  $$("#sl-items .sl-row").forEach((row) => {
    const i = Number(row.dataset.i);
    $("select", row).onchange = (e) => {
      const [kind, ref] = e.target.value.split(":");
      Object.assign(slCur.items[i], { kind: kind || "", ref: ref || "" });
      renderSlItems();
    };
    $$("[data-a]", row).forEach((b) =>
      b.addEventListener("click", () => {
        const a = b.dataset.a;
        if (a === "rec") return openRecord([i]);
        if (a === "play") {
          const r = slResolve(slCur.items[i]);
          return r?.song ? play(r.song) : toast("Escolha uma música (com áudio) para ouvir.");
        }
        if (a === "del") slCur.items.splice(i, 1);
        if (a === "up" && i > 0) [slCur.items[i - 1], slCur.items[i]] = [slCur.items[i], slCur.items[i - 1]];
        if (a === "down" && i < slCur.items.length - 1) [slCur.items[i + 1], slCur.items[i]] = [slCur.items[i], slCur.items[i + 1]];
        renderSlItems();
      }),
    );
  });
}
// ---- Gravar as músicas dos cantos que estão só com letra ----
const REC_VOICES = VOICE_TYPES.filter(([n]) => n !== "Instrumental");
$("#sl-rec-genre").innerHTML = GENRES["Católica"].map(([n], i) => `<option value="${i}">${esc(n)}</option>`).join("");
$("#sl-rec-voice").innerHTML = REC_VOICES.map(([n], i) => `<option value="${i}">${esc(n)}</option>`).join("");
let recIdx = null;
function updateRecordBtn() {
  const n = slCur ? slCur.items.filter((it) => it.kind === "lyric").length : 0;
  $("#sl-record").classList.toggle("hidden", !n);
  $("#sl-record").textContent = `🎵 Gravar as que faltam (${n})`;
}
function openRecord(indices) {
  recIdx = indices;
  const n = indices ? indices.length : slCur.items.filter((it) => it.kind === "lyric").length;
  $("#sl-rec-what").textContent = indices ? `Gravar a música de “${slCur.items[indices[0]].moment}”` : `Gravar ${n} música(s) que faltam`;
  $("#sl-rec").classList.remove("hidden");
  $("#sl-rec-setup").classList.remove("hidden");
  $("#sl-rec-run").classList.add("hidden");
  $("#sl-rec").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
$("#sl-record").onclick = () => openRecord(null);
$("#sl-rec-cancel").onclick = () => $("#sl-rec").classList.add("hidden");
$("#sl-rec-go").onclick = async () => {
  const [genre, genreTags] = GENRES["Católica"][$("#sl-rec-genre").value];
  const [voice, voiceTags] = REC_VOICES[$("#sl-rec-voice").value];
  $("#sl-rec-setup").classList.add("hidden");
  $("#sl-rec-run").classList.remove("hidden");
  $("#sl-rec-bar").style.width = "4%";
  try {
    const saved = await saveSetlist(true); // grava as mudanças antes, para o servidor ver a lista atual
    const { jobId, count } = await api(`/api/setlists/${saved.id}/record`, {
      method: "POST",
      body: JSON.stringify({ indices: recIdx, genre, genreTags, voice, voiceTags, duration: 120 }),
    });
    toast(`🎵 Gravando ${count} música(s). Pode continuar usando o app.`, false, 4000);
    for (;;) {
      await sleep(3000);
      const j = await api(`/api/jobs/${jobId}`);
      $("#sl-rec-msg").textContent = j.status === "error" ? `⚠️ ${j.error}` : j.message;
      const done = (j.items || []).filter((x) => x.kind === "song" || x.error).length;
      $("#sl-rec-bar").style.width = Math.max(4, Math.round((done / (j.total || 1)) * 100)) + "%";
      if (j.status === "error" || j.status === "canceled") throw new Error(j.error || "Música cancelada.");
      if (j.status === "done") {
        await Promise.all([loadSongs(), loadSetlists()]);
        const sl = state.setlists.find((s) => s.id === saved.id);
        if (sl && slCur?.id === sl.id) openSetlist(sl);
        const fails = (j.items || []).filter((x) => x.error);
        toast(fails.length ? `${j.message} Falhou: ${fails.map((f) => f.moment).join(", ")} — ${fails[0].error}` : "🎉 Músicas gravadas e colocadas no repertório!", !!fails.length, 9000);
        $("#sl-rec").classList.add("hidden");
        break;
      }
    }
  } catch (err) {
    toast(err.message, true, 8000);
    $("#sl-rec-setup").classList.remove("hidden");
    $("#sl-rec-run").classList.add("hidden");
  }
};

function newSetlist() {
  slCur = { id: null, title: "", date: today(), season: state.season || "Tempo Comum", notes: "", items: MASS_ORDER.map((m) => ({ moment: m, kind: "", ref: "" })) };
  openSetlist(slCur);
  $("#sl-title").focus();
}
$("#sl-new").onclick = newSetlist;
$$("[data-sl-new]").forEach((b) => (b.onclick = newSetlist));
$("#sl-add").onclick = () => {
  slCur.items.push({ moment: $("#sl-add-moment").value, kind: "", ref: "" });
  renderSlItems();
};
$("#sl-suggest").onclick = () => {
  const season = $("#sl-season").value;
  let n = 0;
  for (const it of slCur.items) {
    if (it.ref) continue;
    const songs = state.songs.filter((s) => s.options?.moment === it.moment);
    const s = songs.find((x) => x.options?.season === season) || songs[0];
    if (s) {
      Object.assign(it, { kind: "song", ref: s.id });
      n++;
      continue;
    }
    const l = state.lyricsLib.find((x) => x.moment === it.moment);
    if (l) {
      Object.assign(it, { kind: "lyric", ref: l.id });
      n++;
    }
  }
  renderSlItems();
  toast(n ? `✨ ${n} momento(s) preenchido(s) com cantos da biblioteca.` : "Não encontrei cantos na biblioteca para os momentos vazios.", false, 4000);
};
function slCollect() {
  return { ...slCur, title: $("#sl-title").value.trim() || "Missa", date: $("#sl-date").value, season: $("#sl-season").value, notes: $("#sl-notes").value.trim() };
}
async function saveSetlist(silent = false) {
  const data = slCollect();
  const saved = data.id
    ? await api(`/api/setlists/${data.id}`, { method: "PUT", body: JSON.stringify(data) })
    : await api("/api/setlists", { method: "POST", body: JSON.stringify(data) });
  const i = state.setlists.findIndex((s) => s.id === saved.id);
  if (i >= 0) state.setlists[i] = saved;
  else state.setlists.unshift(saved);
  slCur = JSON.parse(JSON.stringify(saved));
  renderSetlists();
  if (!silent) toast("Repertório salvo ✓", false, 2000);
  return saved;
}
$("#sl-save").onclick = () => saveSetlist().catch((e) => toast(e.message, true));
$("#sl-del").onclick = async () => {
  if (!slCur) return;
  if (!confirm("Excluir este repertório? Os cantos continuam na biblioteca.")) return;
  if (slCur.id) await api(`/api/setlists/${slCur.id}`, { method: "DELETE" });
  state.setlists = state.setlists.filter((s) => s.id !== slCur.id);
  slCur = null;
  renderSetlists();
};
$("#sl-play").onclick = () => {
  const songs = slCur.items.map(slResolve).filter((r) => r?.song).map((r) => r.song);
  if (!songs.length) return toast("Nenhuma música com áudio neste repertório.");
  state.queue = songs.slice(1);
  play(songs[0]);
  toast(`▶ Tocando ${songs.length} canto(s) em sequência`, false, 2500);
};
const slDate = (d) => (d ? new Date(d + "T12:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) : "");
$("#sl-print").onclick = () => {
  const data = slCollect();
  const withChords = $("#sl-chords").checked;
  const body = data.items
    .map((it) => {
      const r = slResolve(it);
      if (!r) return "";
      const content =
        withChords && r.chordSecs
          ? r.chordSecs.map((s) => `<p class="mom">${esc(s.name)}</p><pre>${s.lines.map((l) => { const c = chordLine(l, 0); return (c.top ? c.html + "\n" : "") + esc(c.lyric); }).join("\n")}</pre>`).join("")
          : r.sections.map((s) => `<p class="mom">${esc(s.name)}</p><pre>${esc(s.lines.join("\n"))}</pre>`).join("");
      return `<div class="sl-print-item"><p class="mom">${esc(it.moment)}</p><h3>${esc(r.title)}</h3>${content}</div>`;
    })
    .join("");
  const div = document.createElement("div");
  div.id = "print-area";
  div.innerHTML = `<h1>${esc(data.title)}</h1><p>${esc(slDate(data.date))}${data.season ? " · " + esc(data.season) : ""}</p>${data.notes ? `<p><i>${esc(data.notes)}</i></p>` : ""}<hr>${body}<p style="margin-top:30px;font-size:11px">Repertório organizado no ACAIAMUSIC · sua fé em forma de canção</p>`;
  document.body.appendChild(div);
  window.print();
  div.remove();
};
$("#sl-wa").onclick = () => {
  const data = slCollect();
  const list = data.items.map((it, i) => `${i + 1}. _${it.moment}_ — ${slResolve(it)?.title || "(a definir)"}`).join("\n");
  const lyrics = data.items
    .map((it) => {
      const r = slResolve(it);
      return r ? `*${it.moment.toUpperCase()} · ${r.title}*\n${r.sections.filter((s) => s.lines.length).map((s) => s.lines.join("\n")).join("\n\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  shareText(`*${data.title}*\n${slDate(data.date)}${data.season ? " · " + data.season : ""}\n\n${list}\n\n${lyrics}\n\n🎵 Repertório no ACAIAMUSIC`);
};

// ---------------- Modo projeção (letra em tela cheia) ----------------
const pj = { slides: [], i: 0, size: Number(localStorage.getItem("pjSize")) || 1 };
const isChorusName = (n) => /refr|resposta|ant[ií]fona|aleluia|hosana/i.test(n);
function slidesFor(title, sections, header = "") {
  const out = [{ kind: "title", title, header }];
  for (const s of sections) {
    if (!s.lines.length) continue;
    for (let i = 0; i < s.lines.length; i += 4) out.push({ kind: "text", sec: s.name, lines: s.lines.slice(i, i + 4), chorus: isChorusName(s.name), title });
  }
  return out;
}
function pjRender() {
  const s = pj.slides[pj.i];
  const el = $("#pj-slide");
  el.className = "pj-slide anim" + (s.chorus ? " chorus" : "");
  el.innerHTML =
    s.kind === "title"
      ? `${s.header ? `<p class="moment">${esc(s.header)}</p>` : ""}<p class="title-slide">${esc(s.title)}</p>`
      : `<p class="sec">${esc(s.sec)}</p>${s.lines.map((l) => `<p>${esc(l)}</p>`).join("")}`;
  $("#pj-count").textContent = `${pj.i + 1} / ${pj.slides.length}`;
  $("#pj-info").textContent = s.kind === "title" ? "" : s.title;
  document.documentElement.style.setProperty("--pj-size", pj.size);
}
function openProjector(slides, cover) {
  if (!slides.length) return toast("Não há letra para projetar.");
  pj.slides = slides;
  pj.i = 0;
  $("#pj-bg").innerHTML = cover && typeof cover === "object" ? coverImg(cover) : coverArt(cover ?? 7); // a música inteira: usa a capa ilustrada
  $("#projector").classList.remove("hidden");
  $("#projector").focus();
  pjRender();
}
const pjGo = (d) => {
  pj.i = Math.max(0, Math.min(pj.slides.length - 1, pj.i + d));
  pjRender();
};
function closeProjector() {
  $("#projector").classList.add("hidden");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
$("#pj-next").onclick = () => pjGo(1);
$("#pj-prev").onclick = () => pjGo(-1);
$("#pj-close").onclick = closeProjector;
$("#pj-full").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : $("#projector").requestFullscreen?.()).catch?.(() => {});
$("#pj-font-plus").onclick = () => (pj.size = Math.min(1.6, pj.size + 0.1), localStorage.setItem("pjSize", pj.size), pjRender());
$("#pj-font-minus").onclick = () => (pj.size = Math.max(0.6, pj.size - 0.1), localStorage.setItem("pjSize", pj.size), pjRender());
$("#pj-slide").onclick = (e) => pjGo(e.clientX > window.innerWidth / 2 ? 1 : -1);
$("#projector").addEventListener("keydown", (e) => {
  if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) (e.preventDefault(), pjGo(1));
  if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) (e.preventDefault(), pjGo(-1));
  if (e.key === "Escape" && !document.fullscreenElement) closeProjector();
  if (e.key.toLowerCase() === "f") $("#pj-full").click();
});
$("#proj-song").onclick = () => {
  const s = dlgSong;
  const o = s.options || {};
  $("#song-dialog").close();
  openProjector(slidesFor(s.title, s.sections || [], o.mode === "catolica" ? o.moment : ""), s);
};
$("#sl-proj").onclick = () => {
  const data = slCollect();
  const slides = [{ kind: "title", title: data.title, header: slDate(data.date) }];
  for (const it of data.items) {
    const r = slResolve(it);
    if (r) slides.push(...slidesFor(r.title, r.sections, it.moment));
  }
  openProjector(slides.length > 1 ? slides : [], 11);
};

// Atalhos de instrumentos (ex.: violão + teclado)
$$("#inst-presets [data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    const names = b.dataset.preset.split(",");
    state.instruments = INSTRUMENTS.filter((i) => names.includes(i[0]));
    multiChips($("#inst-chips"), INSTRUMENTS, "instruments", 5, () => sumList("#sum-inst", state.instruments, "automático"));
    toast(`Instrumentos: ${names.join(" + ")}`, false, 1800);
  }),
);

// ---------------- Início ----------------
function renderHome() {
  const box = $("#home-recent");
  const recent = [...state.songs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  if (!recent.length) {
    box.innerHTML = `<div class="empty"><h3>Nenhuma música ainda</h3><p>Escolha uma das opções acima para criar a primeira.</p></div>`;
    return;
  }
  box.innerHTML = recent.map(cardHtml).join("");
  bindCards(box);
}
$$("[data-start]").forEach((b) =>
  b.addEventListener("click", () => {
    const kind = b.dataset.start;
    showView("create");
    if (kind === "own") {
      wzIndex = 0;
      renderWizard();
      $("#btn-own").click();
      return;
    }
    $(`#mode-switch [data-mode="${kind}"]`).click();
    goStep(1); // pula a escolha do modo: já foi feita aqui
  }),
);
$$("[data-open-settings]").forEach((b) => b.addEventListener("click", () => $("#btn-settings").click()));
$("#search").addEventListener("input", (e) => ((state.filter = e.target.value), renderLibrary()));
$$("#filter-tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    state.libFilter = b.dataset.f;
    $$("#filter-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    renderLibrary();
  }),
);
$("#sort").addEventListener("change", (e) => ((state.sort = e.target.value), renderLibrary()));

// Filtros por momento / tempo / origem e ordem da Missa (músicas e letras)
const ALL_MOMENTS = MOMENTS.flatMap(([, ms]) => ms);
function massRank(m) {
  const i = ALL_MOMENTS.indexOf(m);
  return i < 0 ? 999 : i;
}
for (const id of ["#ly-moment", "#sf-moment"])
  $(id).innerHTML = `<option value="">Todo momento</option>` + MOMENTS.map(([g, ms]) => `<optgroup label="${esc(g)}">${ms.map((m) => `<option>${esc(m)}</option>`).join("")}</optgroup>`).join("");
for (const id of ["#ly-season", "#sf-season"]) $(id).innerHTML = `<option value="">Todo tempo litúrgico</option>` + SEASONS.map(([s]) => `<option>${esc(s)}</option>`).join("");
$$("[data-filter], #ly-sort").forEach((el) => el.addEventListener("change", renderLibrary));
$("#ly-clear").onclick = () => {
  ["#ly-moment", "#ly-season", "#ly-source"].forEach((id) => ($(id).value = ""));
  renderLibrary();
};

async function patchSong(song, patch) {
  const updated = await api(`/api/songs/${song.id}`, { method: "PATCH", body: JSON.stringify(patch) });
  Object.assign(song, updated);
  if (state.current?.id === song.id) Object.assign(state.current, updated);
}
async function toggleFav(song) {
  try {
    await patchSong(song, { favorite: !song.favorite });
  } catch (e) {
    return toast(e.message, true);
  }
  syncFavUI(song);
  if ($("#view-library").classList.contains("active")) renderLibrary();
  toast(song.favorite ? "♥ Adicionada às favoritas" : "Removida das favoritas", false, 1800);
}
function syncFavUI(song) {
  if (state.current?.id === song.id) {
    $("#p-fav").textContent = song.favorite ? "♥" : "♡";
    $("#p-fav").classList.toggle("on", !!song.favorite);
  }
  if ($("#song-dialog").open && $("#song-dialog").dataset.id === song.id) {
    $("#dlg-fav").textContent = song.favorite ? "♥ Favorita" : "♡ Favoritar";
    $("#dlg-fav").classList.toggle("on", !!song.favorite);
  }
}

// =========================================================
// COMPARTILHAR (WhatsApp)
// =========================================================
function lyricsText(song, { withTitle = true } = {}) {
  const o = song.options || {};
  const head = withTitle ? `*${song.title}*\n${o.mode === "catolica" ? `_${o.moment} · ${o.season}_\n` : ""}\n` : "";
  const body = (song.sections || []).filter((s) => s.lines.length).map((s) => `_${s.name}_\n${s.lines.join("\n")}`).join("\n\n");
  const refs = song.references?.length ? `\n\n📖 ${song.references.join(" · ")}` : "";
  return `${head}${body}${refs}\n\n🎵 Criado no ACAIAMUSIC`;
}
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
async function shareFile(url, filename, mime, text) {
  try {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text, title: filename });
      return;
    }
  } catch (e) {
    if (e.name === "AbortError") return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.open(`https://wa.me/?text=${encodeURIComponent(text || "")}`, "_blank");
  toast("📥 Arquivo baixado. Anexe no WhatsApp que acabou de abrir.", false, 7000);
}
async function shareText(text) {
  if (isMobile() && navigator.share) {
    try {
      return await navigator.share({ text });
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}
const safeName = (s) => (s || "musica").replace(/[\\/:*?"<>|]+/g, "").trim() || "musica";

// =========================================================
// MÚSICA (diálogo com abas)
// =========================================================
let dlgSong = null;
// Duas versões gravadas juntas (estúdio com GPU): ouvir as duas e escolher a principal
function renderVersions(song) {
  const box = $("#dlg-versions");
  box.classList.toggle("hidden", !song.alt);
  if (!song.alt) return (box.innerHTML = "");
  const cur = song.take || "A", other = cur === "A" ? "B" : "A";
  box.innerHTML = `<span class="v-label">🎚️ Gravamos 2 versões. Ouça e fique com a melhor:</span>
    <div class="v-row">
      <button class="btn ghost sm v-on" data-v="main">▶ Versão ${cur} <small>principal</small></button>
      <button class="btn ghost sm" data-v="alt">▶ Versão ${other}</button>
      <button class="btn primary sm" data-v="swap">Usar a versão ${other}</button>
    </div>`;
  box.querySelector('[data-v="main"]').onclick = () => play(song);
  box.querySelector('[data-v="alt"]').onclick = () => play({ ...song, url: song.alt.url, title: `${song.title} · versão ${other}` });
  box.querySelector('[data-v="swap"]').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const j = await api(`/api/songs/${song.id}/swap-version`, { method: "POST" });
      for (const k of ["stems", "timing"]) delete song[k];
      Object.assign(song, j.song);
      const i = state.songs.findIndex((s) => s.id === song.id);
      if (i >= 0) state.songs[i] = song;
      toast(`Agora a versão ${song.take} é a principal`, false, 2200);
      openSong(song);
      play(song);
    } catch (err) {
      toast(err.message, true);
      e.target.disabled = false;
    }
  };
}
function openSong(song) {
  dlgSong = song;
  const dlg = $("#song-dialog");
  dlg.dataset.id = song.id;
  $("#dlg-cover").outerHTML = coverHtml(song, "lg", 'id="dlg-cover"');
  $("#dlg-title").textContent = song.title;
  $("#dlg-date").textContent = new Date(song.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const o = song.options || {};
  $("#dlg-tags").innerHTML = [
    o.mode === "catolica" && `⛪ ${o.moment}`, o.mode === "catolica" && o.season, song.genre, o.bpm && `${o.bpm} BPM`,
    o.key && `Tom ${o.key.replace(" major", "").replace(" minor", "m")}`, song.voice, ...(o.instruments || []),
  ].filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join("");
  $("#dlg-download").href = song.url;
  $("#dlg-download").download = `${safeName(song.title)}.mp3`;
  $("#dlg-play").onclick = () => play(song);
  renderVersions(song);
  $("#dlg-fav").onclick = () => toggleFav(song);
  $("#dlg-album").onclick = () => albumsForSong(song);
  $("#dlg-redo").onclick = () => redoSong(song);
  $("#dlg-registro").onclick = () => registroSong(song);
  $("#dlg-reuse").onclick = () => {
    if (song.options) applySpec(song);
    state.lastOptions = song.options || null;
    showPlan({ title: song.title, styles: song.styles || [], sections: song.sections, references: song.references || [], notes: song.notes, cover: song.cover });
    dlg.close();
    showView("create");
  };
  $("#dlg-delete").onclick = async () => {
    if (!confirm(`Excluir “${song.title}” e todos os arquivos (faixas, vídeos)?`)) return;
    try {
      await api(`/api/songs/${song.id}`, { method: "DELETE" });
    } catch (e) {
      return toast(e.message, true);
    }
    state.songs = state.songs.filter((s) => s.id !== song.id);
    updateCount();
    if (state.current?.id === song.id) closePlayer();
    dlg.close();
    renderLibrary();
  };
  const title = $("#dlg-title");
  title.onkeydown = (e) => e.key === "Enter" && (e.preventDefault(), title.blur());
  title.onblur = async () => {
    const t = title.textContent.trim();
    if (!t || t === song.title) return (title.textContent = song.title);
    try {
      await patchSong(song, { title: t });
      if (state.current?.id === song.id) $("#player-title").textContent = song.title;
      renderLibrary();
      toast("Título atualizado", false, 1800);
    } catch (e) {
      toast(e.message, true);
    }
  };

  // Letra
  $("#dlg-lyrics").textContent = planToText(song).trim() || "(instrumental)";
  const refs = [song.notes && `🎤 ${esc(song.notes)}`, song.references?.length && `<b>Referências:</b> ${song.references.map(esc).join(" · ")}`].filter(Boolean);
  $("#dlg-refs").innerHTML = refs.join("<br>");
  $("#dlg-refs").classList.toggle("hidden", !refs.length);

  renderSpec(song);
  initEditor(song);

  // Cifra
  const defKey = song.chords?.key || (o.key ? o.key.split(" ")[0] + (o.key.includes("minor") ? "m" : "") : "G");
  $("#chord-key").innerHTML = KEYS.flatMap((k) => [k, k + "m"]).map((k) => `<option ${k === defKey ? "selected" : ""}>${k}</option>`).join("");
  transposeBy = 0;
  $("#capo").value = "0";
  stopMetro();
  renderChords();

  // Faixas
  stopMixer();
  renderStems();

  // Vídeo
  const maxStart = Math.max(0, Math.floor((song.duration || 60) - 60));
  $("#video-start").max = maxStart;
  $("#video-start").value = Math.min(maxStart, findChorusStart(song));
  $("#video-start").disabled = maxStart === 0;
  updateVideoRange();
  $("#video-out").classList.add("hidden");
  $("#video-canvas").classList.remove("hidden");
  $("#video-actions").classList.add("hidden");
  $("#video-progress").classList.add("hidden");
  drawVideoPreview();

  selectTab("letra");
  if (!dlg.open) dlg.showModal();
  syncFavUI(song);
}
function selectTab(t) {
  $$("#dlg-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  $$(".tab-pane").forEach((p) => p.classList.toggle("on", p.dataset.p === t));
  if (t === "video") (drawVideoPreview(), dlgSong && !dlgSong.illustration && makeIllustration(dlgSong));
  if (t === "editar" && dlgSong) drawWave(dlgSong);
}
$$("#dlg-tabs button").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.t)));
$("#song-dialog").addEventListener("close", stopMixer);

// ---------------- Editor de áudio ----------------
const waveCache = {};
function initEditor(song) {
  const d = Math.floor(song.duration || 60);
  for (const id of ["#ed-start", "#ed-end"]) $(id).max = d;
  $("#ed-start").value = 0;
  $("#ed-end").value = d;
  $("#ed-fi").value = 0;
  $("#ed-fo").value = 3;
  $("#ed-st").value = 0;
  $("#ed-tp").value = 100;
  $("#ed-master").checked = true;
  $("#ed-wav").href = `/api/songs/${song.id}/wav`;
  $("#ed-wav").download = `${safeName(song.title)}.wav`;
  $("#ed-progress").classList.add("hidden");
  updateEditor();
  const c = $("#wave");
  c.getContext("2d").clearRect(0, 0, c.width, c.height);
}
function updateEditor() {
  const d = Number($("#ed-start").max) || 60;
  let s = Number($("#ed-start").value), e = Number($("#ed-end").value);
  if (e - s < 3) {
    if (document.activeElement === $("#ed-start")) s = Math.max(0, e - 3);
    else e = Math.min(d, s + 3);
    $("#ed-start").value = s;
    $("#ed-end").value = e;
  }
  $("#ed-start-out").textContent = fmt(s);
  $("#ed-end-out").textContent = fmt(e);
  $("#ed-fi-out").textContent = `${$("#ed-fi").value} s`;
  $("#ed-fo-out").textContent = `${$("#ed-fo").value} s`;
  const st = Number($("#ed-st").value);
  $("#ed-st-out").textContent = st ? `${st > 0 ? "+" : ""}${st} semitom${Math.abs(st) > 1 ? "s" : ""}` : "original";
  $("#ed-tp-out").textContent = `${$("#ed-tp").value}%`;
  $("#wave-sel").style.left = `${(s / d) * 100}%`;
  $("#wave-sel").style.width = `${((e - s) / d) * 100}%`;
}
["#ed-start", "#ed-end", "#ed-fi", "#ed-fo", "#ed-st", "#ed-tp"].forEach((id) => $(id).addEventListener("input", updateEditor));
async function drawWave(song) {
  const c = $("#wave");
  const g = c.getContext("2d");
  try {
    let peaks = waveCache[song.id];
    if (!peaks) {
      const buf = await (await fetch(song.url)).arrayBuffer();
      const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 2, 44100);
      const audioBuf = await ac.decodeAudioData(buf);
      const data = audioBuf.getChannelData(0);
      const n = 300, step = Math.floor(data.length / n);
      peaks = [];
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (let j = i * step; j < (i + 1) * step; j += 16) m = Math.max(m, Math.abs(data[j] || 0));
        peaks.push(m);
      }
      waveCache[song.id] = peaks;
    }
    if (dlgSong?.id !== song.id) return;
    g.clearRect(0, 0, c.width, c.height);
    const w = c.width / peaks.length, mid = c.height / 2;
    const grad = g.createLinearGradient(0, 0, c.width, 0);
    grad.addColorStop(0, "#a855f7");
    grad.addColorStop(1, "#ec4899");
    g.fillStyle = grad;
    peaks.forEach((p, i) => {
      const h = Math.max(1.5, p * mid * 0.95);
      g.fillRect(i * w + 0.5, mid - h, Math.max(1, w - 1.5), h * 2);
    });
  } catch {
    g.fillStyle = "#6d697a";
    g.font = "16px sans-serif";
    g.fillText("Não foi possível desenhar a forma de onda.", 20, 80);
  }
}
let previewStop = null;
$("#ed-preview").onclick = () => {
  const s = Number($("#ed-start").value), e = Number($("#ed-end").value);
  if (state.current?.id !== dlgSong.id) play(dlgSong);
  const go = () => {
    audio.currentTime = s;
    audio.play();
  };
  audio.readyState >= 1 ? go() : audio.addEventListener("loadedmetadata", go, { once: true });
  if (previewStop) audio.removeEventListener("timeupdate", previewStop);
  previewStop = () => {
    const d = Number($("#ed-start").max) || 60;
    $("#wave-head").style.display = "block";
    $("#wave-head").style.left = `${(audio.currentTime / d) * 100}%`;
    if (audio.currentTime >= e) {
      audio.pause();
      $("#wave-head").style.display = "none";
      audio.removeEventListener("timeupdate", previewStop);
    }
  };
  audio.addEventListener("timeupdate", previewStop);
};
$("#ed-apply").onclick = async (ev) => {
  const song = dlgSong;
  const btn = ev.currentTarget;
  btn.disabled = true;
  $("#ed-progress").classList.remove("hidden");
  $("#ed-bar").style.width = "10%";
  $("#ed-msg").textContent = "Enviando…";
  try {
    const { jobId } = await api(`/api/songs/${song.id}/edit`, {
      method: "POST",
      body: JSON.stringify({
        trimStart: Number($("#ed-start").value), trimEnd: Number($("#ed-end").value),
        fadeIn: Number($("#ed-fi").value), fadeOut: Number($("#ed-fo").value),
        semitones: Number($("#ed-st").value), tempo: Number($("#ed-tp").value) / 100, master: $("#ed-master").checked,
      }),
    });
    const t0 = Date.now();
    for (;;) {
      await sleep(1200);
      const job = await api(`/api/jobs/${jobId}`);
      if (job.status === "error" || job.status === "canceled") throw new Error(job.error || "Música cancelada.");
      $("#ed-msg").textContent = job.message;
      $("#ed-bar").style.width = (job.status === "done" ? 100 : Math.min(90, 15 + ((Date.now() - t0) / 1000) * 6)) + "%";
      if (job.status === "done") {
        state.songs.unshift(job.song);
        updateCount();
        toast(`✂️ “${job.song.title}” criada (${job.song.edit.changes.join(", ")})`, false, 6000);
        openSong(job.song);
        break;
      }
    }
  } catch (err) {
    toast(err.message, true, 7000);
  } finally {
    btn.disabled = false;
    $("#ed-progress").classList.add("hidden");
  }
};

// Velocidade de ensaio no player
const SPEEDS = [1, 0.75, 0.9, 1.1, 1.25];
$("#p-speed").onclick = (e) => {
  const i = (SPEEDS.indexOf(audio.playbackRate) + 1) % SPEEDS.length;
  audio.playbackRate = SPEEDS[i];
  audio.preservesPitch = true;
  e.currentTarget.textContent = `${SPEEDS[i]}x`.replace(".", ",");
  toast(SPEEDS[i] === 1 ? "Velocidade normal" : `Velocidade de ensaio: ${String(SPEEDS[i]).replace(".", ",")}x (o tom não muda)`, false, 2200);
};

// ---------------- Ficha técnica ----------------
const LYRICS_SOURCE = { ia: "Composta pela IA", propria: "Letra própria", missal: "Texto oficial do Missal" };
function specGroups(song) {
  const o = song.options || {};
  const sp = song.spec || {};
  const keyTxt = o.key ? o.key.replace(" major", " maior").replace(" minor", " menor") : "automático";
  const groups = [
    ["Criação", [
      ["Data", new Date(song.createdAt).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" })],
      ["Tipo", o.mode === "catolica" ? "Canto litúrgico" : "Música livre"],
      ["Letra", LYRICS_SOURCE[sp.lyricsSource] || "—"],
      ["Servidor", sp.engine],
      ["Tempo de criação", sp.generationSeconds ? fmt(sp.generationSeconds) : null],
      ["Pronúncia (Whisper)", sp.pronunciation != null ? `${sp.pronunciation}% da letra entendida${sp.takes > 1 ? ` · melhor de ${sp.takes} gravações` : ""}` : null],
      ["Refeita em", song.remadeAt ? new Date(song.remadeAt).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" }) : null],
      ["Edição", song.edit?.changes?.length ? song.edit.changes.join(", ") : null],
    ]],
  ];
  if (o.mode === "catolica")
    groups.push(["Liturgia", [
      ["Momento", o.moment], ["Tempo litúrgico", o.season], ["Ocasião", o.occasion], ["Forma", o.form],
    ]]);
  groups.push(
    ["Tema", [["Ideia", sp.idea || "—"]]],
    ["Estilo", [["Gênero", o.genre], ["Clima", (o.moods || []).join(", ") || "—"], ["Referência", song.reference ? `🎧 ${song.reference}` : null]]],
    ["Tempo e tom", [["Andamento", o.bpm ? `${o.bpm} BPM${o.tempo === "auto" ? " (automático)" : ""}` : "automático"], ["Tom", keyTxt], ["Progressão", o.chordProgression || null]]],
    ["Instrumentos e vozes", [["Instrumentos", (o.instruments || []).join(", ") || "automático"], ["Voz", o.voice], ["Timbre", (o.voiceStyles || []).join(", ") || null]]],
    ["Saída", [
      ["Idioma", LANG_LABEL[sp.language] || sp.language || "—"],
      ["Duração", `${fmt(song.duration || 0)}${sp.requestedDuration && Math.abs(sp.requestedDuration - song.duration) > 2 ? ` (pedida: ${fmt(sp.requestedDuration)})` : ""}`],
      ["Qualidade", (sp.quality || o.quality) === "high" ? "Alta qualidade" : "Rápida"],
    ]],
  );
  return groups.map(([t, rows]) => [t, rows.filter(([, v]) => v != null && v !== "")]);
}
function renderSpec(song) {
  const o = song.options || {};
  let html = specGroups(song)
    .map(([t, rows]) => `<div class="spec-box"><h5>${esc(t)}</h5><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>`)
    .join("");
  if (o.reading) html += `<div class="spec-box wide"><h5>Leitura base</h5><div class="reading">${esc(o.reading)}</div></div>`;
  if (song.spec?.musicPrompt) html += `<div class="spec-box wide"><h5>Instrução enviada à IA de música</h5><div class="reading">${esc(song.spec.musicPrompt)}</div></div>`;
  if (!song.options) html = `<div class="pane-empty">Esta música foi criada numa versão anterior do app, que ainda não guardava a ficha.</div>`;
  $("#spec-grid").innerHTML = html;
  $("#spec-apply").disabled = !song.options;
}
const specText = (song) =>
  `${song.title}\n\n` + specGroups(song).map(([t, rows]) => `${t.toUpperCase()}\n` + rows.map(([k, v]) => `• ${k}: ${v}`).join("\n")).join("\n\n");
$("#spec-copy").onclick = async () => {
  await navigator.clipboard.writeText(specText(dlgSong));
  toast("Ficha copiada ✓", false, 1800);
};

// Leva todas as escolhas da música de volta ao console do estúdio
function applySpec(song) {
  const o = song.options || {};
  const sp = song.spec || {};
  $(`#mode-switch [data-mode="${o.mode === "livre" ? "livre" : "catolica"}"]`).click();
  if (o.mode === "catolica") {
    if (o.moment) {
      state.moment = o.moment;
      $$("#moment-groups .chip").forEach((c) => c.classList.toggle("on", c.textContent === o.moment));
    }
    if (o.season) {
      $("#season").value = o.season;
      $("#season").dispatchEvent(new Event("change"));
      state.season = o.season;
    }
    if (o.form) {
      state.form = o.form;
      $$("#form-opts button").forEach((b) => b.classList.toggle("on", $("b", b)?.textContent === o.form));
    }
    $("#occasion").value = o.occasion || "";
    $("#reading").value = o.reading || "";
  }
  $("#idea").value = sp.idea || "";
  $("#idea").dispatchEvent(new Event("input"));
  for (const [cat, list] of Object.entries(GENRES)) {
    const g = list.find((x) => x[0] === o.genre);
    if (g) {
      state.genre = g;
      state.genreCat = cat;
    }
  }
  renderGenres();
  state.moods = MOODS[state.mode].filter((m) => (o.moods || []).includes(m[0]));
  multiChips($("#mood-chips"), MOODS[state.mode], "moods", 3, () => sumList("#sum-mood", state.moods, "livre"));
  state.tempo = o.tempo === "auto" || !o.bpm ? "auto" : TEMPO_BPM[o.tempo] ? o.tempo : "manual";
  if (o.bpm) state.bpm = o.bpm;
  $$("#tempo-presets button").forEach((b, i) => b.classList.toggle("on", TEMPOS[i][0] === state.tempo));
  const km = /^([A-G](?:#|b)?)\s+(major|minor)$/.exec(o.key || "");
  state.keyNote = km ? km[1] : "";
  state.keyScale = km?.[2] === "minor" ? "minor" : "major";
  $("#key-note").value = state.keyNote;
  $$("#key-scale button").forEach((b) => b.classList.toggle("on", b.dataset.s === state.keyScale));
  syncTempo();
  state.instruments = INSTRUMENTS.filter((i) => (o.instruments || []).includes(i[0]));
  multiChips($("#inst-chips"), INSTRUMENTS, "instruments", 5, () => sumList("#sum-inst", state.instruments, "automático"));
  state.voice = VOICE_TYPES.find((v) => v[0] === o.voice) || VOICE_TYPES[0];
  $$("#voice-type button").forEach((b) => b.classList.toggle("on", b.textContent === state.voice[0]));
  state.voiceStyles = VOICE_STYLES.filter((v) => (o.voiceStyles || []).includes(v[0]));
  multiChips($("#voice-style"), VOICE_STYLES, "voiceStyles", 2, syncVoice);
  state.quality = (sp.quality || o.quality) === "high" ? "high" : "fast";
  $$("#quality button").forEach((b) => b.classList.toggle("on", b.dataset.q === state.quality));
  if (sp.language) $("#language").value = sp.language;
  $("#duration").value = sp.requestedDuration || song.duration || 60;
  $("#duration").dispatchEvent(new Event("input"));
  updateOfficial();
  updateLcd();
  state.lastOptions = null;
}
$("#spec-apply").onclick = () => {
  applySpec(dlgSong);
  $("#song-dialog").close();
  // caderno limpo: a nova letra será composta com as mesmas escolhas
  state.plan = null;
  $("#nb-body").classList.add("hidden");
  $("#nb-empty").classList.remove("hidden");
  showView("create");
  goStep(stepEls().length - 1);
  toast("Especificações carregadas. Revise no resumo e toque em Compor letra.", false, 6000);
};

$("#copy-lyrics").onclick = async () => {
  await navigator.clipboard.writeText(lyricsText(dlgSong).replace(/[*_]/g, ""));
  toast("Letra copiada ✓", false, 1800);
};
$("#wa-lyrics").onclick = () => shareText(lyricsText(dlgSong));

// ---------------- Cifra ----------------
const SHARPS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const ALIAS = { Db: "C#", "D#": "Eb", Gb: "F#", "G#": "Ab", "A#": "Bb", Cb: "B", Fb: "E", "E#": "F", "B#": "C" };
let transposeBy = 0;
function trNote(n, by) {
  const k = ALIAS[n] || n;
  const i = SHARPS.indexOf(k);
  return i < 0 ? n : SHARPS[(i + by + 120) % 12];
}
function trChord(ch, by) {
  if (!by) return ch;
  return ch.replace(/^([A-G](?:#|b)?)/, (m) => trNote(m, by)).replace(/\/([A-G](?:#|b)?)/, (m, n) => "/" + trNote(n, by));
}
function chordLine(line, by) {
  const parts = line.split(/(\[[^\]]+\])/);
  let lyric = "";
  const chords = [];
  let lastEnd = 0;
  for (const p of parts) {
    const m = p.match(/^\[([^\]]+)\]$/);
    if (m) {
      const c = trChord(m[1], by);
      let pos = lyric.length;
      if (pos < lastEnd) {
        lyric = lyric.padEnd(lastEnd);
        pos = lastEnd;
      }
      chords.push([pos, c]);
      lastEnd = pos + c.length + 1;
    } else lyric += p;
  }
  let top = "", html = "";
  for (const [pos, c] of chords) {
    const pad = " ".repeat(Math.max(0, pos - top.length));
    top += pad + c;
    html += pad + `<span class="ch">${esc(c)}</span>`;
  }
  return { top, html, lyric: lyric.trimEnd() };
}
function chordSheet(song, by, asHtml) {
  const ch = song.chords;
  if (!ch) return "";
  return ch.sections
    .map((s) => {
      const lines = s.lines.map((l) => {
        const r = chordLine(l, by);
        return asHtml ? (r.top ? r.html + "\n" : "") + esc(r.lyric) : (r.top ? r.top + "\n" : "") + r.lyric;
      });
      return asHtml ? `<div class="sec"><h5>${esc(s.name)}</h5><pre>${lines.join("\n")}</pre></div>` : `[${s.name}]\n${lines.join("\n")}`;
    })
    .join(asHtml ? "" : "\n\n");
}
const currentKey = () => (dlgSong?.chords ? trChord(dlgSong.chords.key || "", transposeBy) : "");
// ---------- Teoria dos acordes: notas, violão e teclado ----------
let chordInst = "violao";
const NOTE_IDX = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11 };
const FLAT_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
function parseChord(ch) {
  const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(String(ch).trim());
  return m ? { root: NOTE_IDX[m[1]], q: m[2].replace(/[()]/g, ""), bass: m[3] != null ? NOTE_IDX[m[3]] : null } : null;
}
// categoria usada nos desenhos de violão
function chordCat(q) {
  if (/dim|°|º/.test(q)) return "dim";
  if (/sus2/.test(q)) return "sus2";
  if (/sus/.test(q)) return "sus4";
  if (/maj7|7M/.test(q)) return "maj7";
  const minor = /^m(?!aj)/.test(q);
  if (/7|9|11|13/.test(q)) return minor ? "m7" : "7";
  if (/add9/.test(q)) return "add9";
  return minor ? "m" : "";
}
function chordNotes(q) {
  let base = /^m(?!aj)/.test(q) ? [0, 3, 7] : [0, 4, 7];
  if (/dim|°|º/.test(q)) base = [0, 3, 6];
  if (/aug|\+/.test(q)) base = [0, 4, 8];
  if (/sus2/.test(q)) base = [0, 2, 7];
  else if (/sus/.test(q)) base = [0, 5, 7];
  const add = [];
  if (/maj7|7M/.test(q)) add.push(11);
  else if (/7|9|11|13/.test(q) && !/add/.test(q)) add.push(/dim7|°7|º7/.test(q) ? 9 : 10);
  if (/6/.test(q)) add.push(9);
  if (/9/.test(q)) add.push(14);
  return [...new Set([...base, ...add])];
}
// Formas abertas mais comuns (6ª corda → 1ª; x = não tocar)
const OPEN_SHAPES = {
  C: "x32010", D: "xx0232", E: "022100", G: "320003", A: "x02220", F: "133211", Bb: "x13331",
  Am: "x02210", Em: "022000", Dm: "xx0231", Bm: "x24432", "F#m": "244222", Gm: "355333", Cm: "x35543",
  C7: "x32310", D7: "xx0212", E7: "020100", G7: "320001", A7: "x02020", B7: "x21202",
  Am7: "x02010", Em7: "022030", Dm7: "xx0211", Bm7: "x20202",
  Cmaj7: "x32000", Dmaj7: "xx0222", Fmaj7: "xx3210", Gmaj7: "320002", Amaj7: "x02120",
  Dsus4: "xx0233", Asus4: "x02230", Esus4: "022200", Dsus2: "xx0230", Asus2: "x02200", Cadd9: "x32030", Gadd9: "320203",
};
// Formas móveis (pestana) a partir de E (6ª corda) e de A (5ª corda)
const E_SHAPES = { "": [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], maj7: [0, 2, 1, 1, 0, 0], sus4: [0, 2, 2, 2, 0, 0] };
const A_SHAPES = { "": [-1, 0, 2, 2, 2, 0], m: [-1, 0, 2, 2, 1, 0], 7: [-1, 0, 2, 0, 2, 0], m7: [-1, 0, 2, 0, 1, 0], maj7: [-1, 0, 2, 1, 2, 0], sus4: [-1, 0, 2, 2, 3, 0], sus2: [-1, 0, 2, 2, 0, 0], dim: [-1, 0, 1, 2, 1, -1], add9: [-1, 0, 2, 4, 2, 0] };
function guitarShape(ch) {
  const p = parseChord(ch);
  if (!p) return null;
  const cat = chordCat(p.q);
  let frets, barre = 0;
  const open = OPEN_SHAPES[FLAT_NAMES[p.root] + cat] || (cat === "add9" ? OPEN_SHAPES[FLAT_NAMES[p.root]] : null);
  if (open) {
    frets = [...open].map((c) => (c === "x" ? -1 : Number(c)));
    // pestana (ex.: F, Bm): a menor casa está na corda mais grave tocada E na 1ª corda, sem corda solta
    const played = frets.filter((f) => f > 0);
    const min = played.length ? Math.min(...played) : 0;
    const lowest = frets.findIndex((f) => f >= 0);
    if (min > 0 && frets[lowest] === min && frets[5] === min && !frets.includes(0)) barre = min;
  } else {
    const opts = [];
    const fe = (p.root - 4 + 12) % 12, fa = (p.root - 9 + 12) % 12;
    if (E_SHAPES[cat]) opts.push({ shape: E_SHAPES[cat], f: fe || 12 });
    if (A_SHAPES[cat]) opts.push({ shape: A_SHAPES[cat], f: fa || 12 });
    if (!opts.length) opts.push({ shape: E_SHAPES[/^m/.test(cat) ? "m" : ""], f: fe || 12 });
    const best = opts.sort((a, b) => a.f - b.f)[0];
    frets = best.shape.map((v) => (v < 0 ? -1 : v + best.f));
    barre = best.shape.filter((v) => v === 0).length >= 2 ? best.f : 0;
  }
  // acorde com baixo (ex.: D/F#): coloca o baixo na 6ª corda, se ela estiver livre e a casa for próxima
  if (p.bass != null && frets[0] < 0) {
    const fb = (p.bass - 4 + 12) % 12;
    const played = frets.filter((f) => f > 0);
    if (fb <= Math.max(4, ...played) && (!played.length || Math.abs(fb - Math.min(...played)) <= 4)) frets[0] = fb;
  }
  return { frets, barre };
}
function guitarSvg(ch) {
  const s = guitarShape(ch);
  if (!s) return "";
  const played = s.frets.filter((f) => f > 0);
  const top = played.length && Math.max(...played) > 4 ? Math.min(...played) : 1;
  const X = (i) => 12 + i * 11, Y = (f) => 24 + (f - top + 0.5) * 15;
  let g = "";
  for (let i = 0; i < 6; i++) g += `<line x1="${X(i)}" y1="24" x2="${X(i)}" y2="99" stroke="#333" stroke-width="1"/>`;
  for (let j = 0; j <= 5; j++) g += `<line x1="12" y1="${24 + j * 15}" x2="67" y2="${24 + j * 15}" stroke="#333" stroke-width="${j === 0 && top === 1 ? 4 : 1}"/>`;
  if (top > 1) g += `<text x="1" y="${Y(top) + 4}" font-size="10" fill="#444">${top}</text>`;
  if (s.barre) {
    const idx = s.frets.map((f, i) => (f === s.barre ? i : -1)).filter((i) => i >= 0);
    g += `<rect x="${X(idx[0]) - 4}" y="${Y(s.barre) - 5}" width="${X(idx[idx.length - 1]) - X(idx[0]) + 8}" height="10" rx="5" fill="#ec4899"/>`;
  }
  s.frets.forEach((f, i) => {
    if (f < 0) g += `<text x="${X(i)}" y="17" font-size="10" text-anchor="middle" fill="#666">×</text>`;
    else if (f === 0) g += `<circle cx="${X(i)}" cy="13" r="3.2" fill="none" stroke="#666" stroke-width="1.2"/>`;
    else if (f !== s.barre) g += `<circle cx="${X(i)}" cy="${Y(f)}" r="4.5" fill="#a855f7"/>`;
  });
  return `<svg viewBox="0 0 80 104">${g}</svg>`;
}
function keyboardSvg(ch) {
  const p = parseChord(ch);
  if (!p) return "";
  const notes = new Set(chordNotes(p.q).map((iv) => { let n = p.root + iv; while (n >= 24) n -= 12; return n; }));
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  let w = "", b = "";
  for (let n = 0; n < 24; n++) {
    const pc = n % 12, oct = Math.floor(n / 12);
    const on = notes.has(n), isRoot = n === p.root, isBass = p.bass != null && n === p.bass;
    const fill = isBass ? "#3b82f6" : isRoot ? "#ec4899" : on ? "#a855f7" : null;
    if (WHITE.includes(pc)) {
      const x = (oct * 7 + WHITE.indexOf(pc)) * 12;
      w += `<rect x="${x}" y="0" width="12" height="56" fill="${fill || "#fff"}" stroke="#333" stroke-width="0.8"/>`;
    } else {
      const x = (oct * 7 + WHITE.indexOf(pc - 1)) * 12 + 8.5;
      b += `<rect x="${x}" y="0" width="7" height="34" rx="1" fill="${fill || "#222"}"/>`;
    }
  }
  return `<svg viewBox="0 0 168 57">${w}${b}</svg>`;
}
const capoShift = () => (chordInst === "violao" ? Number($("#capo").value) || 0 : 0);
const shiftNow = () => transposeBy - capoShift();
function capoNote() {
  const c = capoShift();
  return c ? `Capotraste na ${c}ª casa · formas de ${trChord(dlgSong.chords.key || "", shiftNow())}` : "";
}
function renderChords() {
  const song = dlgSong;
  const has = !!song?.chords;
  $("#transpose").classList.toggle("hidden", !has);
  $("#chord-actions").classList.toggle("hidden", !has);
  $("#chord-diagrams-wrap").classList.toggle("hidden", !has);
  $(".capo").classList.toggle("hidden", chordInst !== "violao");
  $("#btn-chords").textContent = has ? "↻ Gerar de novo" : "🎸 Gerar cifra";
  if (!has) return ($("#chord-sheet").innerHTML = `<div class="pane-empty">Escolha o tom e toque em <b>Gerar cifra</b>.</div>`);
  const sh = shiftNow();
  $("#tr-key").textContent = currentKey();
  const prog = song.chords.progression ? song.chords.progression.split(/\s*[–-]\s*/).map((c) => trChord(c, sh)).join(" – ") : "";
  $("#chord-sheet").innerHTML =
    `<div class="prog">${song.chords.source === "audio" ? "🎧 Tirada do áudio · " : ""}Tom: ${esc(currentKey())}${capoNote() ? ` · <b>${esc(capoNote())}</b>` : ""}${prog ? ` · Progressão: ${esc(prog)}` : ""}</div>` +
    chordSheet(song, sh, true);
  // desenhos dos acordes usados, na ordem em que aparecem
  const used = [];
  for (const sec of song.chords.sections) for (const l of sec.lines) for (const m of l.matchAll(/\[([^\]]+)\]/g)) {
    const c = trChord(m[1], sh);
    if (!used.includes(c)) used.push(c);
  }
  const box = $("#chord-diagrams");
  box.classList.toggle("keys", chordInst === "teclado");
  $("#diag-title").textContent = chordInst === "violao" ? "Acordes no violão" : "Acordes no teclado (rosa = tônica, azul = baixo)";
  box.innerHTML = used
    .slice(0, 24)
    .map((c) => `<div class="diag"><b>${esc(c)}</b>${chordInst === "violao" ? guitarSvg(c) : keyboardSvg(c)}${capoShift() ? `<small>soa como ${esc(trChord(c, capoShift()))}</small>` : ""}</div>`)
    .join("");
}
$$("#chord-inst button").forEach((b) =>
  b.addEventListener("click", () => {
    chordInst = b.dataset.i;
    $$("#chord-inst button").forEach((x) => x.classList.toggle("on", x === b));
    renderChords();
  }),
);
$("#capo").addEventListener("change", renderChords);

// ---------- Metrônomo ----------
let metro = null;
function stopMetro() {
  if (!metro) return;
  clearInterval(metro.timer);
  metro.ctx.close();
  metro = null;
  $("#metro").classList.remove("on");
  $("#metro").textContent = "♩ Metrônomo";
}
$("#metro").onclick = () => {
  if (metro) return stopMetro();
  const bpm = dlgSong?.options?.bpm || 90;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let beat = 0;
  const tick = () => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = beat % 4 === 0 ? 1600 : 1000;
    g.gain.setValueAtTime(0.4, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.07);
    beat++;
  };
  tick();
  metro = { ctx, timer: setInterval(tick, 60000 / bpm) };
  $("#metro").classList.add("on");
  $("#metro").textContent = `■ ${bpm} BPM`;
};
$("#song-dialog").addEventListener("close", stopMetro);
$("#btn-chords").onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "🎧 Ouvindo a música… (1 a 3 min)";
  try {
    dlgSong.chords = await api(`/api/songs/${dlgSong.id}/chords`, { method: "POST", body: JSON.stringify({ key: $("#chord-key").value }) });
    transposeBy = 0;
    renderChords();
  } catch (err) {
    toast(err.message, true, 7000);
  } finally {
    btn.disabled = false;
    if (!dlgSong.chords) btn.textContent = "🎸 Gerar cifra";
    else btn.textContent = "↻ Gerar de novo";
  }
};
$$("[data-tr]").forEach((b) => b.addEventListener("click", () => ((transposeBy += Number(b.dataset.tr)), renderChords())));
const chordsText = (song) =>
  `*${song.title}* — Tom: ${currentKey()}${capoNote() ? `\n_${capoNote()}_` : ""}\n\`\`\`\n${chordSheet(song, shiftNow(), false)}\n\`\`\`\n🎸 Cifra criada no ACAIAMUSIC`;
$("#copy-chords").onclick = async () => {
  await navigator.clipboard.writeText(`${dlgSong.title} — Tom: ${currentKey()}${capoNote() ? `\n${capoNote()}` : ""}\n\n${chordSheet(dlgSong, shiftNow(), false)}`);
  toast("Cifra copiada ✓", false, 1800);
};
$("#wa-chords").onclick = () => shareText(chordsText(dlgSong));
$("#print-chords").onclick = () => {
  const div = document.createElement("div");
  div.id = "print-area";
  div.innerHTML = `<h1>${esc(dlgSong.title)}</h1><p>Tom: ${esc(currentKey())}${capoNote() ? ` · ${esc(capoNote())}` : ""}</p>${chordSheet(dlgSong, shiftNow(), true)}<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px">${$("#chord-diagrams").innerHTML.replace(/class="diag"/g, 'style="width:90px;text-align:center"')}</div><p style="margin-top:30px;font-size:11px">Cifra criada no ACAIAMUSIC</p>`;
  document.body.appendChild(div);
  window.print();
  div.remove();
};

// ---------------- Karaokê: cantar por cima do playback, juntar e melhorar ----------------
let kk = null;
let kkReverb = "igreja";
function renderKaraoke() {
  const s = dlgSong;
  const has = !!s?.stems?.instrumental;
  $("#kk-need").classList.toggle("hidden", has);
  $("#kk-studio").classList.toggle("hidden", !has);
  if (!has || kk?.rec?.state === "recording") return;
  let n = 0;
  $("#kk-lyrics").innerHTML = (s.sections || [])
    .filter((x) => x.lines.length)
    .map((x) => `<p class="kk-sec">${esc(x.name)}</p>` + x.lines.map((l) => `<p class="kk-line" data-n="${n++}">${esc(l)}</p>`).join(""))
    .join("") || `<p class="kk-line">♪ Instrumental ♪</p>`;
  $("#kk-review").classList.add("hidden");
  $("#kk-result").classList.add("hidden");
  $("#kk-progress").classList.add("hidden");
  $("#kk-prog").style.width = "0%";
  $("#kk-time").textContent = "0:00";
  // tempos reais de cada verso (calculados ouvindo a faixa de voz)
  kkTiming = null;
  const id = s.id;
  api(`/api/songs/${id}/timing`)
    .then((t) => {
      if (dlgSong?.id !== id) return;
      kkTiming = t.times?.length === n ? t : null;
      $("#kk-sync-tag").textContent = kkTiming ? "🎯 letra sincronizada com a voz" : "letra em tempo aproximado";
    })
    .catch(() => {});
}
let kkTiming = null;
$("#kk-go-stems").onclick = () => {
  selectTab("faixas");
  $("#btn-stems").click();
};
$$("#kk-reverb button").forEach((b) =>
  b.addEventListener("click", () => {
    kkReverb = b.dataset.r;
    $$("#kk-reverb button").forEach((x) => x.classList.toggle("on", x === b));
  }),
);
$("#kk-gain").oninput = (e) => ($("#kk-gain-out").textContent = `${e.target.value > 0 ? "+" : ""}${e.target.value} dB`);
$("#kk-sync").oninput = (e) => ($("#kk-sync-out").textContent = Number(e.target.value) ? `${e.target.value > 0 ? "+" : ""}${e.target.value} ms` : "automática");
$("#kk-gain").dispatchEvent(new Event("input"));

function kkFollow() {
  // a letra acompanha a música de forma aproximada (pela posição no tempo)
  if (!kk?.inst) return;
  const t = kk.inst.currentTime, d = kk.inst.duration || dlgSong.duration || 1;
  $("#kk-prog").style.width = `${Math.min(100, (t / d) * 100)}%`;
  $("#kk-time").textContent = `${fmt(t)} / ${fmt(d)}`;
  const lines = $$("#kk-lyrics .kk-line");
  if (lines.length) {
    let k = -1, p = 0;
    if (kkTiming) {
      const T = kkTiming.times, lead = 0.15; // acende um tiquinho antes, para dar tempo de ler
      for (let i = 0; i < T.length; i++) if (T[i] <= t + lead) k = i;
      if (k >= 0) {
        const end = T[k + 1] ?? T[k] + Math.max(3, (d - T[k]) / 2);
        p = Math.max(0, Math.min(1, (t - T[k]) / Math.max(0.5, end - T[k] - 0.3)));
      }
      const wait = (T[0] ?? 0) - t;
      $("#kk-count").textContent = k < 0 && wait > 0 && wait <= 3.2 ? `entra em ${Math.ceil(wait)}` : "";
    } else {
      const intro = Math.min(12, d * 0.08); // sem a faixa de voz: estimativa pela duração
      if (t > intro * 0.6) k = Math.max(0, Math.min(lines.length - 1, Math.floor(((t - intro) / Math.max(1, d - intro * 1.5)) * lines.length)));
    }
    lines.forEach((el, i) => {
      el.classList.toggle("on", i === k);
      el.classList.toggle("done", i < k);
      el.classList.toggle("next", i === k + 1);
    });
    if (k >= 0) {
      lines[k].style.setProperty("--p", kkTiming ? `${Math.round(p * 100)}%` : "100%");
      if (kk.lastK !== k) lines[k].scrollIntoView({ block: "center", behavior: "smooth" });
    }
    kk.lastK = k;
  }
  kk.raf = requestAnimationFrame(kkFollow);
}
$("#kk-rec").onclick = async () => {
  const s = dlgSong;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("Este navegador não grava áudio. Use o Chrome ou o Edge atualizados.", true, 7000);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: $("#kk-nophones").checked, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  } catch {
    return toast("Permita o uso do microfone para gravar a sua voz.", true, 7000);
  }
  audio.pause(); // para o player principal
  const inst = new Audio(s.stems.instrumental);
  inst.preload = "auto";
  const gv = Number($("#kk-guide").value);
  const guide = gv > 0 && s.stems.vocals ? Object.assign(new Audio(s.stems.vocals), { volume: gv }) : null;
  $("#kk-rec").disabled = true;
  $("#kk-review").classList.add("hidden");
  $("#kk-result").classList.add("hidden");
  await new Promise((r) => (inst.readyState >= 3 ? r() : inst.addEventListener("canplaythrough", r, { once: true })));
  for (const n of [3, 2, 1]) {
    $("#kk-count").textContent = n;
    await sleep(750);
  }
  $("#kk-count").textContent = "";
  const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 160000 } : {});
  let latency = 0;
  try {
    const ac = new AudioContext();
    latency = (ac.outputLatency || 0) + (ac.baseLatency || 0);
    ac.close();
  } catch {}
  kk = { rec, chunks: [], stream, inst, guide, latency };
  rec.ondataavailable = (e) => e.data.size && kk.chunks.push(e.data);
  rec.onstart = () => {
    kk.tRec = performance.now();
    inst.play();
    guide?.play();
  };
  inst.addEventListener("playing", () => kk.tPlay || (kk.tPlay = performance.now()), { once: true });
  inst.onended = kkStop;
  rec.onstop = kkFinish;
  rec.start(1000);
  $("#kk-rec").classList.add("hidden");
  $("#kk-stop").classList.remove("hidden");
  kkFollow();
};
function kkStop() {
  if (!kk) return;
  if (kk.rec?.state === "recording") kk.rec.stop();
  kk.inst?.pause();
  kk.guide?.pause();
  kk.stream?.getTracks().forEach((t) => t.stop());
  cancelAnimationFrame(kk.raf);
  $("#kk-stop").classList.add("hidden");
  $("#kk-rec").classList.remove("hidden");
  $("#kk-rec").disabled = false;
}
function kkFinish() {
  kk.blob = new Blob(kk.chunks, { type: kk.rec.mimeType || "audio/webm" });
  // a gravação começa um pouco antes do playback: esse trecho é cortado na hora de juntar
  kk.offset = Math.max(0, ((kk.tPlay || kk.tRec) - kk.tRec) / 1000) + kk.latency;
  $("#kk-raw").src = URL.createObjectURL(kk.blob);
  $("#kk-review").classList.remove("hidden");
  $("#kk-review").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
$("#kk-stop").onclick = kkStop;
// descarta a gravação (voz pura) sem juntar
$("#kk-discard").onclick = () => {
  if (!confirm("Excluir esta gravação? Ela ainda não foi salva.")) return;
  if ($("#kk-raw").src) URL.revokeObjectURL($("#kk-raw").src);
  $("#kk-raw").removeAttribute("src");
  if (kk) kk.blob = null;
  $("#kk-review").classList.add("hidden");
  toast("Gravação excluída.");
};
$("#kk-again").onclick = () => {
  $("#kk-review").classList.add("hidden");
  $("#kk-rec").click();
};
$("#kk-mix").onclick = async (e) => {
  const song = dlgSong;
  if (!kk?.blob) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  $("#kk-progress").classList.remove("hidden");
  $("#kk-msg").textContent = "Enviando a sua gravação…";
  $("#kk-bar").style.width = "8%";
  try {
    const data = await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.readAsDataURL(kk.blob);
    });
    const { jobId } = await api(`/api/songs/${song.id}/karaoke`, {
      method: "POST",
      body: JSON.stringify({ audio: data, offset: kk.offset + Number($("#kk-sync").value) / 1000, voiceGain: Number($("#kk-gain").value), reverb: kkReverb, enhance: $("#kk-enhance").checked }),
    });
    const t0 = Date.now();
    for (;;) {
      await sleep(1500);
      const j = await api(`/api/jobs/${jobId}`);
      if (j.status === "error" || j.status === "canceled") throw new Error(j.error || "Música cancelada.");
      $("#kk-msg").textContent = j.message;
      $("#kk-bar").style.width = (j.status === "done" ? 100 : Math.min(92, 12 + ((Date.now() - t0) / 1000 / 30) * 80)) + "%";
      if (j.status === "done") {
        state.songs.unshift(j.song);
        updateCount();
        $("#kk-out").src = j.song.url;
        $("#kk-dl").href = j.song.url;
        $("#kk-dl").download = `${safeName(j.song.title)}.mp3`;
        $("#kk-open").onclick = () => openSong(j.song);
        // apaga a versão cantada (a música que foi salva na biblioteca)
        $("#kk-del").onclick = async () => {
          if (!confirm(`Excluir “${j.song.title}” da biblioteca?`)) return;
          try {
            await api(`/api/songs/${j.song.id}`, { method: "DELETE" });
          } catch (err) {
            return toast(err.message, true);
          }
          state.songs = state.songs.filter((s) => s.id !== j.song.id);
          updateCount();
          if (state.current?.id === j.song.id) closePlayer();
          $("#kk-out").removeAttribute("src");
          $("#kk-result").classList.add("hidden");
          toast("Versão cantada excluída.");
        };
        $("#kk-result").classList.remove("hidden");
        $("#kk-result").scrollIntoView({ behavior: "smooth", block: "nearest" });
        toast("🎤 Sua versão foi gravada e salva na biblioteca!", false, 5000);
        break;
      }
    }
  } catch (err) {
    toast(err.message, true, 8000);
  } finally {
    btn.disabled = false;
    $("#kk-progress").classList.add("hidden");
  }
};
$("#song-dialog").addEventListener("close", kkStop);

// ---------------- Faixas (separação + mixer) ----------------
const STEMS = [["vocals", "VOZ"], ["drums", "BATERIA"], ["bass", "BAIXO"], ["other", "INSTRUMENTOS"]];
let mixer = null;
function renderStems() {
  renderKaraoke();
  const s = dlgSong;
  const has = !!s?.stems;
  $("#stems-empty").classList.toggle("hidden", has);
  $("#mixer").classList.toggle("hidden", !has);
  $("#stems-eta").textContent = `Tempo estimado: cerca de ${Math.max(3, Math.round(((s?.duration || 60) / 60) * 8))} min (servidor gratuito). Você pode fechar esta janela; a separação continua.`;
  if (!has) return;
  $("#dl-instrumental").href = s.stems.instrumental;
  $("#dl-instrumental").download = `${safeName(s.title)} (playback sem voz).mp3`;
  $("#dl-vocals").href = s.stems.vocals;
  $("#dl-vocals").download = `${safeName(s.title)} (voz).mp3`;
  $("#channels").innerHTML = STEMS.map(
    ([k, label]) => `<div class="channel" data-k="${k}">
      <h5>${label}</h5>
      <div class="meter-led"><i></i></div>
      <input type="range" min="0" max="100" value="100" aria-label="Volume ${label}" />
      <div class="ms"><button class="m" title="Mudo">M</button><button class="s" title="Solo">S</button></div>
      <a href="${s.stems[k]}" download="${esc(safeName(s.title))} (${label.toLowerCase()}).mp3">⬇ baixar</a>
    </div>`,
  ).join("");
  $("#mix-play").innerHTML = PLAY_SVG;
}
const stemJobs = {};
$("#btn-stems").onclick = async (e) => {
  const song = dlgSong;
  e.currentTarget.disabled = true;
  $("#stem-progress").classList.remove("hidden");
  $("#stem-msg").textContent = "Enviando…";
  try {
    const r = await api(`/api/songs/${song.id}/stems`, { method: "POST" });
    if (r.done) {
      Object.assign(song, r.song);
      return renderStems();
    }
    stemJobs[song.id] = r.jobId;
    const t0 = Date.now();
    const eta = Math.max(180, ((song.duration || 60) / 60) * 480);
    for (;;) {
      await sleep(4000);
      const job = await api(`/api/jobs/${r.jobId}`);
      if (job.status === "error" || job.status === "canceled") throw new Error(job.error || "Música cancelada.");
      const pct = job.status === "done" ? 100 : Math.min(95, ((Date.now() - t0) / 1000 / eta) * 100);
      if (dlgSong?.id === song.id) {
        $("#stem-bar").style.width = pct + "%";
        $("#stem-msg").textContent = `${job.message} · ${fmt((Date.now() - t0) / 1000)}`;
      }
      if (job.status === "done") {
        song.stems = job.song.stems;
        toast(`🎚️ Faixas de “${song.title}” prontas!`);
        if (dlgSong?.id === song.id) renderStems();
        break;
      }
    }
  } catch (err) {
    toast(err.message, true, 8000);
  } finally {
    if (dlgSong?.id === song.id) {
      $("#btn-stems").disabled = false;
      $("#stem-progress").classList.add("hidden");
    }
  }
};

function buildMixer() {
  const s = dlgSong;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const chans = STEMS.map(([k]) => {
    const el = new Audio(s.stems[k]);
    el.preload = "auto";
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    const an = ctx.createAnalyser();
    an.fftSize = 256;
    src.connect(gain).connect(an).connect(ctx.destination);
    return { k, el, gain, an, data: new Uint8Array(an.fftSize), vol: 1, mute: false, solo: false };
  });
  const m = { ctx, chans, playing: false, raf: 0 };
  const master = chans[0].el;
  master.addEventListener("timeupdate", () => {
    if (!master.duration) return;
    $("#mix-seek").value = (master.currentTime / master.duration) * 1000;
    $("#mix-time").textContent = fmt(master.currentTime);
    chans.slice(1).forEach((c) => Math.abs(c.el.currentTime - master.currentTime) > 0.12 && (c.el.currentTime = master.currentTime));
  });
  master.addEventListener("ended", () => stopMixer(false));
  const apply = () => {
    const anySolo = chans.some((c) => c.solo);
    chans.forEach((c) => (c.gain.gain.value = c.mute || (anySolo && !c.solo) ? 0 : c.vol));
  };
  $$("#channels .channel").forEach((el, i) => {
    const c = chans[i];
    $("input", el).oninput = (e) => ((c.vol = e.target.value / 100), apply());
    $(".m", el).onclick = (e) => ((c.mute = !c.mute), e.currentTarget.classList.toggle("on", c.mute), apply());
    $(".s", el).onclick = (e) => ((c.solo = !c.solo), e.currentTarget.classList.toggle("on", c.solo), apply());
  });
  const meters = () => {
    m.raf = requestAnimationFrame(meters);
    chans.forEach((c, i) => {
      c.an.getByteTimeDomainData(c.data);
      let peak = 0;
      for (const v of c.data) peak = Math.max(peak, Math.abs(v - 128));
      const bar = $$("#channels .meter-led i")[i];
      if (bar) bar.style.height = Math.min(100, (peak / 128) * 160 * c.gain.gain.value) + "%";
    });
  };
  meters();
  return m;
}
function stopMixer(destroy = true) {
  if (!mixer) return;
  mixer.chans.forEach((c) => c.el.pause());
  mixer.playing = false;
  $("#mix-play").innerHTML = PLAY_SVG;
  if (destroy) {
    cancelAnimationFrame(mixer.raf);
    mixer.ctx.close();
    mixer = null;
  }
}
$("#mix-play").onclick = async () => {
  if (!dlgSong?.stems) return;
  if (!mixer) mixer = buildMixer();
  if (mixer.ctx.state === "suspended") await mixer.ctx.resume();
  if (mixer.playing) return stopMixer(false);
  audio.pause();
  const t = mixer.chans[0].el.currentTime;
  mixer.chans.forEach((c) => (c.el.currentTime = t));
  await Promise.all(mixer.chans.map((c) => c.el.play().catch(() => {})));
  mixer.playing = true;
  $("#mix-play").innerHTML = PAUSE_SVG;
};
$("#mix-seek").oninput = (e) => {
  if (!mixer) return;
  const d = mixer.chans[0].el.duration;
  if (d) mixer.chans.forEach((c) => (c.el.currentTime = (e.target.value / 1000) * d));
};
$("#wa-instrumental").onclick = () =>
  shareFile(dlgSong.stems.instrumental, `${safeName(dlgSong.title)} (playback).mp3`, "audio/mpeg", `🎚️ Playback sem voz: *${dlgSong.title}*\nCriado no ACAIAMUSIC`);

// ---------------- Vídeo para Status ----------------
let videoFormat = "vertical";
$$("#video-format button").forEach((b) =>
  b.addEventListener("click", () => {
    videoFormat = b.dataset.v;
    $$("#video-format button").forEach((x) => x.classList.toggle("on", x === b));
    drawVideoPreview();
  }),
);
function findChorusStart(song) {
  // Sem marcação de tempo exata: estima a posição do 1º refrão pela proporção de versos antes dele
  const secs = song.sections || [];
  const total = secs.reduce((a, s) => a + s.lines.length + 1, 0) || 1;
  let before = 0;
  for (const s of secs) {
    if (/refr|resposta|ant[ií]fona|chorus/i.test(s.name)) break;
    before += s.lines.length + 1;
  }
  return Math.max(0, Math.floor(((before / total) * (song.duration || 60)) - 3));
}
function updateVideoRange() {
  const st = Number($("#video-start").value);
  const end = Math.min(dlgSong?.duration || 60, st + 60);
  $("#video-range").textContent = `${fmt(st)} → ${fmt(end)}`;
}
$("#video-start").addEventListener("input", updateVideoRange);
$("#video-listen").onclick = () => {
  if (state.current?.id !== dlgSong.id) play(dlgSong);
  const go = () => ((audio.currentTime = Number($("#video-start").value)), audio.play());
  audio.readyState >= 1 ? go() : audio.addEventListener("loadedmetadata", go, { once: true });
};

function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
// Desenha a arte do vídeo e devolve a posição do equalizador e da barra de progresso
async function drawVideoArt(canvas, song, format) {
  const V = format !== "horizontal";
  const W = V ? 720 : 1280, H = V ? 1280 : 720;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  // capa ilustrada (imagem do tema da música) quando houver; senão, a arte abstrata da música
  const pic = song.illustration?.url ? await loadImg(song.illustration.url).catch(() => null) : null;
  const art = pic || (await loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(coverArt(song.cover ?? 1, 'width="800" height="800"'))));
  const logo = await loadImg("/icon.svg").catch(() => null);
  // fundo: capa ampliada, desfocada e escurecida
  ctx.filter = "blur(40px) saturate(1.2)";
  ctx.drawImage(art, -120, -120, W + 240, H + 240);
  ctx.filter = "none";
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(9,9,13,0.45)");
  g.addColorStop(0.55, "rgba(9,9,13,0.72)");
  g.addColorStop(1, "rgba(9,9,13,0.92)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // capa
  const cs = V ? 420 : 400, cx = V ? (W - cs) / 2 : 80, cy = V ? 140 : (H - cs) / 2 - 10;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 20;
  roundRect(ctx, cx, cy, cs, cs, 28);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, cx, cy, cs, cs, 28);
  ctx.clip();
  ctx.drawImage(art, cx, cy, cs, cs);
  if (!pic) {
    ctx.fillStyle = "rgba(255,255,255,0.93)";
    ctx.font = `900 ${cs * 0.3}px Segoe UI, Inter, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 20;
    ctx.fillText(initials(song.title), cx + cs / 2, cy + cs / 2);
  }
  ctx.restore();

  // textos
  const tx = V ? W / 2 : 540, tw = V ? W - 100 : W - 540 - 70;
  ctx.textAlign = V ? "center" : "left";
  ctx.textBaseline = "alphabetic";
  let y = V ? cy + cs + 80 : 150;
  const o = song.options || {};
  ctx.fillStyle = "#f472b6";
  ctx.font = "700 22px Consolas, ui-monospace, monospace";
  const kicker = (o.mode === "catolica" ? `${o.moment} · ${o.season}` : [song.genre, song.voice].filter(Boolean).join(" · ")).toUpperCase();
  ctx.fillText(kicker, tx, y);
  y += 56;
  ctx.fillStyle = "#fff";
  ctx.font = "800 50px Segoe UI, Inter, Arial, sans-serif";
  for (const l of wrap(ctx, song.title, tw).slice(0, 2)) {
    ctx.fillText(l, tx, y);
    y += 58;
  }
  // refrão
  const chorus = (song.sections || []).find((s) => /refr|resposta|ant[ií]fona/i.test(s.name) && s.lines.length) || (song.sections || []).find((s) => s.lines.length);
  if (chorus) {
    y += 12;
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = "italic 500 27px Georgia, 'Times New Roman', serif";
    let n = 0;
    for (const line of chorus.lines) {
      for (const l of wrap(ctx, line, tw)) {
        if (n++ >= 4) break;
        ctx.fillText(l, tx, y);
        y += 38;
      }
      if (n >= 4) break;
    }
  }
  // posição do equalizador e da barra
  const layout = V
    ? { wave: { x: 60, y: 1000, w: 600, h: 120 }, bar: { x: 60, y: 1150, w: 600, h: 8 } }
    : { wave: { x: 540, y: 520, w: 670, h: 96 }, bar: { x: 540, y: 640, w: 670, h: 8 } };
  // marca d'água ACAIAMUSIC
  ctx.textAlign = "left";
  if (logo) ctx.drawImage(logo, 36, 34, 46, 46);
  ctx.fillStyle = "#fff";
  ctx.font = "900 26px Segoe UI, Inter, Arial, sans-serif";
  ctx.fillText("ACAIA", 92, 66);
  const aw = ctx.measureText("ACAIA").width;
  const gr = ctx.createLinearGradient(92 + aw, 0, 92 + aw + 100, 0);
  gr.addColorStop(0, "#c084fc");
  gr.addColorStop(1, "#f472b6");
  ctx.fillStyle = gr;
  ctx.fillText("MUSIC", 92 + aw, 66);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#fff";
  ctx.font = "700 18px Consolas, ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("ACAIAMUSIC · sua fé em forma de canção", V ? W / 2 : 540 + 335, H - (V ? 60 : 40));
  ctx.restore();
  // marca d'água discreta na diagonal
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 7);
  ctx.fillStyle = "#fff";
  ctx.font = `900 ${V ? 120 : 140}px Segoe UI, Inter, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("ACAIAMUSIC", 0, 0);
  ctx.restore();
  return layout;
}
// Cria a capa ilustrada (a IA descreve o tema da letra e a GPU desenha); a 1ª vez leva até 2 min
async function makeIllustration(song, novo = false) {
  const msg = $("#video-art-msg"), btn = $("#video-art");
  if (btn.disabled) return;
  btn.disabled = true;
  const t0 = Date.now();
  const tick = () => (msg.textContent = `🎨 criando a imagem do tema… ${Math.round((Date.now() - t0) / 1000)}s (até 1 min)`);
  tick();
  const clock = setInterval(tick, 1000);
  try {
    const ill = await api(`/api/songs/${song.id}/illustration`, { method: "POST", body: JSON.stringify({ novo }) });
    song.illustration = ill;
    const k = state.songs.findIndex((s) => s.id === song.id);
    if (k >= 0) state.songs[k].illustration = ill;
    msg.textContent = "✓ pronta";
    if (dlgSong?.id === song.id) {
      drawVideoPreview();
      $("#dlg-cover").outerHTML = coverHtml(song, "lg", 'id="dlg-cover"'); // a capa da janela também muda
    }
    if (novo) toast("🎨 Nova capa pronta!");
  } catch (e) {
    msg.textContent = "";
    toast(/já está sendo criada/.test(e.message) ? "A capa desta música já está sendo criada. Espere alguns segundos e veja de novo." : e.message, true, 7000);
  } finally {
    clearInterval(clock);
    btn.disabled = false;
  }
}
$("#video-art").onclick = () => dlgSong && makeIllustration(dlgSong, true);

async function drawVideoPreview() {
  if (!dlgSong) return;
  const c = $("#video-canvas");
  const layout = await drawVideoArt(c, dlgSong, videoFormat);
  // prévia do equalizador
  const ctx = c.getContext("2d");
  const { wave, bar } = layout;
  const n = 48, bw = wave.w / n;
  const r = rng(dlgSong.cover || 3);
  for (let i = 0; i < n; i++) {
    const h = (0.15 + r() * 0.85) * (wave.h / 2) * (1 - (i / n) * 0.6);
    ctx.fillStyle = "#f472b6";
    ctx.fillRect(wave.x + i * bw + 1, wave.y + wave.h / 2 - h, bw - 2, h);
    ctx.fillStyle = "rgba(244,114,182,0.3)";
    ctx.fillRect(wave.x + i * bw + 1, wave.y + wave.h / 2, bw - 2, h);
  }
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
  ctx.fillStyle = "#ec4899";
  ctx.fillRect(bar.x, bar.y, bar.w * 0.35, bar.h);
  $(".video-preview").style.maxWidth = videoFormat === "vertical" ? "260px" : "100%";
}
$("#btn-video").onclick = async (e) => {
  const song = dlgSong;
  const btn = e.currentTarget;
  btn.disabled = true;
  $("#video-progress").classList.remove("hidden");
  $("#video-actions").classList.add("hidden");
  $("#video-msg").textContent = "Desenhando a arte…";
  $("#video-bar").style.width = "5%";
  try {
    const canvas = document.createElement("canvas");
    const layout = await drawVideoArt(canvas, song, videoFormat);
    const { jobId } = await api(`/api/songs/${song.id}/video`, {
      method: "POST",
      body: JSON.stringify({ image: canvas.toDataURL("image/png"), format: videoFormat, start: Number($("#video-start").value), layout }),
    });
    const t0 = Date.now();
    for (;;) {
      await sleep(1500);
      const job = await api(`/api/jobs/${jobId}`);
      if (job.status === "error" || job.status === "canceled") throw new Error(job.error || "Música cancelada.");
      $("#video-msg").textContent = `${job.message} · ${fmt((Date.now() - t0) / 1000)}`;
      $("#video-bar").style.width = (job.status === "done" ? 100 : job.progress != null ? 8 + job.progress * 0.9 : Math.min(30, 5 + (Date.now() - t0) / 4000)) + "%";
      if (job.status === "done") {
        song.lastVideo = job.url;
        if (dlgSong?.id === song.id) {
          const v = $("#video-out");
          v.src = job.url;
          v.classList.remove("hidden");
          $("#video-canvas").classList.add("hidden");
          $("#dl-video").href = job.url;
          $("#dl-video").download = `${safeName(song.title)} (status).mp4`;
          $("#video-actions").classList.remove("hidden");
        }
        toast("🎬 Vídeo pronto!");
        break;
      }
    }
  } catch (err) {
    toast(err.message, true, 8000);
  } finally {
    btn.disabled = false;
    $("#video-progress").classList.add("hidden");
  }
};
const shareVideo = () => {
  if (!dlgSong.lastVideo) {
    selectTab("video");
    return toast("Crie o vídeo primeiro (aba Vídeo Status).");
  }
  shareFile(dlgSong.lastVideo, `${safeName(dlgSong.title)}.mp4`, "video/mp4", `🎵 *${dlgSong.title}*\nCriado no ACAIAMUSIC`);
};
$("#wa-video").onclick = shareVideo;

// ---------------- Aba WhatsApp ----------------
$("#sh-audio").onclick = () => shareFile(dlgSong.url, `${safeName(dlgSong.title)}.mp3`, "audio/mpeg", lyricsText(dlgSong));
$("#sh-lyrics").onclick = () => shareText(lyricsText(dlgSong));
$("#sh-chords").onclick = () => {
  if (!dlgSong.chords) {
    selectTab("cifra");
    return toast("Gere a cifra primeiro (aba Cifra).");
  }
  shareText(chordsText(dlgSong));
};
$("#sh-instrumental").onclick = () => {
  if (!dlgSong.stems) {
    selectTab("faixas");
    return toast("Separe as faixas primeiro (aba Faixas).");
  }
  $("#wa-instrumental").onclick();
};
$("#sh-video").onclick = shareVideo;

// =========================================================
// PLAYER (transporte)
// =========================================================
const audio = $("#audio");
let audioRetries = 0;
audio.addEventListener("loadeddata", () => (audioRetries = 0));
audio.addEventListener("error", () => {
  if (!state.current || !audio.src) return;
  if (audioRetries >= 3) return toast("Não consegui tocar esta música agora. Verifique a internet e toque de novo.", true);
  audioRetries++;
  toast(`O áudio não carregou, tentando de novo (${audioRetries}/3)…`, false, 2500);
  const at = audio.currentTime || 0;
  setTimeout(() => {
    const base = audio.src.replace(/([?&])retry=d+&?/, "$1").replace(/[?&]$/, "");
    audio.src = base + (base.includes("?") ? "&" : "?") + "retry=" + Date.now();
    audio.addEventListener("loadedmetadata", () => { try { audio.currentTime = at; } catch {} }, { once: true });
    audio.play().catch(() => {});
  }, 2500 * audioRetries);
});
$("#btn-play").innerHTML = PLAY_SVG;
function play(song) {
  stopMixer(false);
  state.current = song;
  document.body.classList.add("has-player");
  audio.src = song.url;
  audio.play().catch(() => {});
  $("#player").classList.remove("hidden");
  $("#player-title").textContent = song.title;
  const o = song.options || {};
  $("#player-sub").textContent = o.mode === "catolica" ? `⛪ ${o.moment}` : [song.genre, song.voice].filter(Boolean).join(" · ");
  $("#player-cover").outerHTML = coverHtml(song, "xs", 'id="player-cover"');
  syncFavUI(song);
  startViz();
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: "AcaiaMusic", artwork: song.illustration?.url ? [{ src: song.illustration.url, sizes: "1024x1024", type: "image/jpeg" }] : [{ src: "/icon-512.png", sizes: "512x512" }] });
  }
}
let viz = null;
function startViz() {
  try {
    if (!viz) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      ctx.createMediaElementSource(audio).connect(analyser);
      analyser.connect(ctx.destination);
      viz = { ctx, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
      const cv = $("#viz");
      const g = cv.getContext("2d");
      const grad = g.createLinearGradient(0, 0, cv.width, 0);
      grad.addColorStop(0, "#a855f7");
      grad.addColorStop(0.6, "#ec4899");
      grad.addColorStop(1, "#ffb547");
      const draw = () => {
        requestAnimationFrame(draw);
        g.clearRect(0, 0, cv.width, cv.height);
        viz.analyser.getByteFrequencyData(viz.data);
        const n = 24, w = cv.width / n;
        g.fillStyle = grad;
        for (let i = 0; i < n; i++) {
          const v = audio.paused ? 0.06 : Math.max(0.06, viz.data[i + 1] / 255);
          const h = v * cv.height;
          g.beginPath();
          g.roundRect(i * w + 1.5, (cv.height - h) / 2, w - 3, h, 2);
          g.fill();
        }
      };
      draw();
    }
    if (viz.ctx.state === "suspended") viz.ctx.resume();
  } catch {}
}
function togglePlay() {
  if (!state.current) return;
  startViz();
  if (audio.paused) {
    stopMixer(false);
    audio.play();
  } else audio.pause();
}
function step(dir) {
  if (!state.current || !state.songs.length) return;
  const i = state.songs.findIndex((s) => s.id === state.current.id);
  play(state.songs[(i + dir + state.songs.length) % state.songs.length]);
}
$("#btn-play").onclick = togglePlay;
$("#btn-next").onclick = () => step(1);
$("#btn-prev").onclick = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : step(-1));
$("#p-fav").onclick = () => state.current && toggleFav(state.songs.find((s) => s.id === state.current.id) || state.current);
$("#p-open").onclick = () => state.current && openSong(state.songs.find((s) => s.id === state.current.id) || state.current);
const syncPlay = () => {
  $("#btn-play").innerHTML = audio.paused ? PLAY_SVG : PAUSE_SVG;
  if ($("#view-library").classList.contains("active")) renderLibrary();
  if ($("#view-home").classList.contains("active")) renderHome();
};
audio.onplay = syncPlay;
audio.onpause = syncPlay;
audio.onended = () => (state.queue?.length ? play(state.queue.shift()) : step(1));
audio.onloadedmetadata = () => ($("#t-dur").textContent = fmt(audio.duration));
audio.ontimeupdate = () => {
  if (!audio.duration) return;
  $("#seek").value = (audio.currentTime / audio.duration) * 1000;
  $("#t-cur").textContent = fmt(audio.currentTime);
};
$("#seek").oninput = (e) => audio.duration && (audio.currentTime = (e.target.value / 1000) * audio.duration);
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable && state.current) {
    e.preventDefault();
    togglePlay();
  }
});

// =========================================================
// ETAPAS DO CONSOLE (uma por vez, com resumo e "alterar")
// =========================================================
let wzIndex = 0;
const LANG_LABEL = { pt: "Português", es: "Espanhol", en: "Inglês" };
const STEP_INFO = {
  Modo: ["O que vamos criar?", "Escolha entre um canto para a Santa Missa ou uma música livre."],
  Liturgia: ["Momento da celebração", "Em que parte da Missa o canto será cantado? Isso orienta a letra e o jeito da música."],
  Tema: ["Sobre o que é o canto?", "Descreva em poucas palavras. Se colou a leitura base, pode deixar em branco."],
  Estilo: ["Estilo e clima", "Como a música deve soar. Se quiser, envie um áudio de referência."],
  "Tempo e Tom": ["Andamento e tom", "Velocidade (BPM) e tonalidade. Pode deixar no automático."],
  Instrumentos: ["Instrumentos", "Escolha até 5 ou deixe a IA decidir."],
  Vocais: ["Vozes", "Quem canta e com qual timbre."],
  Saída: ["Últimos ajustes", "Idioma, duração e qualidade. Depois é só compor a letra."],
};
const stepEls = () => $$(".module[data-step]").filter((el) => !(el.id === "mod-liturgy" && state.mode !== "catolica"));
function stepSummary(name) {
  const reading = $("#reading").value.trim();
  const idea = $("#idea").value.trim();
  switch (name) {
    case "Modo":
      return state.mode === "catolica" ? "⛪ Litúrgico" : "🎵 Livre";
    case "Liturgia":
      return [state.moment, state.season, state.form, $("#occasion").value.trim(), reading && "leitura base ✓"].filter(Boolean).join(" · ");
    case "Tema":
      return idea || (reading ? "pela leitura base" : OFFICIAL.has(state.moment) && state.mode === "catolica" ? "texto oficial do Missal" : "—");
    case "Estilo":
      return [state.genre[0], ...state.moods.map((m) => m[0]), state.reference && `🎧 ${state.reference.name}`].filter(Boolean).join(" · ");
    case "Tempo e Tom":
      return `${state.bpm} BPM · ${keyLabel()}`;
    case "Instrumentos":
      return state.instruments.map((i) => i[0]).join(", ") || "automático";
    case "Vocais":
      return [state.voice[0], ...(state.voice[0] === "Instrumental" ? [] : state.voiceStyles.map((v) => v[0]))].join(" · ");
    case "Saída":
      return `${LANG_LABEL[$("#language").value]} · ${fmt(Number($("#duration").value))} · ${state.quality === "high" ? "alta qualidade" : "rápida"}`;
  }
  return "";
}
function renderWizard() {
  const steps = stepEls();
  wzIndex = Math.max(0, Math.min(wzIndex, steps.length - 1));
  $$(".module[data-step]").forEach((el) => el.classList.remove("current"));
  steps[wzIndex].classList.add("current");
  $("#wz-num").textContent = wzIndex + 1;
  $("#wz-total").textContent = steps.length;
  const name = steps[wzIndex].dataset.step;
  const [title, desc] = STEP_INFO[name] || [name, ""];
  const t = name === "Tema" && state.mode !== "catolica" ? "Sobre o que é a música?" : title;
  $("#step-title").textContent = t;
  $("#step-desc").textContent = desc;
  $("#deck-step").textContent = `Etapa ${wzIndex + 1} de ${steps.length}`;
  $("#deck-title").textContent = state.mode === "catolica" ? "Canto para a Missa" : "Música livre";
  $("#wz-bar").style.width = `${((wzIndex + 1) / steps.length) * 100}%`;
  $("#step-intro").style.animation = "none";
  void $("#step-intro").offsetWidth;
  $("#step-intro").style.animation = "";
  $("#wizard-steps").innerHTML = "";
  steps.forEach((el, i) => {
    const li = document.createElement("li");
    li.appendChild(
      button(i < wzIndex ? "done" : i === wzIndex ? "on" : "", `<i>${i < wzIndex ? "✓" : i + 1}</i><span>${esc(el.dataset.step)}</span>`, () => goStep(i)),
    );
    $("#wizard-steps").appendChild(li);
  });
  $(".wizard-steps .on")?.scrollIntoView({ block: "nearest", inline: "center" });
  const rows = steps
    .slice(0, wzIndex)
    .map((el, i) => `<div class="recap-row"><span>${esc(el.dataset.step)}</span><b title="${esc(stepSummary(el.dataset.step))}">${esc(stepSummary(el.dataset.step))}</b><button data-go="${i}">alterar</button></div>`);
  $("#recap").innerHTML = rows.join("");
  $("#recap").classList.toggle("hidden", !rows.length);
  $$("#recap [data-go]").forEach((b) => (b.onclick = () => goStep(Number(b.dataset.go))));
  const last = wzIndex === steps.length - 1;
  $("#wz-back").disabled = wzIndex === 0;
  $("#wz-next").classList.toggle("hidden", last);
  $("#btn-lyrics").classList.toggle("hidden", !last);
}
function goStep(i) {
  wzIndex = i;
  renderWizard();
  const top = $(".console").getBoundingClientRect().top;
  if (top < 0) $(".console").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#wz-next").onclick = () => goStep(wzIndex + 1);
$("#wz-back").onclick = () => goStep(wzIndex - 1);

// =========================================================
// SERVIDOR DE MÚSICA (Kaggle)
// =========================================================
async function refreshStatus() {
  try {
    const s = await api("/api/status");
    const led = $("#status");
    led.classList.remove("ok", "warn");
    const a = s.auto || {};
    $("#auto-card").classList.toggle("hidden", !a.available);
    $("#auto-user").textContent = a.user ? `conta ${a.user}` : "";
    $("#auto-phase").textContent = s.kaggle?.ok ? "🟢 Ligado e pronto para criar músicas." : a.running ? `⏳ ${a.phase || "Ligando…"}` : a.error ? `⚠️ ${a.error}` : "⚪ Desligado: liga sozinho quando você criar uma música.";
    $("#auto-start").disabled = Boolean(a.running || s.kaggle?.ok);
    for (const id of ["#kg-quota", "#home-quota"]) paintQuota($(id), a.quota, s.kaggle?.ok && s.kaggleCpu);
    clearTimeout(refreshStatus.t);
    if (a.running && $("#settings-dialog").open) refreshStatus.t = setTimeout(refreshStatus, 8000);
    const own = s.kaggle?.ok || s.modal?.ok;
    led.classList.add(own || s.music ? "ok" : "warn");
    led.title = s.kaggle?.ok ? "Estúdio Kaggle conectado" : s.modal?.ok ? "Estúdio Modal configurado" : s.music ? "Usando Hugging Face (limite diário)" : "Configure o servidor de música";
    const hs = $("#home-server .srv-line");
    hs.classList.remove("ok", "warn");
    hs.classList.add(own ? "ok" : "warn");
    $("b", hs).textContent = s.kaggle?.ok ? "Seu estúdio (Kaggle) conectado" : s.modal?.ok ? "Seu estúdio (Modal) pronto" : "Hugging Face (gratuito)";
    // botões Ligar / Desligar estúdio direto no cartão da tela inicial
    $("[data-studio-stop]").classList.toggle("hidden", !s.kaggle?.ok);
    $("[data-studio-start]").classList.toggle("hidden", Boolean(s.kaggle?.ok || !a.available));
    $("[data-studio-start]").disabled = Boolean(a.running);
    $("[data-studio-start]").textContent = a.running ? "⏳ Ligando…" : "⚡ Ligar estúdio";
    if (a.running) refreshStatus.t = setTimeout(refreshStatus, 8000);
    $("#home-server small").textContent = s.kaggle?.ok
      ? `${s.kaggleCpu ? "Modo processador (mais lento). " : ""}Sem limite diário. Desliga sozinho após 30 min sem uso, ou toque em Desligar.`
      : a.running
        ? a.phase || "Ligando o estúdio…"
      : s.modal?.ok
        ? "Liga sozinho quando você cria uma música, usando os créditos grátis do mês."
        : s.auto?.available
          ? "Seu estúdio grátis no Kaggle liga sozinho quando você cria uma música (10–15 min na primeira)."
          : "Tem limite diário de gerações. Para criar sem limite, ligue o seu estúdio grátis no Kaggle.";
    const box = $("#srv-status");
    box.classList.remove("ok", "warn");
    if (own) {
      box.classList.add("ok");
      $("span", box).textContent = s.kaggle?.ok
        ? `Conectado ao seu estúdio no Kaggle: sem limite diário 🎉${s.modal?.ok ? " · Modal de reserva" : ""}`
        : "Estúdio no Modal configurado: liga sozinho quando você cria uma música 🎉";
    } else {
      box.classList.add("warn");
      $("span", box).textContent =
        s.kaggle?.error && s.kaggle.error !== "não configurado"
          ? `Estúdio Kaggle offline (${s.kaggle.error}). Usando Hugging Face com limite diário.`
          : "Usando os servidores gratuitos do Hugging Face (com limite diário).";
    }
    return s;
  } catch {}
}
$("#btn-settings").onclick = async () => {
  $("#settings-dialog").showModal();
  try {
    const st = await api("/api/settings");
    $("#kg-url").value = st.kaggleUrl || "";
    $("#kg-key").value = st.keyMasked || ""; // já preenchida (mascarada); só troca se você digitar outra
    $("#kg-key-hint").textContent = st.hasKey ? "· salva ✓" : "";
    paintQuota($("#kg-quota"), st.quota, st.kaggleCpu);
  } catch {}
  refreshStatus();
};
$("#kg-save").onclick = async (e) => {
  const btn = e.currentTarget;
  if (!$("#kg-url").value.trim()) return $("#kg-url").focus();
  btn.disabled = true;
  btn.textContent = "Testando…";
  try {
    const typed = $("#kg-key").value.includes("•") ? "" : $("#kg-key").value; // mascarada = mantém a salva
    await api("/api/settings", { method: "POST", body: JSON.stringify({ kaggleUrl: $("#kg-url").value, kaggleKey: typed }) });
    toast("✅ Estúdio do Kaggle conectado! As próximas músicas serão criadas lá.", false, 6000);
    const st = await api("/api/settings").catch(() => ({}));
    $("#kg-key").value = st.keyMasked || "";
    $("#kg-key-hint").textContent = "· salva ✓";
  } catch (err) {
    toast(err.message, true, 7000);
  } finally {
    btn.disabled = false;
    btn.textContent = "Testar e conectar";
    refreshStatus();
  }
};
$("#kg-clear").onclick = async () => {
  await api("/api/settings", { method: "POST", body: JSON.stringify({ kaggleUrl: "" }) });
  $("#kg-url").value = "";
  $("#kg-key").value = "";
  $("#kg-key-hint").textContent = "";
  toast("Estúdio do Kaggle desconectado.");
  refreshStatus();
};
$("#auto-start").onclick = async () => {
  try {
    await api("/api/studio/start", { method: "POST" });
    toast("⏳ Ligando o estúdio no Kaggle (10–15 min). Pode ir escrevendo a letra!", false, 6000);
  } catch (err) {
    toast(err.message, true, 7000);
  }
  setTimeout(refreshStatus, 1500);
};
async function stopStudioNow() {
  if (!confirm("Desligar o estúdio de música no Kaggle agora? Ele religa sozinho quando você criar outra música.")) return;
  try {
    await api("/api/studio/stop", { method: "POST" });
    toast("⏻ Estúdio desligado. Suas horas grátis ficam guardadas.", false, 4000);
  } catch (err) {
    toast(err.message, true);
  }
  refreshStatus();
}
async function startStudioNow() {
  try {
    await api("/api/studio/start", { method: "POST" });
    toast("⏳ Ligando o estúdio no Kaggle (uns 4 min). Pode ir escrevendo a letra!", false, 6000);
  } catch (err) {
    toast(err.message, true, 7000);
  }
  setTimeout(refreshStatus, 1500);
}
// ---- Quanto tempo de GPU ainda resta no Kaggle (semana) ----
function paintQuota(el, q, cpuMode) {
  if (!el) return;
  el.classList.toggle("hidden", !q);
  if (!q) return;
  const h = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const pct = Math.max(0, Math.min(100, (q.remaining / (q.total || 30)) * 100));
  const renew = new Date(q.refreshAt).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  el.innerHTML = `
    <div class="q-head"><b>⏱ ${h(q.remaining)} h</b> de GPU restantes <span>de ${h(q.total)} h · renova ${esc(renew)}</span></div>
    <div class="q-bar"><i style="width:${pct}%"></i></div>
    ${cpuMode ? `<small>No modo processador o estúdio <b>não gasta</b> essas horas.</small>` : ""}`;
  el.classList.toggle("low", q.remaining < 5);
}

// ---- Fechar o player ----
function closePlayer() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  state.queue = [];
  state.current = null;
  $("#player").classList.add("hidden");
  document.body.classList.remove("has-player");
}
$("#p-close").onclick = closePlayer;

// ---- Fila de criação em segundo plano ----
let lastPending = 0;
async function refreshQueue() {
  clearTimeout(refreshQueue.t);
  try {
    const q = await api("/api/queue");
    renderQueue(q);
    if (q.pending < lastPending) {
      await Promise.all([loadSongs(), loadSetlists()]); // música nova pronta: atualiza a biblioteca e o repertório
      if ($("#view-library").classList.contains("active")) renderLibrary();
      if ($("#view-home").classList.contains("active")) renderHome();
    }
    lastPending = q.pending;
    refreshQueue.t = setTimeout(refreshQueue, $("#queue-dialog").open ? 2000 : q.pending ? 5000 : 30000);
  } catch {
    refreshQueue.t = setTimeout(refreshQueue, 30000);
  }
}
// Etapas da criação de uma música (vêm do status do trabalho no servidor)
const Q_STAGES = [
  { keys: ["waiting", "connecting"], label: "Ligando o estúdio" },
  { keys: ["queued"], label: "Na fila do estúdio" },
  { keys: ["generating"], label: "Compondo e gravando" },
  { keys: ["saving"], label: "Salvando" },
];
const qStage = (status) => Math.max(0, Q_STAGES.findIndex((s) => s.keys.includes(status)));
const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
function stagesHtml(it) {
  const cur = qStage(it.status);
  return `<ol class="qd-steps">${Q_STAGES.map(
    (s, k) => `<li class="${k < cur ? "ok" : k === cur ? "now" : ""}"><i>${k < cur ? "✓" : k + 1}</i><span>${s.label}${k === cur && it.stageAt ? ` · ${mmss(Date.now() - it.stageAt)}` : ""}</span></li>`,
  ).join("")}</ol>`;
}
const Q_ICON = { done: "✅", error: "⚠️", canceled: "🚫" };
const Q_WORD = { done: "Pronta", error: "Não deu certo", canceled: "Cancelada" };
// "Título (refazendo com revisão de pronúncia)" -> título + etiqueta curta
const qLabel = (l) => {
  const m = /^(.*) \((refazendo[^)]*)\)$/.exec(String(l || ""));
  return `<span class="qd-t">${esc(m ? m[1] : l)}</span>${m ? `<span class="qd-tag" title="${esc(m[2])}">🎯 refazendo</span>` : ""}`;
};
function renderQueue(q) {
  $("#lib-queue-n").textContent = q.pending || "";
  const pill = $("#queue-pill");
  pill.classList.toggle("hidden", !q.pending);
  pill.classList.toggle("paused", Boolean(q.paused));
  if (q.pending) {
    $("#queue-text").textContent = q.paused
      ? `⏸ Fila pausada · ${q.pending} música${q.pending > 1 ? "s" : ""}${q.current ? " (terminando a atual)" : ""}`
      : (() => {
          const run = q.items?.find((i) => i.running);
          const st = run ? `${Q_STAGES[qStage(run.status)].label}${run.stageAt ? " " + mmss(Date.now() - run.stageAt) : ""}` : "";
          return `🎵 ${q.pending > 1 ? `${q.pending} músicas · ` : ""}${st || "Na fila"}${q.current ? ` · ${q.current.label}` : ""}`;
        })();
    pill.title = `${q.current?.message || "Na fila"}\nToque para pausar, cancelar ou ver a fila.`;
  }
  const pb = $("#qd-pause");
  pb.textContent = q.paused ? "▶️ Retomar a fila" : "⏸ Pausar a fila";
  pb.dataset.paused = q.paused ? "1" : "";
  pb.classList.toggle("hidden", !q.pending && !q.paused);
  $("#qd-list").innerHTML = q.items?.length
    ? q.items
        .map((it, k) => {
          const wait = it.retryAt ? ` · nova tentativa às ${new Date(it.retryAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "";
          const tries = it.tries > 1 || it.retryAt ? ` · tentativa ${Math.min(it.tries + (it.running ? 0 : 1), it.maxTries)} de ${it.maxTries}` : "";
          return `<li class="${it.running ? "run" : ""}" data-id="${esc(it.id)}">
            <span>${it.running ? "🎙️" : k + 1 + "."}</span>
            <div class="qd-info"><b>${qLabel(it.label)}</b>${it.running ? stagesHtml(it) : ""}<small>${esc(it.message)}${esc(wait)}${esc(tries)}${it.running && it.startedAt ? esc(` · total ${mmss(Date.now() - it.startedAt)}`) : ""}</small></div>
            <div class="qd-act">
              ${!it.running && (it.retryAt || k > 0) ? `<button class="btn ghost" data-q="now" title="Passar para a frente e tentar já">Agora</button>` : ""}
              ${!it.running && k > 0 && !q.items[k - 1].running ? `<button class="btn ghost" data-q="up" aria-label="Subir na fila" title="Subir">↑</button>` : ""}
              ${!it.running && k < q.items.length - 1 ? `<button class="btn ghost" data-q="down" aria-label="Descer na fila" title="Descer">↓</button>` : ""}
              ${!it.running ? `<button class="btn ghost" data-q="edit" title="Mudar título e letra antes de gravar">✎ Editar</button>` : ""}
              <button class="btn ghost danger" data-q="cancel">Cancelar</button>
            </div></li>`;
        })
        .join("")
    : `<li class="qd-empty">Nenhuma música na fila agora.</li>`;
  const hist = q.history || [];
  $("#qd-hist-title").classList.toggle("hidden", !hist.length);
  $("#qd-hist").innerHTML = hist
    .map(
      (h) => `<li data-id="${esc(h.id)}"><span>${Q_ICON[h.status] || "•"}</span><div class="qd-info"><b>${esc(h.label)}</b><small>${Q_WORD[h.status] || h.status} · ${new Date(h.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${h.error ? " · " + esc(h.error) : ""}</small></div><div class="qd-act">${
        h.songId ? `<button class="btn ghost" data-open="${esc(h.songId)}">Ouvir</button>` : ""
      }${h.retry ? `<button class="btn ghost" data-h="retry" title="Pôr de volta na fila">↻ Tentar de novo</button>` : ""}<button class="btn ghost" data-h="del" aria-label="Tirar do histórico" title="Tirar do histórico">✕</button></div></li>`,
    )
    .join("");
}
async function openQueue() {
  $("#queue-dialog").showModal();
  refreshQueue();
}
$("#queue-pill").onclick = openQueue;
$("#lib-queue").onclick = openQueue;
$("#qd-studio").onclick = () => ($("#queue-dialog").close(), showView("create"));
$("#qd-clear").onclick = async () => {
  try {
    renderQueue(await api("/api/queue/history", { method: "DELETE" }));
  } catch (err) {
    toast(err.message, true);
  }
};
// Editar um pedido da fila (título e letra) antes de ser gravado
let qeId = null;
async function openQueueEdit(id) {
  try {
    const it = await api(`/api/queue/${encodeURIComponent(id)}`);
    if (it.running) return toast("Esta música já está sendo gravada.", true);
    qeId = id;
    $("#qe-title").value = it.title;
    $("#qe-text").value = it.text;
    $("#qedit-dialog").showModal();
    $("#qe-text").scrollTop = 0;
  } catch (err) {
    toast(err.message, true);
  }
}
$("#qe-save").onclick = async () => {
  const sections = textToSections($("#qe-text").value);
  if (!sections.length) return toast("A letra está vazia.", true);
  try {
    renderQueue(await api(`/api/queue/${encodeURIComponent(qeId)}`, { method: "PATCH", body: JSON.stringify({ title: $("#qe-title").value.trim(), sections }) }));
    $("#qedit-dialog").close();
    toast("Pedido atualizado na fila ✓", false, 2000);
  } catch (err) {
    toast(err.message, true);
  }
};
$("#qe-cancel").onclick = async () => {
  if (!confirm(`Cancelar "${$("#qe-title").value}"?`)) return;
  try {
    renderQueue(await api(`/api/queue/${encodeURIComponent(qeId)}/cancel`, { method: "POST" }));
    $("#qedit-dialog").close();
    toast("🚫 Música cancelada.");
  } catch (err) {
    toast(err.message, true);
  }
};
$("#qd-pause").onclick = async (e) => {
  const resume = Boolean(e.currentTarget.dataset.paused);
  try {
    renderQueue(await api("/api/queue/pause", { method: "POST", body: JSON.stringify({ paused: !resume }) }));
    toast(resume ? "▶️ Fila retomada." : "⏸ Fila pausada. A música que já está sendo gravada termina; as próximas esperam.");
  } catch (err) {
    toast(err.message, true);
  }
};
$("#queue-dialog").addEventListener("click", async (e) => {
  const open = e.target.closest("[data-open]");
  if (open) {
    const song = state.songs.find((s) => s.id === open.dataset.open);
    if (song) ($("#queue-dialog").close(), play(song), openSong(song));
    return;
  }
  const hb = e.target.closest("[data-h]");
  if (hb) {
    const hid = hb.closest("li").dataset.id;
    const retry = hb.dataset.h === "retry";
    hb.disabled = true;
    try {
      renderQueue(await api(`/api/queue/history/${encodeURIComponent(hid)}${retry ? "/retry" : ""}`, { method: retry ? "POST" : "DELETE" }));
      if (retry) (toast("↻ De volta na fila."), refreshQueue());
    } catch (err) {
      toast(err.message, true);
      hb.disabled = false;
    }
    return;
  }
  const b = e.target.closest("[data-q]");
  if (!b) return;
  const li = b.closest("li");
  const id = li.dataset.id;
  if (b.dataset.q === "edit") return openQueueEdit(id);
  if (b.dataset.q === "up" || b.dataset.q === "down") {
    b.disabled = true;
    try {
      renderQueue(await api(`/api/queue/${encodeURIComponent(id)}/move`, { method: "POST", body: JSON.stringify({ dir: b.dataset.q === "up" ? -1 : 1 }) }));
    } catch (err) {
      toast(err.message, true);
      b.disabled = false;
    }
    return;
  }
  if (b.dataset.q === "cancel" && !confirm(`Cancelar "${li.querySelector("b").textContent}"?`)) return;
  b.disabled = true;
  try {
    renderQueue(await api(`/api/queue/${encodeURIComponent(id)}/${b.dataset.q}`, { method: "POST" }));
    toast(b.dataset.q === "cancel" ? "🚫 Música cancelada." : "⏩ Vai ser a próxima.");
  } catch (err) {
    toast(err.message, true);
    b.disabled = false;
  }
});
refreshQueue();

$("#auto-stop").onclick = stopStudioNow;
$("[data-studio-stop]").onclick = stopStudioNow;
$("[data-studio-start]").onclick = startStudioNow;

// =========================================================
// LITURGIA DO DIA (Canção Nova) · Leitura base e Missa pronta
// =========================================================
const LIT_COLORS = { roxo: "#7c3aed", verde: "#16a34a", branco: "#f5f5f4", vermelho: "#dc2626", rosa: "#f472b6", azul: "#60a5fa", dourado: "#fbbf24", preto: "#52525b" };
const litColor = (c = "") => LIT_COLORS[Object.keys(LIT_COLORS).find((k) => c.toLowerCase().includes(k))] || "#a855f7";
const isoLocal = (d) => d.toLocaleDateString("sv-SE");
const nextSunday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return isoLocal(d);
};
const litCache = {};
const getLit = (iso) => (litCache[iso] ||= api(`/api/liturgy?date=${iso}`).catch((e) => (delete litCache[iso], Promise.reject(e))));
const brDate = (iso) => new Date(iso + "T12:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

// ---- Leitura base: um toque para trazer a leitura do dia ----
async function loadReadingChips(iso) {
  const box = $("#lf-chips");
  box.innerHTML = `<small class="muted">Buscando a liturgia de ${esc(brDate(iso))}…</small>`;
  try {
    const L = await getLit(iso);
    const R = L.readings || {};
    const parts = [
      R.first && ["1ª Leitura", R.first.ref, `${R.first.ref} — ${R.first.text}`],
      R.psalm && ["Salmo", R.psalm.ref.split(",")[0], `${R.psalm.ref}\nRefrão: ${R.psalm.refrain}\n${R.psalm.text}`],
      R.second && ["2ª Leitura", R.second.ref, `${R.second.ref} — ${R.second.text}`],
      R.acclamation && ["Aclamação", "versículo do dia", R.acclamation],
      R.gospel && ["Evangelho", R.gospel.ref, `${R.gospel.ref} — ${R.gospel.text}`],
    ].filter(Boolean);
    if (!parts.length) throw new Error("sem leituras");
    box.innerHTML =
      `<span class="lf-day"><i style="background:${litColor(L.color)}"></i>${esc(L.title || brDate(iso))}${L.color ? " · " + esc(L.color) : ""}</span>` +
      parts.map(([n, ref], i) => `<button type="button" data-i="${i}"><b>${esc(n)}</b><small>${esc(ref)}</small></button>`).join("");
    $$("button", box).forEach((b) =>
      b.addEventListener("click", () => {
        $("#reading").value = parts[b.dataset.i][2].slice(0, 4000);
        $$("button", box).forEach((x) => x.classList.toggle("on", x === b));
        const opt = [...$("#season").options].find((o) => o.value === L.season || o.text === L.season);
        if (opt && $("#season").value !== opt.value) {
          $("#season").value = opt.value;
          $("#season").dispatchEvent(new Event("change"));
        }
        toast(`📖 ${parts[b.dataset.i][0]} de ${brDate(iso)} na leitura base`, false, 2500);
      }),
    );
  } catch {
    box.innerHTML = `<small class="muted">Não encontrei a liturgia desse dia na Canção Nova (o site traz o mês atual). Tente outra data.</small>`;
  }
}
$("#lf-date").value = isoLocal(new Date());
$("#lf-date").addEventListener("change", () => $("#lf-date").value && loadReadingChips($("#lf-date").value));
let lfLoaded = false;
$("#reading").addEventListener("focus", () => lfLoaded || ((lfLoaded = true), loadReadingChips($("#lf-date").value)));

// ---- Missa pronta do dia ----
let mdDate = isoLocal(new Date());
async function paintMassCard() {
  try {
    const L = await getLit(isoLocal(new Date()));
    $("#mass-open").style.setProperty("--lc", litColor(L.color));
    $("#mass-open").title = L.color ? `Cor litúrgica de hoje: ${L.color}` : "";
    $("#mr-tag").textContent = L.color ? `✨ ${L.color}` : "✨ Hoje";
    $("#mr-title").textContent = (L.title || "Liturgia do dia").replace(/\s*[-–]\s*(Memória|Festa|Solenidade)$/i, " · $1");
    $("#mr-sub").textContent = `${L.readings?.gospel ? `Evangelho ${L.readings.gospel.ref}. ` : ""}A IA compõe todos os cantos com as leituras de hoje.`;
  } catch {}
}
async function paintMassDialog() {
  const box = $("#md-lit");
  box.innerHTML = `<p class="muted small">Carregando a liturgia de ${esc(brDate(mdDate))}…</p>`;
  $$("#md-dates button").forEach((b) => b.classList.toggle("on", b.dataset.d === mdDate));
  try {
    const L = await getLit(mdDate);
    const R = L.readings || {};
    box.style.setProperty("--lc", litColor(L.color));
    $("#md-title").textContent = L.title || "Missa do dia";
    box.innerHTML = `
      <h4>${esc(brDate(L.date))}</h4>
      <div class="tags">${[L.season, L.color && "Cor: " + L.color, L.source].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
      ${R.psalm ? `<q>“${esc(R.psalm.refrain)}”</q>` : ""}
      <dl>
        ${R.first ? `<dt>1ª Leitura</dt><dd>${esc(R.first.ref)}</dd>` : ""}
        ${R.psalm ? `<dt>Salmo</dt><dd>${esc(R.psalm.ref)}</dd>` : ""}
        ${R.second ? `<dt>2ª Leitura</dt><dd>${esc(R.second.ref)}</dd>` : ""}
        ${R.gospel ? `<dt>Evangelho</dt><dd>${esc(R.gospel.ref)}</dd>` : ""}
      </dl>`;
  } catch {
    box.innerHTML = `<p class="muted small">Não consegui carregar a liturgia agora. Confira a internet e tente de novo.</p>`;
  }
}
$("#md-genre").innerHTML = GENRES["Católica"].map(([n], i) => `<option value="${i}">${esc(n)}</option>`).join("");
$("#md-voice").innerHTML = VOICE_TYPES.filter(([n]) => n !== "Instrumental").map(([n], i) => `<option value="${i}">${esc(n)}</option>`).join("");
$("#mass-open").onclick = () => {
  const dates = [[isoLocal(new Date()), "Hoje"], [nextSunday(), "Próximo domingo"]];
  $("#md-dates").innerHTML = dates.map(([d, l]) => `<button type="button" data-d="${d}">${l}</button>`).join("") + `<input type="date" id="md-date" aria-label="Outra data" />`;
  $$("#md-dates button").forEach((b) => (b.onclick = () => ((mdDate = b.dataset.d), paintMassDialog())));
  $("#md-date").onchange = (e) => e.target.value && ((mdDate = e.target.value), paintMassDialog());
  $("#md-setup").classList.remove("hidden");
  $("#md-run").classList.add("hidden");
  $("#mass-dialog").showModal();
  paintMassDialog();
};
$("#md-go").onclick = async () => {
  const [gName, gTags] = GENRES["Católica"][$("#md-genre").value];
  const [vName, vTags] = VOICE_TYPES.filter(([n]) => n !== "Instrumental")[$("#md-voice").value];
  const withMusic = $("#md-music").checked;
  $("#md-setup").classList.add("hidden");
  $("#md-run").classList.remove("hidden");
  $("#md-done").classList.add("hidden");
  $("#md-bar").style.width = "3%";
  try {
    const { jobId } = await api("/api/mass-ready", { method: "POST", body: JSON.stringify({ date: mdDate, genre: gName, genreTags: gTags, voice: vName, voiceTags: vTags, withMusic, duration: 120 }) });
    for (;;) {
      await sleep(2500);
      const j = await api(`/api/jobs/${jobId}`);
      $("#md-msg").textContent = j.status === "error" ? `⚠️ ${j.error}` : j.message;
      $("#md-bar").style.width = Math.max(3, Math.round(((j.step || 0) / (j.total || 1)) * 100)) + "%";
      $("#md-steps").innerHTML = (j.items || [])
        .map((it) => `<li class="${it.kind}"><i>${it.error ? "⚠️" : it.kind === "song" ? "🎵" : "📝"}</i>${esc(it.moment)}<small>${esc(it.error || it.title)}</small></li>`)
        .join("");
      if (j.status === "error" || j.status === "canceled") throw new Error(j.error || "Música cancelada.");
      if (j.status === "done") {
        $("#md-bar").style.width = "100%";
        $("#md-done").classList.remove("hidden");
        $("#md-see").onclick = async () => {
          $("#mass-dialog").close();
          await Promise.all([loadSetlists(), loadLyricsLib(), loadSongs()]);
          showView("setlists");
          const sl = state.setlists.find((s) => s.id === j.setlistId);
          if (sl) openSetlist(sl);
        };
        toast("✨ Sua Missa está pronta!", false, 5000);
        break;
      }
    }
  } catch (err) {
    toast(err.message, true, 8000);
  }
};
paintMassCard();

// =========================================================
// INÍCIO
// =========================================================
multiChips($("#inst-chips"), INSTRUMENTS, "instruments", 5, () => sumList("#sum-inst", state.instruments, "automático"));
multiChips($("#voice-style"), VOICE_STYLES, "voiceStyles", 2, syncVoice);
$("#season").dispatchEvent(new Event("change"));
applyMode();
renderWizard();
syncVoice();
(async () => {
  refreshStatus();
  loadLyricsLib();
  loadSetlists();
  await loadSongs();
  if (location.hash === "#biblioteca") showView("library");
  else if (location.hash === "#estudio") showView("create");
  else renderHome();
})();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
