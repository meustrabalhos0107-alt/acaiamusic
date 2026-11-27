// Estilos (batidas) do teclado Yamaha PSR-E343 / YPT-340, com a numeração do próprio teclado.
// Fonte: Manual do Proprietário PSR-E343/YPT-340, "Style List" (pág. 60): 136 estilos.
// A música é criada com a batida do estilo escolhido e o app mostra o número para tocar junto.

export const KEYBOARD_MODEL = "Yamaha PSR-E343";

const LIST = `8BEAT|1 BritPopRock|2 8BeatModern|3 Cool8Beat|4 60sGtrPop|5 8BeatAdria|6 60s8Beat|7 8Beat|8 OffBeat|9 60sRock|10 HardRock|11 RockShuffle|12 8BeatRock
16BEAT|13 16Beat|14 PopShuffle|15 GuitarPop|16 16BtUptempo|17 KoolShuffle|18 HipHopLight
BALLAD|19 70sGlamPiano|20 PianoBallad|21 LoveSong|22 6/8ModernEP|23 6/8SlowRock|24 OrganBallad|25 PopBallad|26 16BeatBallad
DANCE|27 ClubBeat|28 Electronica|29 FunkyHouse|30 MellowHipHop|31 Chillout|32 EuroTrance|33 Ibiza|34 SwingHouse|35 Clubdance|36 ClubLatin|37 Garage1|38 Garage2|39 TechnoParty|40 UKPop|41 HipHopGroove|42 HipShuffle|43 HipHopPop
DISCO|44 ModernDisco|45 70sDisco|46 LatinDisco|47 SaturdayNight|48 DiscoHands
SWING&JAZZ|49 BigBandFast|50 BigBandBallad|51 AcousticJazz|52 AcidJazz|53 JazzClub|54 Swing1|55 Swing2|56 Five/Four|57 Dixieland|58 Ragtime
R&B|59 BluesRock|60 Soul|61 DetroitPop|62 60sRock&Roll|63 6/8Soul|64 CrocoTwist|65 Rock&Roll|66 ComboBoogie|67 6/8Blues
COUNTRY|68 CountryPop|69 CountrySwing|70 Country2/4|71 Bluegrass
LATIN|72 BrazilianSamba|73 BossaNova|74 Forro|75 Sertanejo|76 Tijuana|77 Joropo|78 Parranda|79 Reggaeton|80 Mambo|81 Salsa|82 Beguine|83 Reggae
BALLROOM|84 VienneseWaltz|85 EnglishWaltz|86 Slowfox|87 Foxtrot|88 Quickstep|89 Tango|90 Pasodoble|91 Samba|92 ChaChaCha|93 Rumba|94 Jive
TRAD&WORLD|95 USMarch|96 6/8March|97 GermanMarch|98 PolkaPop|99 OberPolka|100 Tarantella|101 Showtune|102 ChristmasSwing|103 ChristmasWaltz|104 ScottishReel|105 Duranguense|106 CumbiaGrupera|107 Yi Zu Min Ge|108 Jing Ju Jie Zou|109 Bhajan|110 BollyMix|111 IndianPop|112 Bhangra|113 Dandiya|114 ModernDangdut|115 Keroncong|116 Saeidy|117 WehdaSaghira|118 Iranian Elec|119 Emarati
WALTZ|120 SwingWaltz|121 JazzWaltz|122 CountryWaltz|123 OberWalzer|124 Musette
CHILDREN|125 Learning2/4|126 Learning4/4|127 Learning6/8
PIANIST|128 Stride|129 PianoSwing|130 PianoBoogie|131 Arpeggio|132 Habanera|133 SlowRock|134 8BeatPianoBallad|135 6/8PianoMarch|136 PianoWaltz`;

// Como cada categoria soa (para o gerador de música entender a batida)
const CAT_TAGS = {
  "8BEAT": "straight 8-beat drum groove, 4/4",
  "16BEAT": "16-beat groove with busy hi-hats, 4/4",
  BALLAD: "slow ballad groove, soft drums",
  DANCE: "electronic dance beat, four-on-the-floor",
  DISCO: "disco groove, four-on-the-floor kick, offbeat hi-hats",
  "SWING&JAZZ": "swing feel, jazz rhythm section, walking bass",
  "R&B": "rhythm and blues groove",
  COUNTRY: "country groove, boom-chick bass",
  LATIN: "latin rhythm, percussion",
  BALLROOM: "ballroom dance rhythm",
  "TRAD&WORLD": "traditional folk rhythm",
  WALTZ: "waltz in 3/4 time",
  CHILDREN: "simple steady accompaniment",
  PIANIST: "solo piano accompaniment style, no drums",
};
// Batidas mais usadas, descritas uma a uma
const STYLE_TAGS = {
  1: "british pop rock 8-beat, driving guitars",
  2: "modern 8-beat pop groove, clean drums, electric piano and guitar",
  3: "cool laid-back 8-beat pop groove",
  4: "60s guitar pop 8-beat",
  7: "classic 8-beat pop rock groove",
  8: "offbeat pop groove, accent on the upbeats",
  10: "hard rock beat, distorted guitars",
  11: "rock shuffle, swung 8ths",
  12: "8-beat rock groove, rock drums and electric guitars",
  13: "16-beat pop groove, funky hi-hats",
  14: "pop shuffle, swung 16ths",
  15: "guitar pop 16-beat, strummed guitars",
  16: "uptempo 16-beat pop",
  19: "70s glam piano ballad",
  20: "piano ballad groove, gentle brushes, piano-led",
  21: "soft love song ballad groove",
  22: "6/8 modern ballad with electric piano, compound triple feel",
  23: "6/8 slow rock ballad, triplet feel, compound meter",
  24: "organ ballad, slow gospel-like groove with church organ",
  25: "pop ballad groove, soft kick and snare, warm pads",
  26: "16-beat ballad, gentle 16th hi-hats, slow tempo",
  31: "chillout groove, relaxed electronic",
  41: "hip hop groove",
  44: "modern disco groove",
  51: "acoustic jazz trio, brushes, upright bass",
  54: "swing feel, ride cymbal, walking bass",
  59: "blues rock shuffle",
  60: "soul groove, gospel soul feel, warm organ and bass",
  63: "6/8 soul, gospel triplet feel",
  65: "classic rock and roll",
  68: "country pop groove, acoustic guitars",
  70: "country two-step, 2/4 boom-chick",
  72: "brazilian samba rhythm, surdo, pandeiro and tamborim",
  73: "bossa nova rhythm, nylon guitar comping, soft brushed drums, rim clicks",
  74: "brazilian forró rhythm, zabumba, triangle and accordion",
  75: "brazilian sertanejo groove, acoustic guitar and accordion",
  79: "reggaeton dembow beat",
  81: "salsa rhythm, clave, congas and piano montuno",
  83: "reggae one-drop groove, offbeat skank guitar",
  84: "viennese waltz, fast 3/4",
  85: "english slow waltz, 3/4",
  89: "tango rhythm, staccato bandoneon",
  91: "ballroom samba rhythm",
  93: "rumba rhythm",
  95: "march in 2/4, snare drum rolls, brass",
  96: "6/8 march",
  98: "polka 2/4",
  103: "christmas waltz in 3/4, bells and strings",
  106: "cumbia rhythm, guacharaca",
  120: "swing waltz 3/4",
  122: "country waltz 3/4",
  131: "flowing piano arpeggios, no drums, gentle and sacred",
  133: "slow rock piano, 12/8 triplet feel",
  134: "8-beat piano ballad, piano-led with soft drums",
  135: "6/8 piano march",
  136: "piano waltz in 3/4, no drums",
};

export const KEYBOARD_STYLES = LIST.split("\n").flatMap((row) => {
  const [cat, ...items] = row.split("|");
  return items.map((it) => {
    const m = /^(\d+) (.+)$/.exec(it.trim());
    const n = Number(m[1]);
    return { n, name: m[2], cat, tags: STYLE_TAGS[n] ? `${STYLE_TAGS[n]}, ${CAT_TAGS[cat]}` : `${m[2].replace(/([a-z])([A-Z0-9])/g, "$1 $2")} rhythm, ${CAT_TAGS[cat]}` };
  });
});
export const styleByNum = (n) => KEYBOARD_STYLES.find((s) => s.n === Number(n)) || null;
export const styleLabel = (s) => (s ? `${String(s.n).padStart(3, "0")} ${s.name}` : "");

// Escolha automática: o estilo do teclado que mais combina com o gênero, o andamento e a forma
const RULES = [
  [/bossa/i, 73], [/forr[óo]|bai[ãa]o|xote/i, 74], [/sertanej|moda de viola|caipira/i, 75], [/samba|pagode/i, 72],
  [/reggaeton/i, 79], [/reggae/i, 83], [/salsa/i, 81], [/cumbia/i, 106], [/tango/i, 89], [/bolero|rumba/i, 93], [/cha.?cha/i, 92], [/mambo/i, 80],
  [/marcha|march/i, 95], [/polca|polka/i, 98], [/valsa|waltz/i, 136], [/country|bluegrass/i, 68],
  [/soul|gospel|black/i, 60], [/blues/i, 59], [/rock'?n'?roll|rock and roll/i, 65], [/hard rock|metal/i, 10], [/rock/i, 12],
  [/jazz/i, 51], [/swing/i, 54], [/disco/i, 44], [/house|edm|eletr[ôo]nic|electronic|dance/i, 28], [/hip.?hop|rap|trap/i, 41], [/lo.?fi|chill/i, 31],
  [/gregorian|canto gregoriano|chant|polifon|coral|choir|a cappella/i, 131],
  [/[óo]rg[ãa]o|organ|hino|hymn/i, 24],
  [/piano/i, 20], [/balada|ballad/i, 25],
  [/worship|louvor|adora[çc][ãa]o|pop cat[óo]lico|cat[óo]lica|lit[úu]rgic/i, 2], [/pop/i, 2], [/ac[úu]stic|acoustic|folk|viol[ãa]o/i, 15],
];
export function pickKeyboardStyle(o = {}) {
  if (o.keyboardStyle && styleByNum(o.keyboardStyle)) return styleByNum(o.keyboardStyle);
  const text = `${o.genre || ""} ${o.genreTags || ""}`;
  // compasso composto / ternário pedido na forma ou no clima
  if (/6\/8|12\/8|tern[áa]rio/i.test(`${o.form || ""} ${(o.moods || []).join(" ")}`)) return styleByNum(23);
  for (const [re, n] of RULES) if (re.test(text)) {
    // músicas lentas do grupo "pop/louvor" ficam na balada correspondente
    if (n === 2 && o.bpm && o.bpm < 80) return styleByNum(26);
    return styleByNum(n);
  }
  if (o.bpm && o.bpm < 80) return styleByNum(25);
  return styleByNum(7);
}
