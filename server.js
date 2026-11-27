import "dotenv/config";
import express from "express";
import compression from "compression";
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client, handle_file } from "@gradio/client";
import { LANG_NAMES, SUNG_LANGS, translateLyrics } from "./lyrics.js";
import { ARRANGEMENTS, OFFICIAL_TEXTS, LyricsError, buildTags, cleanOptions, cleanPlan, generateChords, ideaMusicTags, illustrationPrompt, refineLyrics, sanitizeChords, splitIdea, writeLyrics } from "./lyrics.js";
import { masterOrPlain } from "./audio.js";
import { chordSheetFromAudio, hearingUrl, illustrate, lyricScore, listen, lyricTimeline } from "./hearing.js";
import { createRegistro, registroPage } from "./registro.js";
import { createHash } from "node:crypto";
import { registerStudio } from "./studio.js";
import { initSettings, getSettings, saveSettings, kaggleHealth, kaggleConfigured, generateKaggle, modalConfigured, modalStatus, wakeModal } from "./kaggle.js";
import { initAuto, autoState, kaggleUser, kaggleQuota, startStudio, stopStudio, requestGpu } from "./kaggle-auto.js";
import { getLiturgy, massPlan } from "./liturgy.js";
import { initPersist } from "./persist.js";
import { youtubeReference } from "./youtube.js";
import { KEYBOARD_MODEL, pickKeyboardStyle } from "./keyboard.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(here, "data");
const SONGS_DIR = path.join(DATA_DIR, "songs");
const DB_FILE = path.join(DATA_DIR, "songs.json");
mkdirSync(SONGS_DIR, { recursive: true });
// Na nuvem: traz a biblioteca do repositório privado antes de tudo (ver persist.js)
const persist = initPersist(DATA_DIR);
if (persist.enabled) await persist.restore().catch((e) => console.error("Nuvem: não consegui restaurar:", e.message));
await initSettings(DATA_DIR);
initAuto(DATA_DIR);
// Conta do Kaggle logada neste PC? Então o app consegue ligar o estúdio sozinho.
let KAGGLE_USER = null;
kaggleUser().then((u) => {
  KAGGLE_USER = u;
  if (u) console.log(`Kaggle: conta ${u} — o estúdio liga sozinho quando precisar`);
  if (u) setTimeout(tryGpu, 20000);
});
const onGpuUp = async ({ url: gpuUrl }) => {
  console.log("Estúdio: a GPU ligou, trocando para ela:", gpuUrl);
  await saveSettings({ kaggleUrl: gpuUrl, kaggleCpu: false });
};
// Estúdio no modo processador (lento)? Tenta conseguir a GPU de novo a cada 20 min e troca sozinho.
async function tryGpu() {
  const s = getSettings();
  if (!KAGGLE_USER || !s.kaggleCpu || !s.kaggleTopic || !s.kaggleKey) return;
  if (!(await kaggleHealth()).ok) return; // estúdio já desligou: o próximo pedido liga um novo
  await requestGpu(s.kaggleKey, s.kaggleTopic, onGpuUp).catch((e) => console.log("Kaggle: pedido de GPU falhou:", e.message));
}
setInterval(() => tryGpu(), 20 * 60 * 1000).unref();
// Liga o estúdio no Kaggle (se ainda não estiver no ar) e guarda endereço e chave
async function ensureStudio(onProgress) {
  if (kaggleConfigured() && (await kaggleHealth()).ok) return true;
  if (!KAGGLE_USER) return false;
  const onUpgrade = onGpuUp;
  // Pedido feito antes de o app reiniciar (o Render grátis reinicia às vezes): continua esperando
  // as mesmas máquinas, em vez de pedir outras e recomeçar a instalação do zero.
  const pending = getSettings().pendingStudio;
  const fresh = pending && Date.now() - pending.at < 45 * 60 * 1000 ? pending : null;
  const opts = { onPushed: (p) => saveSettings({ pendingStudio: p }) };
  let r;
  try {
    r = await startStudio(onProgress, onUpgrade, fresh ? { ...opts, resume: fresh } : opts);
  } catch (e) {
    await saveSettings({ pendingStudio: null });
    if (!e.restart) throw e;
    r = await startStudio(onProgress, onUpgrade, opts); // o anterior já tinha desligado: pede de novo
  }
  const { url, key, topic, cpu } = r;
  await saveSettings({ kaggleUrl: url, kaggleKey: key, kaggleTopic: topic, kaggleCpu: cpu, studioSince: Date.now(), pendingStudio: null });
  for (let i = 0; i < 12; i++) {
    if ((await kaggleHealth()).ok) return true; // o túnel pode levar alguns segundos para responder
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

const PORT = Number(process.env.PORT) || 3000;
const HF_TOKEN = (process.env.HF_TOKEN || "").trim();
const ACE_SPACE = process.env.ACE_SPACE || "victor/ace-step-jam";
// Space ACE-Step 1.5 que aceita áudio de referência (experimental)
// Estúdios ACE-Step 1.5 gratuitos (aceitam áudio de referência e servem de reserva quando o principal bate no limite)
const REF_SPACES = (process.env.REF_SPACES || "ACE-Step/Ace-Step-v1.5,Kansasfan/ace-step-music-studio,Blursed/ACE-Step-1.5-XL-ENHANCED").split(",").map((s) => s.trim()).filter(Boolean);
// Estúdio que bateu no limite fica de lado por um tempo, para não perder tempo tentando de novo
const cooldown = new Map(); // space -> timestamp até quando pular
const isLimitError = (msg = "") => /runs limit|quota|rate.?limit|too many requests|429/i.test(msg);
const resting = (space) => (cooldown.get(space) || 0) > Date.now();
function rest(space, msg) {
  if (isLimitError(msg)) cooldown.set(space, Date.now() + 60 * 60 * 1000);
}
const MIN_SECONDS = 30;
const MAX_SECONDS = 300; // limite: 5 minutos

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "30mb" })); // arte do vídeo (PNG) e áudio de referência vêm no corpo

// ---------- Senha de acesso (quando publicado na internet: APP_PASSWORD) ----------
// O "casco" do app (página, ícones, manifest) é público; a API e os áudios exigem login.
const APP_PASSWORD = (process.env.APP_PASSWORD || "").trim();
const AUTH_TOKEN = APP_PASSWORD ? createHmac("sha256", APP_PASSWORD).update("acaiamusic-v1").digest("hex") : "";
const cookieOf = (req, name) => (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(name + "="))?.slice(name.length + 1);
const authed = (req) => !APP_PASSWORD || cookieOf(req, "acaia_auth") === AUTH_TOKEN;
app.get("/api/auth", (req, res) => res.json({ required: Boolean(APP_PASSWORD), ok: authed(req) }));
const loginTries = new Map(); // ip -> { n, until }
app.post("/api/login", (req, res) => {
  const ip = req.ip || "?";
  const t = loginTries.get(ip) || { n: 0, until: 0 };
  if (t.until > Date.now()) return res.status(429).json({ error: "Muitas tentativas. Espere 1 minuto." });
  const pass = String(req.body?.password || "");
  const ok = APP_PASSWORD && pass.length === APP_PASSWORD.length && timingSafeEqual(Buffer.from(pass), Buffer.from(APP_PASSWORD));
  if (!ok) {
    t.n++;
    if (t.n >= 5) Object.assign(t, { n: 0, until: Date.now() + 60000 });
    loginTries.set(ip, t);
    return res.status(401).json({ error: "Senha incorreta." });
  }
  loginTries.delete(ip);
  res.setHeader("Set-Cookie", `acaia_auth=${AUTH_TOKEN}; Path=/; Max-Age=${60 * 60 * 24 * 400}; HttpOnly; SameSite=Lax${req.secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "acaia_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  res.json({ ok: true });
});
app.use(["/api", "/audio"], (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: "Entre com a senha do ACAIAMUSIC.", login: true })));

// Página e dados comprimidos (gzip): o app abre ~4× mais leve no celular. O áudio já é comprimido (MP3).
app.use(compression({ filter: (req, res) => !req.path.startsWith("/audio/") && compression.filter(req, res) }));
// arquivos públicos (o .well-known/assetlinks.json é exigido pelo APK do Android)
// fontes e ícones não mudam: ficam guardados no aparelho por 30 dias
app.use(
  express.static(path.join(here, "public"), {
    dotfiles: "allow",
    setHeaders: (res, file) => /\.(woff2?|ttf|png|svg|ico|webp|jpg)$/i.test(file) && res.setHeader("Cache-Control", "public, max-age=2592000"),
  }),
);
app.get("/keyboard.js", (_req, res) => res.type("text/javascript").sendFile(path.join(here, "keyboard.js"))); // lista de batidas do teclado, usada também no app
app.use("/audio", express.static(SONGS_DIR));

// ---------- Biblioteca (arquivo JSON) ----------
async function loadSongs() {
  if (!existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch {
    return [];
  }
}
let writing = Promise.resolve();
function updateSongs(fn) {
  writing = writing.then(async () => {
    const songs = await loadSongs();
    await fs.writeFile(DB_FILE, JSON.stringify(fn(songs), null, 2));
  });
  return writing;
}

// =====================================================================
// 1) LETRA (ver lyrics.js)
// =====================================================================
function lyricsError(res, e) {
  if (e instanceof LyricsError) return res.status(e.retryAfter ? 429 : 502).json({ error: e.message, retryAfter: e.retryAfter });
  console.error(e);
  res.status(500).json({ error: "Erro ao gerar a letra." });
}

app.post("/api/lyrics", async (req, res) => {
  const b = req.body || {};
  const options = cleanOptions(b);
  const idea = String(b.idea || "").trim().slice(0, 1500);
  if (!idea && options.mode === "livre") return res.status(400).json({ error: "Descreva a ideia da música." });
  if (!idea && options.mode === "catolica" && !options.reading && !OFFICIAL_TEXTS[options.moment]) {
    return res.status(400).json({ error: "Escreva o tema do canto ou cole a leitura do dia." });
  }
  try {
    const parts = idea ? await splitIdea(idea) : null;
    const lyricIdea = parts && (parts.melody || parts.music) ? parts.lyrics || (options.mode === "livre" ? idea : "") : idea;
    const plan = await writeLyrics({ idea: lyricIdea, options, language: String(b.language || "pt"), duration: Number(b.duration) || 60 });
    plan.styles = buildTags(options, plan.styles, ideaMusicTags(parts)).split(", ").slice(0, 14);
    res.json({ ...plan, ideaParts: parts });
  } catch (e) {
    lyricsError(res, e);
  }
});

app.post("/api/lyrics/refine", async (req, res) => {
  const b = req.body || {};
  let plan;
  try {
    plan = cleanPlan(b.plan || {}, false);
  } catch {
    return res.status(400).json({ error: "Não há letra para melhorar." });
  }
  try {
    const options = cleanOptions(b.options || {});
    const out = await refineLyrics({ plan, action: b.action, custom: b.custom, options, language: String(b.language || "pt") });
    out.styles = plan.styles;
    res.json(out);
  } catch (e) {
    lyricsError(res, e);
  }
});


// =====================================================================
// 2) MÚSICA: ACE-Step v1.5 no Hugging Face (gratuito com conta HF)
// =====================================================================
const TAGS = [
  [/pr[eé].?refr|pre.?chorus/i, "pre-chorus"],
  [/refr|chorus|coro|resposta|ant[ií]fona|aleluia|hosana/i, "chorus"],
  [/ponte|bridge/i, "bridge"],
  [/intro/i, "intro"],
  [/final|outro|encerr/i, "outro"],
  [/verso|verse|estrofe/i, "verse"],
];
const tagFor = (name) => (TAGS.find(([re]) => re.test(name)) || [, "verse"])[1];

// Texto limpo para o modelo de música cantar: caracteres "especiais" (hífen inseparável, aspas
// curvas, travessões, espaços invisíveis, emojis) viram sons desconhecidos e o canto se perde da letra.
function singable(line) {
  return String(line)
    .normalize("NFC")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‛´`]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[  -​  ﻿]/g, " ")
    .replace(/…/g, "...")
    .replace(/[^\p{L}\p{N}\s.,;:!?'"()\-]/gu, "")
    .replace(/\s*-\s+/g, ", ") // travessão no meio da frase vira pausa
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Ordem em que a música é CANTADA. Na letra o refrão costuma vir escrito uma vez só, mas
// num canto de "refrão + estrofes" ele volta depois de cada estrofe. Sem isso o estúdio
// canta o refrão 1 vez e a música termina incompleta.
function sungOrder(sections) {
  const sung = sections.filter((s) => s.lines.length);
  const choruses = sung.filter((s) => tagFor(s.name) === "chorus");
  const verses = sung.filter((s) => tagFor(s.name) === "verse");
  if (choruses.length !== 1 || verses.length < 2) return sections;
  const chorus = choruses[0];
  const out = [];
  let lastWasChorus = false;
  for (const s of sections) {
    if (s === chorus) {
      if (!lastWasChorus) out.push(s);
      lastWasChorus = true;
      continue;
    }
    out.push(s);
    lastWasChorus = false;
    if (tagFor(s.name) === "verse") {
      out.push(chorus);
      lastWasChorus = true;
    }
  }
  if (tagFor(sections[0]?.name || "") === "chorus" && out[0] !== chorus) out.unshift(chorus);
  return out;
}

// Versos longos (o Salmo e a Aclamação da liturgia chegam com 20 a 40 sílabas numa linha só)
// fazem o estúdio atropelar as palavras: a voz sai embolada e robotizada. Aqui o verso é
// quebrado em frases de até ~13 sílabas, nas vírgulas ou entre palavras, sem mudar o texto.
const sylCount = (t) => (String(t).toLowerCase().match(/[aeiouáéíóúâêôãõàüy]+/g) || []).length;
const BREAK_BEFORE = /^(e|que|para|pois|porque|mas|como|quando|onde|com|sobre|por|nos|no|na|em|ao|à|de|do|da|dos|das)$/i;
function breakLine(line, max = 13) {
  if (sylCount(line) <= max + 2) return [line];
  // 1º: nas pausas da própria frase (vírgula, ponto e vírgula, dois-pontos)
  const chunks = line.split(/(?<=[,;:])\s+/).filter(Boolean);
  const out = [];
  for (const c of chunks) {
    const last = out[out.length - 1];
    if (last && sylCount(last) + sylCount(c) <= max) out[out.length - 1] = `${last} ${c}`;
    else out.push(c);
  }
  // 2º: o que ainda ficou longo é cortado entre palavras, perto do meio (de preferência antes de "e", "que", "para"…)
  return out.flatMap(function cut(c) {
    if (sylCount(c) <= max + 2) return [c];
    const words = c.split(/\s+/);
    const total = sylCount(c);
    let best = -1, bestScore = Infinity, acc = 0;
    for (let i = 1; i < words.length; i++) {
      acc += sylCount(words[i - 1]);
      const score = Math.abs(acc - total / 2) - (BREAK_BEFORE.test(words[i]) ? 2.5 : 0);
      if (acc >= 4 && total - acc >= 4 && score < bestScore) (bestScore = score), (best = i);
    }
    if (best < 0) return [c];
    return [...cut(words.slice(0, best).join(" ")), ...cut(words.slice(best).join(" "))];
  });
}

function toAceLyrics(sections) {
  const parts = sections.map((s) => {
    const tag = tagFor(s.name);
    const lines = s.lines.map((l) => singable(l.replace(/^\s*[\[(][^\])]{1,20}[\])]\s*[:\-–]?\s*/, ""))).filter(Boolean).flatMap((l) => breakLine(l));
    const Tag = tag[0].toUpperCase() + tag.slice(1); // formato da documentação do ACE-Step: [Verse], [Chorus]…
    return lines.length ? `[${Tag}]\n${lines.join("\n")}` : `[${Tag}]\n[Instrumental]`;
  });
  const text = parts.join("\n\n");
  return sections.every((s) => !s.lines.length) ? "[instrumental]" : text;
}

// Linha do tempo da letra de uma música (modo palco, letra animada do vídeo).
// Com o que o Whisper ouviu: o tempo real de cada palavra. Se a música ainda não foi ouvida,
// ouve agora (uns 30 s) e guarda. Sem o ouvido: tempo aproximado, pela duração e pelo tamanho dos versos.
async function songTimeline(song, { listenNow = true } = {}) {
  const order = sungOrder(song.sections || []).filter((s) => s.lines.length);
  if (!order.length || song.voice === "Instrumental") return { lines: [], approximate: true };
  let heard = song.hearing;
  if (!heard?.words?.length && listenNow && hearingUrl()) {
    try {
      const mp3 = await fs.readFile(path.join(SONGS_DIR, `${song.id}.mp3`));
      const h = await listen(mp3, song.spec?.language || "pt");
      heard = { words: h.words, chords: h.chords, key: h.key, tempo: h.tempo };
      await updateSongs((songs) => songs.map((x) => (x.id === song.id ? { ...x, hearing: heard } : x)));
    } catch (e) {
      console.log("Linha do tempo: o ouvido não conseguiu ouvir agora:", e.message);
    }
  }
  const real = heard?.words?.length ? lyricTimeline(order, heard) : null;
  if (real) return { lines: real, approximate: false };
  // aproximado: introdução, versos proporcionais ao número de sílabas, final
  const d = Number(song.duration) || 120;
  const intro = Math.min(15, d * 0.1), outro = Math.min(10, d * 0.06);
  const flat = order.flatMap((s) => s.lines.map((text) => ({ sec: s.name, text })));
  const w = flat.map((l) => Math.max(3, sylCount(l.text)));
  const total = w.reduce((a, b) => a + b, 0), span = Math.max(10, d - intro - outro);
  let acc = 0;
  return {
    approximate: true,
    lines: flat.map((l, k) => {
      const t = intro + (acc / total) * span;
      acc += w[k];
      const end = intro + (acc / total) * span - 0.3;
      const ws = l.text.split(/\s+/).filter(Boolean);
      return { ...l, t: +t.toFixed(2), end: +end.toFixed(2), words: ws.map((x, i) => [x, +(t + ((end - t) * i) / ws.length).toFixed(2), +(t + ((end - t) * (i + 1)) / ws.length).toFixed(2), ""]) };
    }),
  };
}

let aceClient = null;
async function getAce() {
  if (!aceClient) {
    aceClient = await Client.connect(ACE_SPACE, {
      events: ["data", "status"],
      ...(HF_TOKEN ? { token: HF_TOKEN } : {}),
    });
  }
  return aceClient;
}

// ---------- Áudio: WAV (do Space) -> MP3 ----------
async function audioToBuffer(file) {
  const url = typeof file === "string" ? file : file?.url || file?.value?.url;
  if (!url) throw new Error("o Space não devolveu áudio");
  if (url.startsWith("data:")) return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  const r = await fetch(url, HF_TOKEN ? { headers: { Authorization: `Bearer ${HF_TOKEN}` } } : {});
  if (!r.ok) throw new Error(`download do áudio falhou (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

function friendlyAceError(msg = "") {
  if (/runs limit/i.test(msg))
    return "Todos os estúdios gratuitos do Hugging Face estão no limite agora. Ligue o seu estúdio no Kaggle (⚙️ Servidor de música): ele é gratuito e não tem limite diário.";
  if (/ZeroGPU quota|exceeded your GPU quota/i.test(msg)) {
    const wait = msg.match(/Try again in ([\d:]+)/)?.[1];
    return HF_TOKEN
      ? `A cota gratuita de GPU do Hugging Face acabou${wait ? ` (volta em ${wait})` : " por hoje"}. Ligue o seu estúdio no Kaggle (⚙️ Servidor de música) para continuar de graça agora.`
      : "Para gerar músicas grátis, coloque seu HF_TOKEN (conta gratuita do Hugging Face) no arquivo .env.";
  }
  if (/sleeping|building|paused|runtime error/i.test(msg)) return "O servidor de música gratuito está reiniciando. Tente de novo em alguns minutos.";
  if (/token|unauthori/i.test(msg)) return "HF_TOKEN inválido. Gere outro em huggingface.co/settings/tokens.";
  return "O gerador gratuito falhou: " + msg.slice(0, 200);
}

// ---------- Fila de trabalhos ----------
const jobs = new Map(); // id -> { status, message, queue, song, error }
let chain = Promise.resolve(); // uma geração por vez
const studio = registerStudio(app, { loadSongs, updateSongs, SONGS_DIR, jobs, HF_TOKEN, songTimeline });
// tempo de cada verso e palavra (modo palco)
app.get("/api/songs/:id/timeline", async (req, res) => {
  const song = (await loadSongs()).find((s) => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: "Música não encontrada." });
  try {
    res.json(await songTimeline(song, { listenNow: req.query.listen !== "0" }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Acompanha a fila do Space e devolve a primeira resposta com dados
async function follow(sub, set) {
  for await (const msg of sub) {
    if (msg.type === "status") {
      if (msg.stage === "error") throw new Error(msg.message || msg.title || "erro");
      if (msg.stage === "pending") {
        const q = msg.position ?? msg.queue_position;
        set({ status: q > 0 ? "queued" : "generating", queue: q ?? null, message: q > 0 ? `Na fila: ${q} pessoa(s) na sua frente…` : "Compondo e gravando a música…" });
      }
      if (msg.stage === "generating") set({ status: "generating", message: "Compondo e gravando a música…" });
      if (msg.stage === "complete") return null;
    }
    if (msg.type === "data") {
      // o ACE-Step 1.5 manda respostas parciais: espera a que tiver áudio ou erro
      const audioItem = msg.data.find((d) => d && typeof d === "object" && (d.url || d.path || d.value?.url));
      const errText = msg.data.find((d) => typeof d === "string" && /❌/.test(d));
      if (audioItem) return audioItem;
      if (errText) throw new Error(errText);
      if (typeof msg.data[0] === "string" && msg.data[0].startsWith("data:")) return msg.data[0];
    }
  }
  return null;
}

// Geração nos estúdios ACE-Step 1.5 (com ou sem áudio de referência), tentando um por um
async function generateOn15Spaces({ params, options, language, reference }, set) {
  let refBlob = null;
  if (reference) {
    const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(reference.data || ""));
    if (!m) throw new Error("Áudio de referência inválido.");
    refBlob = new Blob([Buffer.from(m[2], "base64")], { type: m[1] });
  }
  let lastErr;
  const spaces = REF_SPACES.filter((s) => !resting(s));
  for (const [n, space] of spaces.entries()) {
    try {
      set({ status: "connecting", message: `Conectando ao estúdio gratuito ${n + 2}${refBlob ? " (com referência)" : ""}…` });
      const c = await Client.connect(space, { events: ["data", "status"], ...(HF_TOKEN ? { token: HF_TOKEN } : {}) });
      const api = await c.view_api();
      const gen = api.named_endpoints["/generation_wrapper"];
      const cap = api.named_endpoints["/capture_current_params"]?.parameters.map((p) => p.parameter_name);
      if (!gen || !cap) throw new Error("Space sem o endpoint esperado");
      const args = gen.parameters.map((p) => p.parameter_default ?? null);
      const at = (name, v) => {
        const i = cap.indexOf(name);
        if (i >= 0) args[4 + i] = v; // os 4 primeiros parâmetros são modelo/modo/descrição simples
      };
      args[1] = "custom";
      at("captions", params.prompt);
      at("lyrics", params.lyrics);
      if (options.bpm) at("bpm", options.bpm);
      at("vocal_language", SUNG_LANGS.includes(language) ? language : "unknown");
      at("audio_duration", params.audio_duration);
      at("batch_size_input", 1);
      if (refBlob) at("reference_audio", handle_file(refBlob));
      at("audio_format", "mp3");
      set({ status: "queued", message: "Na fila do estúdio gratuito…" });
      const out = await follow(c.submit("/generation_wrapper", args), set);
      if (!out) throw new Error("o Space não devolveu áudio");
      return out;
    } catch (e) {
      lastErr = e;
      rest(space, String(e?.message));
      console.error(`Estúdio ${space} falhou:`, e?.message);
    }
  }
  throw lastErr || new Error("runs limit: todos os estúdios gratuitos estão no limite agora");
}

async function runJob(id, { plan, duration, language, meta, options, reference, spec = {}, check = null, replaceId = null }) {
  // Revisão de pronúncia (o Whisper ouve antes de salvar e, se a letra não foi bem entendida, grava
  // outra versão) vale para TODA música cantada, não só no "Refazer". Só o "Refazer" pode desligar.
  const autoCheck = check == null;
  if (autoCheck) check = options?.voice !== "Instrumental" && Boolean(hearingUrl());
  // texto livre: o que é melodia, música ou letra (da criação e, no "Refazer", do pedido de ajuste)
  const ideaParts = spec.ideaParts || (spec.idea ? await splitIdea(spec.idea).catch(() => null) : null);
  const noteParts = spec.note ? await splitIdea(spec.note).catch(() => null) : null;
  // batida do teclado (escolhida ou automática): a música é criada nesse ritmo
  const kb = pickKeyboardStyle(options);
  const extraTags = [...ideaMusicTags(noteParts), kb.tags, ...ideaMusicTags(ideaParts)];
  if (noteParts?.lyrics && plan?.sections?.length && options.voice !== "Instrumental") {
    try {
      plan = await refineLyrics({ plan, custom: noteParts.lyrics, options, language });
    } catch (e) {
      console.log("Ajuste da letra pedido no Refazer falhou, fica a letra de antes:", e.message);
    }
  }
  const startedAt = Date.now();
  // Pedidos antigos da fila guardaram 40 BPM por engano (andamento "auto" virava 40): descarta
  if (options.bpm === 40 && (options.tempo || "auto") === "auto") options = { ...options, bpm: 0 };
  let engine = "Hugging Face (gratuito)";
  const job = jobs.get(id);
  // guarda quando cada etapa começou (para mostrar "Ligando o estúdio · 3 min", etc.)
  const stamp = (patch) => (patch.status && patch.status !== job.status ? { ...patch, stageAt: Date.now() } : patch);
  // cada tentativa tem um número: se o vigia da fila desistir desta e começar outra,
  // esta para no próximo passo e não salva nada por cima da nova
  const attempt = (job.attempt = (job.attempt || 0) + 1);
  const set = (patch) => {
    if (job.canceled) throw new Error("CANCELED");
    if (job.attempt !== attempt) throw new Error("SUPERSEDED");
    Object.assign(job, stamp(patch), { updatedAt: Date.now() });
  };
  const softSet = (patch) => !job.canceled && job.attempt === attempt && Object.assign(job, stamp(patch), { updatedAt: Date.now() }); // não interrompe a ligação do estúdio
  job.startedAt = startedAt;
  job.eta = Math.round(30 + (Number(duration) || 60) * (options.quality === "high" ? 2 : 1.2));
  job.pctMax = 0; // nova tentativa: o andamento recomeça
  try {
    set({ status: "connecting", message: "Conectando ao estúdio de IA…" });
    // A letra precisa caber no tempo: cantando com calma são ~2,5 sílabas por segundo, mais
    // ~20 s de introdução, respiros e final. Se não couber, a música fica mais longa (até o
    // limite) em vez de o modelo atropelar ou pular versos.
    const order = sungOrder(plan.sections);
    const sung = options.voice === "Instrumental" ? "" : order.flatMap((s) => s.lines).join(" ");
    const syllables = (sung.toLowerCase().match(/[aeiouáéíóúâêôãõàü]+/g) || []).length;
    // canto litúrgico é calmo (~2,2 sílabas/s) + introdução, um respiro entre as partes e o final
    const parts = order.filter((s) => s.lines.length).length;
    const needed = sung ? Math.ceil(syllables / 2.2 + 14 + parts * 3 + 8) : 0;
    const seconds = Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, Math.max(duration, needed)));
    if (needed > duration) console.log(`Letra longa (${syllables} sílabas): duração ${duration}s → ${seconds}s para caber tudo`);
    const params = {
      prompt: buildTags(options, plan.styles, extraTags),
      lyrics: options.voice === "Instrumental" ? "[instrumental]" : toAceLyrics(order),
      audio_duration: seconds,
      infer_step: options.quality === "high" ? 16 : 8,
      guidance_scale: 7,
      seed: -1,
      lora_name_or_path: "",
      lora_weight: 0.8,
    };

    let raw = null;
    let hfTried = false, hfErr = null;
    // Estúdios gratuitos do Hugging Face (GPU rápida, ~1 min, mas com cota diária por conta)
    const tryHF = async () => {
      hfTried = true;
      if (!reference && !resting(ACE_SPACE)) {
        try {
          const client = await getAce();
          set({ status: "queued", message: "Na fila do estúdio gratuito (rápido)…" });
          const out = await audioToBuffer(await follow(client.submit("/generate", params), set));
          engine = "Hugging Face (gratuito)";
          return out;
        } catch (e) {
          if (job.canceled) throw e;
          rest(ACE_SPACE, String(e?.message));
          if (/connect|fetch failed|ECONN/i.test(String(e?.message))) aceClient = null;
          console.log(`Estúdio ${ACE_SPACE} falhou, tentando os outros:`, e?.message);
        }
      }
      try {
        const out = await audioToBuffer(await generateOn15Spaces({ params, options, language, reference }, set));
        engine = "Hugging Face (gratuito)";
        return out;
      } catch (e) {
        if (job.canceled) throw e;
        console.log("Estúdios gratuitos do Hugging Face indisponíveis:", e?.message);
        hfErr = e;
        return null;
      }
    };
    // Estúdio do Kaggle ligado só no modo processador (sem GPU, ~15-20 min por música)?
    // Então tenta primeiro os estúdios rápidos do Hugging Face; o processador fica de reserva.
    // Estúdio no Modal: GPU que liga só para esta música (~1-2 min), paga com os créditos grátis do mês
    let modalTried = false;
    const tryModal = async () => {
      modalTried = true;
      if (!modalConfigured()) return null;
      const h = await wakeModal(set);
      if (!h.ok) return console.log("Modal indisponível:", h.error), null;
      try {
        const out = await generateKaggle({ params, options, language, reference }, set, "modal");
        engine = "Seu estúdio no Modal";
        return out;
      } catch (e) {
        if (job.canceled) throw e;
        console.log("Modal falhou, indo para os estúdios gratuitos:", e?.message);
        return null;
      }
    };
    if (getSettings().kaggleCpu && kaggleConfigured() && (await kaggleHealth()).ok) {
      set({ status: "connecting", message: "Seu estúdio está sem GPU agora: tentando o estúdio rápido…" });
      raw = await tryHF();
    }
    // Kaggle só com processador leva ~16 min: o Modal (GPU) vem antes
    if (!raw && getSettings().kaggleCpu && modalConfigured()) raw = await tryModal();
    // 1º: o seu estúdio no Kaggle (gratuito, sem limite diário) — liga sozinho se estiver desligado
    if (!raw && (kaggleConfigured() || KAGGLE_USER)) {
      set({ status: "connecting", message: "Conectando ao seu estúdio no Kaggle…" });
      let h = { ok: false, error: "desligado" };
      try {
        h = { ok: await ensureStudio((m) => softSet({ status: "connecting", message: `Ligando o seu estúdio grátis no Kaggle: ${m}` })) };
      } catch (e) {
        h = { ok: false, error: e.message };
        softSet({ status: "connecting", message: `Kaggle: ${e.message.slice(0, 120)} · tentando os servidores gratuitos…` });
      }
      if (h.ok) {
        try {
          raw = await generateKaggle({ params, options, language, reference }, set);
          engine = "Seu estúdio no Kaggle";
          lastStudioUse = Date.now();
        } catch (e) {
          if (job.canceled) throw e;
          console.log("Kaggle falhou, indo para os estúdios gratuitos:", e?.message);
        }
      } else console.log("Kaggle indisponível:", h.error);
    }
    // 1º-B: o seu estúdio no Modal (créditos grátis do mês; liga a GPU só agora)
    if (!raw && !modalTried) raw = await tryModal();
    // 2º e 3º: estúdios gratuitos do Hugging Face (o principal e depois os outros, um por um)
    if (job.canceled) throw new Error("CANCELED");
    if (!raw && !hfTried) raw = await tryHF();
    if (job.canceled) throw new Error("CANCELED");
    if (!raw) throw hfErr || new Error("runs limit: todos os estúdios gratuitos estão no limite agora");
    let pron = null;
    if (check && sung && hearingUrl()) {
      const TAKES = autoCheck ? 2 : 3, GOOD = autoCheck ? 92 : 96; // automática: até 2 gravações (poupa os créditos)
      let best = null;
      for (let take = 1; take <= TAKES; take++) {
        set({ status: "generating", message: `Conferindo a pronúncia com o Whisper (versão ${take} de até ${TAKES})…` });
        let heard = null;
        try {
          const beat = setInterval(() => softSet({}), 60000); // sinal de vida para o vigia da fila
          try {
            heard = await listen(Array.isArray(raw) ? raw[0] : raw, language);
          } finally {
            clearInterval(beat);
          }
        } catch (e) {
          if (job.canceled || job.attempt !== attempt) throw e;
          console.log("Whisper não conseguiu ouvir:", e.message);
          if (!best) best = { raw, score: null, heard: null, take };
          break;
        }
        const score = lyricScore(sung, heard.text);
        console.log(`Pronúncia "${plan.title}" versão ${take}: ${score}%`);
        if (!best || score > (best.score ?? -1)) best = { raw, score, heard, take };
        if (score >= GOOD || take === TAKES || !modalConfigured()) break;
        set({ status: "generating", message: `Versão ${take}: ${score}% da letra entendida. Gravando outra mais clara (${take + 1} de ${TAKES})…` });
        try {
          raw = await generateKaggle({ params, options, language, reference }, set, "modal");
        } catch (e) {
          if (job.canceled || job.attempt !== attempt) throw e;
          console.log("Nova versão para a pronúncia falhou:", e.message);
          break;
        }
      }
      raw = best.raw;
      pron = { score: best.score, take: best.take, heard: best.heard };
    }
    set({ status: "saving", message: "Masterizando (volume e brilho de streaming)…" });
    // ffmpeg num processo à parte: converter/masterizar aqui dentro travava o servidor grátis
    // (o Render achava que o app tinha morrido e o reiniciava sem parar)
    // o estúdio com GPU devolve 2 versões: a 1ª é a principal, a 2ª fica para a pessoa comparar
    const [mainRaw, altRaw] = Array.isArray(raw) ? raw : [raw];
    const { mp3, seconds: realSeconds, mastered } = await masterOrPlain(mainRaw, { tuning: options.tuning });
    if (job.canceled) throw new Error("CANCELED");
    set({ status: "saving", message: "Salvando…" });
    // "Refazer": a música nova fica no lugar da antiga (mesmo id: álbuns e repertórios continuam valendo)
    const old = replaceId ? (await loadSongs()).find((x) => x.id === replaceId) : null;
    const outId = old ? old.id : id;
    const rev = Date.now();
    await fs.writeFile(path.join(SONGS_DIR, `${outId}.mp3`), mp3);
    if (old) {
      await fs.rm(path.join(SONGS_DIR, `${outId}-v2.mp3`), { force: true });
      await fs.rm(studio.mediaDir(outId), { recursive: true, force: true }); // faixas e vídeos da gravação antiga
    }
    const alt = null; // a 2ª versão é masterizada depois que a música já está pronta (logo abaixo)

    // cifra tirada do áudio, quando o Whisper ouviu a música
    let audioChords = null;
    if (pron?.heard) {
      try {
        audioChords = chordSheetFromAudio(order, pron.heard);
      } catch (e) {
        console.log("Cifra do áudio falhou:", e.message);
      }
    }
    const song = {
      id: outId,
      title: plan.title,
      styles: plan.styles,
      sections: plan.sections,
      references: plan.references,
      notes: plan.notes,
      // com o ouvido ligado, a cifra vem do áudio (logo abaixo); a da IA só fica sem ele
      ...(audioChords ? { chords: audioChords } : plan.chords && !old && !(sung && hearingUrl()) ? { chords: plan.chords } : {}),
      ...(pron?.heard ? { hearing: { words: pron.heard.words, chords: pron.heard.chords, key: pron.heard.key, tempo: pron.heard.tempo } } : {}),
      ...(reference ? { reference: String(reference.name || "").slice(0, 120) } : {}),
      genre: options.genre,
      keyboard: { model: KEYBOARD_MODEL, n: kb.n, name: kb.name, cat: kb.cat, auto: !options.keyboardStyle },
      mood: options.moods.join(", "),
      voice: options.voice,
      options,
      cover: old ? old.cover : Number.isInteger(meta.cover) ? meta.cover : Math.floor(Math.random() * 1e6),
      favorite: old ? Boolean(old.favorite) : false,
      duration: Math.round(realSeconds || seconds),
      createdAt: old ? old.createdAt : new Date().toISOString(),
      ...(old ? { remadeAt: new Date().toISOString() } : {}),
      // Ficha técnica: tudo o que foi escolhido para criar esta música
      spec: {
        idea: String(spec.idea || "").slice(0, 1500),
        ...(spec.translatedFrom ? { translatedFrom: spec.translatedFrom } : {}),
        ...(spec.variantOf ? { variantOf: spec.variantOf } : {}),
        ...(ideaParts ? { ideaParts } : {}),
        ...(spec.note ? { note: String(spec.note).slice(0, 1500), noteParts } : {}),
        lyricsSource: ["ia", "propria", "missal"].includes(spec.lyricsSource) ? spec.lyricsSource : "ia",
        language,
        requestedDuration: seconds,
        quality: options.quality,
        engine: reference ? `${engine} · com áudio de referência` : engine,
        musicPrompt: params.prompt,
        mastered: Boolean(mastered),
        ...(options.tuning && options.tuning !== "440" ? { tuning: options.tuning } : {}),
        generationSeconds: Math.round((Date.now() - startedAt) / 1000),
        ...(pron && pron.score != null ? { pronunciation: pron.score, takes: pron.take } : {}),
      },
      url: `/audio/${outId}.mp3${old ? `?v=${rev}` : ""}`,
      ...(alt ? { alt } : {}),
    };
    if (job.attempt !== attempt) throw new Error("SUPERSEDED");
    await updateSongs((songs) => (old && songs.some((x) => x.id === outId) ? songs.map((x) => (x.id === outId ? song : x)) : [song, ...songs]));
    set({ status: "done", message: pron?.score != null ? `Pronta! Pronúncia: ${pron.score}% da letra entendida.` : "Pronta!", song });
    // 2ª versão (para comparar): masterizada em segundo plano, sem segurar a fila em "Salvando"
    if (altRaw)
      (async () => {
        try {
          const a = await masterOrPlain(altRaw, { tuning: options.tuning });
          await fs.writeFile(path.join(SONGS_DIR, `${outId}-v2.mp3`), a.mp3);
          const v2 = { url: `/audio/${outId}-v2.mp3${old ? `?v=${rev}` : ""}`, duration: Math.round(a.seconds || 0) };
          await updateSongs((songs) => songs.map((x) => (x.id === outId && x.url === song.url ? { ...x, alt: v2 } : x)));
        } catch (e) {
          console.log("2ª versão não foi salva:", e.message);
        }
      })();
    // Capa ilustrada do tema, automática (em segundo plano)
    autoIllustrate(outId);
    // Cifra tirada da própria música: o ouvido (Whisper + acordes) escuta em segundo plano, sem atrasar a fila
    if (!audioChords && sung && hearingUrl()) {
      listen(mp3, language)
        .then(async (heard) => {
          const chords = chordSheetFromAudio(order, heard);
          const hearing = { words: heard.words, chords: heard.chords, key: heard.key, tempo: heard.tempo };
          const pronunciation = lyricScore(sung, heard.text);
          await updateSongs((songs) => songs.map((x) => (x.id === outId ? { ...x, hearing, ...(chords ? { chords } : {}), spec: { ...x.spec, pronunciation } } : x)));
          console.log(`Cifra do áudio pronta: "${plan.title}" (tom ${heard.key}, pronúncia ${pronunciation}%)`);
        })
        .catch((e) => console.log("Cifra automática pelo áudio falhou:", e.message));
    }
  } catch (e) {
    if (job.canceled) return setCanceled(job);
    if (job.attempt !== attempt) return console.log("Tentativa antiga encerrada:", e?.message || e);
    console.error("Erro música:", e?.message || e);
    if (/connect|fetch failed|ECONN/i.test(String(e?.message))) aceClient = null; // reconecta na próxima
    set({ status: "error", error: friendlyAceError(String(e?.message || e)) });
  }
}

const setCanceled = (job) => Object.assign(job, { status: "canceled", message: "Cancelada.", error: undefined, updatedAt: Date.now() });

// ---------- Fila de criação (gravada em disco: continua mesmo se o app reiniciar) ----------
// Cada música pedida vira uma tarefa. Se falhar, tenta de novo (até MAX_TRIES), sem travar as outras.
const QUEUE_FILE = path.join(DATA_DIR, "queue.json");
const MAX_TRIES = 5;
let queue = [];
try {
  if (existsSync(QUEUE_FILE)) queue = JSON.parse(await fs.readFile(QUEUE_FILE, "utf8"));
} catch {}
const saveQueue = () => fs.writeFile(QUEUE_FILE, JSON.stringify(queue)).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pumping = false;
let currentTask = null;
let cancelCurrent = null; // libera a espera da tarefa atual quando ela é cancelada
let wake = () => {}; // acorda a fila quando ela está esperando uma nova tentativa
const history = []; // últimas músicas que saíram da fila (prontas, com erro ou canceladas)
const historyTasks = new Map(); // pedidos que saíram com erro ou cancelados, para poder pôr de volta na fila
function remember(t, status, extra = {}) {
  history.unshift({ id: t.id, label: t.label || t.input?.plan?.title || "Música", status, at: Date.now(), retry: status !== "done", ...extra });
  if (status !== "done") historyTasks.set(t.id, t);
  history.length = Math.min(history.length, 12);
  for (const id of historyTasks.keys()) if (!history.some((h) => h.id === id)) historyTasks.delete(id);
}
const queuePaused = () => Boolean(getSettings().queuePaused);

function enqueueSong(id, input, extra = {}) {
  queue.push({ id, input, tries: 0, notBefore: 0, addedAt: Date.now(), ...extra });
  jobs.set(id, { isSong: true, status: "queued", message: queue.length > 1 ? `Na fila de criação: ${queue.length - 1} música(s) antes desta` : "Aguardando…", createdAt: Date.now() });
  saveQueue();
  pump();
}
function markQueued() {
  queue.forEach((q, k) => {
    if (q === currentTask) return;
    const j = jobs.get(q.id) || jobs.set(q.id, { isSong: true, status: "queued", createdAt: Date.now() }).get(q.id);
    if (j.status !== "queued" || q.notBefore > Date.now()) return;
    Object.assign(j, { message: `Na fila de criação: ${k} música(s) antes desta`, updatedAt: Date.now() });
  });
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length && !queuePaused()) {
      const now = Date.now();
      const t = queue.find((q) => q.notBefore <= now);
      if (!t) {
        await Promise.race([sleep(Math.min(...queue.map((q) => q.notBefore)) - now + 500), new Promise((r) => (wake = r))]);
        continue;
      }
      currentTask = t;
      markQueued();
      if (!jobs.has(t.id)) jobs.set(t.id, { isSong: true, status: "waiting", message: "Retomando…", createdAt: Date.now() });
      t.tries++;
      saveQueue();
      const run = chain.then(() => runJob(t.id, t.input));
      chain = run.catch(() => {});
      // Vigia: se a tentativa ficar 10 min sem nenhum sinal, ou passar do tempo máximo, desiste
      // dela (a música volta para a fila e tenta de novo) para nada ficar preso para sempre.
      let watch;
      const stuck = new Promise((resolve) => {
        const began = Date.now();
        const maxMin = getSettings().kaggleCpu ? 150 : 60; // sem GPU no Kaggle a música pode cair no modo processador (lento)
        watch = setInterval(() => {
          const jj = jobs.get(t.id);
          if (!jj || jj.canceled || ["done", "error"].includes(jj.status)) return;
          const quiet = Date.now() - Math.max(jj.updatedAt || 0, began) > 10 * 60000;
          const tooLong = Date.now() - began > maxMin * 60000;
          if (!quiet && !tooLong) return;
          console.log(`Fila: "${t.label || t.input?.plan?.title}" ${quiet ? "parou de responder" : "passou do tempo"}; tentando de novo`);
          jj.attempt = (jj.attempt || 0) + 1000; // a tentativa presa para no próximo passo
          Object.assign(jj, { status: "error", error: quiet ? "O estúdio parou de responder." : "A gravação demorou demais.", updatedAt: Date.now() });
          resolve("stuck");
        }, 20000);
      });
      const outcome = await Promise.race([run, stuck, new Promise((r) => (cancelCurrent = r))]);
      clearInterval(watch);
      if (outcome === "stuck") chain = Promise.resolve(); // a próxima não espera a presa terminar
      cancelCurrent = null;
      currentTask = null;
      const j = jobs.get(t.id);
      if (j?.canceled) {
        queue = queue.filter((q) => q !== t);
        saveQueue();
        setCanceled(j);
        remember(t, "canceled");
        // se a música chegou a ficar pronta, é apagada quando o trabalho antigo terminar
        run.then(async () => {
          await fs.rm(path.join(SONGS_DIR, `${t.id}.mp3`), { force: true });
          await fs.rm(path.join(SONGS_DIR, `${t.id}-v2.mp3`), { force: true });
          await updateSongs((songs) => songs.filter((x) => x.id !== t.id));
        });
      } else if (j?.status === "done") {
        queue = queue.filter((q) => q !== t);
        saveQueue();
        remember(t, "done", { songId: j.song.id });
        if (t.setlist) await saveSetlistItem(t.setlist.id, t.setlist.i, { kind: "song", ref: j.song.id }).catch(() => {});
      } else if (t.tries < MAX_TRIES) {
        const waitMin = Math.min(10, t.tries * 2);
        t.notBefore = Date.now() + waitMin * 60000;
        queue = [...queue.filter((q) => q !== t), t]; // vai para o fim: as outras seguem
        saveQueue();
        Object.assign(j, { status: "queued", lastError: j.error, error: undefined, message: `Não deu certo desta vez (${String(j.error || "").slice(0, 90)}). Tento de novo em ${waitMin} min · tentativa ${t.tries + 1} de ${MAX_TRIES}.`, updatedAt: Date.now() });
      } else {
        queue = queue.filter((q) => q !== t);
        saveQueue();
        remember(t, "error", { error: String(j?.error || "").slice(0, 200) });
      }
    }
  } finally {
    pumping = false;
    currentTask = null;
  }
}
// Andamento de uma música em % (só sobe, nunca volta para trás na mesma tentativa)
function songPct(j) {
  if (!j) return 0;
  if (j.status === "done") return 100;
  if (!j.startedAt || ["error", "canceled"].includes(j.status)) return j.pctMax || 0;
  const el = (Date.now() - (j.stageAt || j.startedAt)) / 1000;
  const eta = j.eta || 150;
  let p;
  if (j.status === "waiting" || j.status === "connecting") p = 2 + 14 * Math.min(1, el / 180); // ligar o estúdio: 2 a 5 min
  else if (j.status === "queued") p = 16 + 2 * Math.min(1, el / 120);
  else if (j.status === "generating") {
    const r = el / eta;
    p = r < 1 ? 18 + 67 * r : 85 + 8 * (1 - Math.exp(-(r - 1))); // passou do previsto: vai devagar até 93
  } else if (j.status === "saving") p = 94 + 4 * Math.min(1, el / 30);
  else p = 1;
  j.pctMax = Math.max(j.pctMax || 0, Math.min(99, Math.floor(p)));
  return j.pctMax;
}
const queueView = () => {
  const cur = currentTask && jobs.get(currentTask.id);
  const paused = queuePaused();
  return {
    pending: queue.length,
    paused,
    current: currentTask ? { id: currentTask.id, label: currentTask.label || currentTask.input.plan.title, message: cur?.message || "" } : null,
    items: queue.map((q) => {
      const j = jobs.get(q.id) || {};
      const running = q === currentTask;
      return {
        id: q.id,
        label: q.label || q.input?.plan?.title || "Música",
        running,
        status: running ? j.status || "connecting" : "queued",
        startedAt: running ? j.startedAt || 0 : 0,
        stageAt: running ? j.stageAt || j.startedAt || 0 : 0,
        message: running ? j.message || "Criando…" : q.notBefore > Date.now() ? j.message || "Aguardando nova tentativa…" : paused ? "Pausada" : "Na fila",
        tries: q.tries,
        maxTries: MAX_TRIES,
        retryAt: !running && q.notBefore > Date.now() ? q.notBefore : 0,
        progress: running ? songPct(j) : 0,
      };
    }),
    history,
  };
};
// Áudio de referência tirado de um vídeo do YouTube (trecho de até 60 s, em MP3)
let ytBusy = 0;
app.post("/api/reference/youtube", async (req, res) => {
  if (ytBusy >= 2) return res.status(429).json({ error: "Já estou baixando outros vídeos. Tente em instantes." });
  ytBusy++;
  try {
    res.json(await youtubeReference(req.body?.url, { start: req.body?.start, seconds: req.body?.seconds }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  } finally {
    ytBusy--;
  }
});
app.get("/api/queue", (_req, res) => res.json(queueView()));
// Pausar / retomar: a música que já está sendo criada termina; as próximas esperam
app.post("/api/queue/pause", async (req, res) => {
  const paused = req.body?.paused !== false;
  await saveSettings({ queuePaused: paused });
  wake();
  if (!paused) {
    markQueued();
    pump();
  }
  res.json(queueView());
});
app.post("/api/queue/:id/cancel", (req, res) => {
  const t = queue.find((q) => q.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Essa música não está mais na fila." });
  const j = jobs.get(t.id) || jobs.set(t.id, { createdAt: Date.now() }).get(t.id);
  j.canceled = true;
  if (t === currentTask) cancelCurrent?.();
  else {
    queue = queue.filter((q) => q !== t);
    saveQueue();
    setCanceled(j);
    remember(t, "canceled");
    markQueued();
  }
  wake();
  res.json(queueView());
});
// Tentar agora: tira a espera entre tentativas e põe a música na frente da fila
app.post("/api/queue/:id/now", (req, res) => {
  const t = queue.find((q) => q.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Essa música não está mais na fila." });
  if (t !== currentTask) {
    t.notBefore = 0;
    const rest = queue.filter((q) => q !== t && q !== currentTask);
    queue = currentTask && queue.includes(currentTask) ? [currentTask, t, ...rest] : [t, ...rest];
    saveQueue();
    markQueued();
  }
  wake();
  pump();
  res.json(queueView());
});
// Ver um pedido da fila (título e letra) para editar antes de gravar
const sectionsText = (sections = []) => sections.map((s) => `[${s.name}]\n${(s.lines || []).join("\n")}`).join("\n\n");
app.get("/api/queue/:id", (req, res) => {
  const t = queue.find((q) => q.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Essa música não está mais na fila." });
  res.json({ id: t.id, title: t.input?.plan?.title || t.label || "", text: sectionsText(t.input?.plan?.sections), running: t === currentTask, duration: t.input?.duration || 0 });
});
// Editar título e letra de um pedido que ainda não começou a ser gravado
app.patch("/api/queue/:id", (req, res) => {
  const t = queue.find((q) => q.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Essa música não está mais na fila." });
  if (t === currentTask) return res.status(409).json({ error: "Esta música já está sendo gravada. Cancele e crie de novo para mudar." });
  const plan = t.input.plan;
  const oldTitle = plan.title;
  const title = String(req.body?.title ?? "").trim().slice(0, 120);
  if (title) plan.title = title;
  if (Array.isArray(req.body?.sections)) {
    let clean;
    try {
      clean = cleanPlan({ ...plan, sections: req.body.sections }, false);
    } catch {
      return res.status(400).json({ error: "A letra ficou vazia." });
    }
    if (JSON.stringify(clean.sections) !== JSON.stringify(plan.sections)) {
      plan.sections = clean.sections;
      delete plan.chords; // a cifra era da letra antiga
    }
  }
  if (title && t.label) t.label = t.label === oldTitle ? title : t.label.startsWith(oldTitle + " (") ? title + t.label.slice(oldTitle.length) : t.label;
  saveQueue();
  res.json(queueView());
});
// Subir / descer na fila (a que está sendo gravada fica onde está)
app.post("/api/queue/:id/move", (req, res) => {
  const i = queue.findIndex((q) => q.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "Essa música não está mais na fila." });
  const j = i + (Number(req.body?.dir) < 0 ? -1 : 1);
  if (queue[i] === currentTask || j < 0 || j >= queue.length || queue[j] === currentTask) return res.json(queueView());
  [queue[i], queue[j]] = [queue[j], queue[i]];
  saveQueue();
  markQueued();
  res.json(queueView());
});
// Histórico: pôr de volta na fila (erro / cancelada), apagar um item ou limpar tudo
app.post("/api/queue/history/:id/retry", (req, res) => {
  const t = historyTasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: "Não guardei esse pedido (o servidor reiniciou). Crie a música de novo pelo estúdio." });
  if (t.input?.replaceId && queue.some((q) => q.input?.replaceId === t.input.replaceId)) return res.status(409).json({ error: "Esta música já está na fila." });
  enqueueSong(randomUUID(), t.input, { label: t.label, ...(t.setlist ? { setlist: t.setlist } : {}) });
  historyTasks.delete(t.id);
  history.splice(history.findIndex((h) => h.id === t.id), 1);
  res.json(queueView());
});
app.delete("/api/queue/history/:id", (req, res) => {
  const k = history.findIndex((h) => h.id === req.params.id);
  if (k >= 0) history.splice(k, 1);
  historyTasks.delete(req.params.id);
  res.json(queueView());
});
app.delete("/api/queue/history", (_req, res) => {
  history.length = 0;
  historyTasks.clear();
  res.json(queueView());
});

app.post("/api/songs", (req, res) => {
  const b = req.body || {};
  let plan;
  try {
    plan = cleanPlan(b.plan || {}, false);
  } catch {
    return res.status(400).json({ error: "Gere a letra antes de criar a música." });
  }
  const chords = sanitizeChords(b.plan?.chords);
  if (chords) plan.chords = chords;
  const ref = b.reference && typeof b.reference.data === "string" ? b.reference : null;
  if (ref && ref.data.length > 14 * 1024 * 1024) return res.status(413).json({ error: "O áudio de referência pode ter no máximo 10 MB." });
  const id = randomUUID();
  const input = {
    plan,
    duration: Number(b.duration) || 60,
    language: String(b.language || "pt"),
    meta: b.meta || {},
    options: cleanOptions(b.options || {}),
    reference: ref,
    spec: { idea: b.idea, lyricsSource: b.lyricsSource },
  };
  enqueueSong(id, input, { label: plan.title });
  res.json({ jobId: id });
});

// ---------- Capa ilustrada (imagem do tema central da música, para o vídeo de status) ----------
const illustrating = new Set();
// Cria a capa ilustrada de uma música (a IA descreve o tema da letra, a GPU desenha) e guarda
async function makeIllustration(songId) {
  const song = (await loadSongs()).find((s) => s.id === songId);
  if (!song) throw new Error("Música não encontrada.");
  if (illustrating.has(song.id)) throw Object.assign(new Error("A capa desta música já está sendo criada."), { busy: true });
  illustrating.add(song.id);
  try {
    const o = song.options || {};
    let prompt;
    try {
      prompt = await illustrationPrompt({ title: song.title, sections: song.sections || [], mode: o.mode, moment: o.moment, season: o.season, genre: song.genre, moods: o.moods || [] });
    } catch (e) {
      console.log("Descrição da capa pela IA falhou, usando o título:", e.message);
      prompt = `symbolic ${o.mode === "catolica" ? "sacred christian " : ""}illustration inspired by the theme "${song.title}", warm cinematic light, oil painting, peaceful, no people, no text`;
    }
    const img = await illustrate(prompt);
    const dir = studio.mediaDir(song.id);
    await fs.mkdir(dir, { recursive: true });
    const name = `capa-${Date.now()}.jpg`;
    await fs.writeFile(path.join(dir, name), img);
    const illustration = { url: `/audio/media/${song.id}/${name}`, file: name, prompt, at: new Date().toISOString() };
    let old = null;
    await updateSongs((songs) => songs.map((s) => (s.id === song.id ? ((old = s.illustration), { ...s, illustration }) : s)));
    if (old?.file && old.file !== name) await fs.rm(path.join(dir, old.file), { force: true });
    return illustration;
  } finally {
    illustrating.delete(song.id);
  }
}
// fila das capas automáticas (uma de cada vez, sem atrasar a criação das músicas)
let illustrationChain = Promise.resolve();
function autoIllustrate(songId) {
  illustrationChain = illustrationChain
    .then(() => makeIllustration(songId))
    .then((ill) => console.log("Capa ilustrada pronta:", ill.prompt.slice(0, 70)))
    .catch((e) => !e.busy && console.log("Capa automática falhou:", e.message));
}
// músicas que ainda não têm capa ilustrada (as antigas e as que perderam a capa ao serem refeitas)
// Varredura: músicas antigas (de antes da batida do teclado) ganham o estilo do PSR-E343 que mais
// combina com elas. Fica marcado como "sugerido", porque não foram gravadas com essa batida.
async function keyboardMissing() {
  let n = 0;
  await updateSongs((songs) =>
    songs.map((s) => {
      if (s.keyboard) return s;
      const kb = pickKeyboardStyle({ ...(s.options || {}), genre: s.options?.genre || s.genre, keyboardStyle: 0 });
      n++;
      return { ...s, keyboard: { model: KEYBOARD_MODEL, n: kb.n, name: kb.name, cat: kb.cat, auto: true, suggested: true } };
    }),
  );
  if (n) console.log(`Teclado: batida sugerida para ${n} música(s) antiga(s)`);
  return n;
}
app.post("/api/keyboard/backfill", async (_req, res) => res.json({ updated: await keyboardMissing() }));
async function illustrateMissing() {
  const songs = await loadSongs();
  const queued = new Set(queue.map((q) => q.input?.replaceId).filter(Boolean)); // essas ganham capa quando forem refeitas
  for (const s of songs) if (!s.illustration && !queued.has(s.id)) autoIllustrate(s.id);
}
app.post("/api/songs/:id/illustration", async (req, res) => {
  const song = (await loadSongs()).find((s) => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: "Música não encontrada." });
  if (song.illustration && !req.body?.novo) return res.json(song.illustration);
  try {
    res.json(await makeIllustration(song.id));
  } catch (e) {
    res.status(e.busy ? 409 : 502).json({ error: e.message });
  }
});

// ---------- Registro de Criação (gratuito: carimbo de tempo no OpenTimestamps) ----------
const REG_DIR = path.join(DATA_DIR, "registros");
const fileSafe = (t) => String(t || "musica").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w -]+/g, "").trim().slice(0, 60) || "musica";
app.post("/api/songs/:id/registro", async (req, res) => {
  const song = (await loadSongs()).find((s) => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: "Música não encontrada." });
  const author = String(req.body?.author || getSettings().autorNome || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (author.length < 3) return res.status(400).json({ error: "Escreva o seu nome completo para o registro." });
  let audio;
  try {
    audio = await fs.readFile(path.join(SONGS_DIR, `${song.id}.mp3`));
  } catch {
    return res.status(404).json({ error: "O áudio desta música não foi encontrado." });
  }
  const audioSha = createHash("sha256").update(audio).digest("hex");
  // o mesmo áudio e o mesmo nome já registrados: devolve o registro existente (a data não muda)
  const same = (song.registros || []).find((r) => r.audioSha256 === audioSha && r.author === author);
  if (same && !req.body?.novo) return res.json(same);
  try {
    const r = await createRegistro(song, { author, audio });
    await fs.mkdir(REG_DIR, { recursive: true });
    const file = `${song.id}-${Date.parse(r.at)}`;
    await fs.writeFile(path.join(REG_DIR, file + ".txt"), r.text);
    await fs.writeFile(path.join(REG_DIR, file + ".txt.ots"), r.ots);
    const meta = { at: r.at, author, audioSha256: r.audioSha256, docSha256: r.docSha256, calendars: r.calendars, file };
    await updateSongs((songs) => songs.map((s) => (s.id === song.id ? { ...s, registros: [...(s.registros || []), meta] } : s)));
    if (getSettings().autorNome !== author) await saveSettings({ autorNome: author });
    res.json(meta);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
const regFile = async (req) => {
  const song = (await loadSongs()).find((s) => s.id === req.params.id);
  const reg = song?.registros?.find((r) => r.file === req.params.file);
  return { song, reg };
};
app.get("/api/songs/:id/registro/:file/texto", async (req, res) => {
  const { song, reg } = await regFile(req);
  if (!reg) return res.status(404).send("Registro não encontrado.");
  res.download(path.join(REG_DIR, reg.file + ".txt"), `${fileSafe(song.title)} - Registro de Criacao.txt`);
});
app.get("/api/songs/:id/registro/:file/prova", async (req, res) => {
  const { song, reg } = await regFile(req);
  if (!reg) return res.status(404).send("Registro não encontrado.");
  res.download(path.join(REG_DIR, reg.file + ".txt.ots"), `${fileSafe(song.title)} - Registro de Criacao.txt.ots`);
});
app.get("/api/songs/:id/registro/:file/pagina", async (req, res) => {
  const { song, reg } = await regFile(req);
  if (!reg) return res.status(404).send("Registro não encontrado.");
  const text = await fs.readFile(path.join(REG_DIR, reg.file + ".txt"), "utf8");
  res.type("html").send(registroPage({ song, reg, text, base: `/api/songs/${song.id}/registro/${reg.file}` }));
});

// Refazer a música do mesmo jeito (letra, estilo, vozes), com revisão de pronúncia pelo Whisper.
// A nova gravação substitui a antiga no mesmo lugar.
// Tradução da letra (a original não muda): fica guardada na música, uma por idioma
async function songTranslation(song, lang, force = false) {
  if (!force && song.translations?.[lang]) return song.translations[lang];
  if (!song.sections?.length) throw Object.assign(new Error("Esta música não tem letra para traduzir."), { status: 400 });
  const tr = await translateLyrics({ plan: { title: song.title, sections: song.sections }, from: song.spec?.language || "pt", to: lang, options: song.options || {} });
  const entry = { ...tr, at: new Date().toISOString() };
  await updateSongs((songs) => songs.map((s) => (s.id === song.id ? { ...s, translations: { ...(s.translations || {}), [lang]: entry } } : s)));
  return entry;
}
app.post("/api/songs/:id/translate", async (req, res) => {
  const lang = String(req.body?.lang || "");
  if (!LANG_NAMES[lang]) return res.status(400).json({ error: "Escolha um idioma." });
  const song = (await loadSongs()).find((s) => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: "Música não encontrada." });
  try {
    res.json(await songTranslation(song, lang, Boolean(req.body?.force)));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    lyricsError(res, e);
  }
});
// Outra versão da mesma música (só violão, só piano, ao vivo na igreja): vira uma MÚSICA NOVA,
// com a mesma letra, tom e andamento; a original continua igual
app.post("/api/songs/:id/variant", async (req, res) => {
  const kind = String(req.body?.kind || "");
  const A = ARRANGEMENTS[kind];
  if (!A) return res.status(400).json({ error: "Escolha a versão." });
  const song = (await loadSongs()).find((s) => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: "Música não encontrada." });
  if (!song.options || !song.sections) return res.status(400).json({ error: "Esta música é antiga e não guardou como foi feita. Use ✎ Nova versão." });
  const o = cleanOptions(song.options);
  // andamento: "auto" = o planejador escolhe o do estilo; "slow"/"calm" = mais lenta; padrão: violão e piano um pouco mais calmos
  const mode = A.bpm || (kind === "violao" || kind === "piano" ? "calm" : "keep");
  const bpm = !o.bpm || mode === "keep" ? o.bpm : mode === "auto" ? 0 : Math.max(45, Math.round(o.bpm * (mode === "slow" ? 0.82 : 0.92)));
  const options = cleanOptions({
    ...o,
    arrangement: kind,
    genre: A.genre,
    genreTags: A.genreTags,
    instruments: [],
    instrumentTags: [],
    ...(A.voice ? { voice: A.voice } : {}),
    ...(A.voiceTags ? { voiceTags: A.voiceTags, voiceStyles: [] } : {}),
    keyboardStyle: A.kb || 0, // a batida do teclado é escolhida de novo, combinando com a versão
    quality: "high",
    bpm,
    tempo: bpm ? o.tempo : "auto",
  });
  const title = `${song.title} (${A.label.toLowerCase()})`;
  const id = randomUUID();
  enqueueSong(
    id,
    {
      plan: { title, styles: [], sections: song.sections, references: song.references || [], notes: song.notes || "" },
      duration: Number(song.spec?.requestedDuration) || song.duration || 120,
      language: song.spec?.language || "pt",
      meta: { cover: song.cover },
      options,
      reference: null,
      spec: { idea: song.spec?.idea, ideaParts: song.spec?.ideaParts, lyricsSource: song.spec?.lyricsSource, variantOf: { id: song.id, title: song.title, kind } },
    },
    { label: title },
  );
  res.json({ jobId: id, title });
});
// Gravar a música cantada no idioma escolhido: vira uma MÚSICA NOVA (a original continua igual)
app.post("/api/songs/:id/sing", async (req, res) => {
  const lang = String(req.body?.lang || "");
  if (!SUNG_LANGS.includes(lang)) return res.status(400).json({ error: "Escolha um idioma." });
  const song = (await loadSongs()).find((s) => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: "Música não encontrada." });
  if (!song.options) return res.status(400).json({ error: "Esta música é antiga e não guardou como foi feita. Use ✎ Nova versão." });
  let tr;
  try {
    tr = await songTranslation(song, lang);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    return lyricsError(res, e);
  }
  const id = randomUUID();
  enqueueSong(
    id,
    {
      plan: { title: tr.title, styles: song.styles || [], sections: tr.sections.map((x, k) => ({ name: song.sections[k]?.name || x.name, lines: x.lines })), references: song.references || [], notes: song.notes || "" },
      duration: Number(song.spec?.requestedDuration) || song.duration || 120,
      language: lang,
      meta: { cover: song.cover },
      options: cleanOptions(song.options),
      reference: null,
      spec: { idea: song.spec?.idea, ideaParts: song.spec?.ideaParts, lyricsSource: song.spec?.lyricsSource, translatedFrom: { id: song.id, title: song.title, lang: song.spec?.language || "pt" } },
      check: Boolean(hearingUrl()),
    },
    { label: `${tr.title} (${LANG_NAMES[lang]})` },
  );
  res.json({ jobId: id, title: tr.title });
});

app.post("/api/songs/:id/redo", async (req, res) => {
  const song = (await loadSongs()).find((s) => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: "Música não encontrada." });
  if (!song.options || !song.sections) return res.status(400).json({ error: "Esta música é antiga e não guardou como foi feita. Use ✎ Nova versão." });
  if (queue.some((q) => q.input?.replaceId === song.id)) return res.status(409).json({ error: "Esta música já está sendo refeita." });
  const check = req.body?.check !== false && Boolean(hearingUrl());
  const note = String(req.body?.note || "").trim().slice(0, 1500);
  const input = {
    plan: { title: song.title, styles: song.styles || [], sections: song.sections, references: song.references || [], notes: song.notes || "" },
    duration: Number(song.spec?.requestedDuration) || song.duration || 120,
    language: song.spec?.language || "pt",
    meta: { cover: song.cover },
    // "Melhorar esta" (nota de qualidade): grava em qualidade alta
    options: { ...cleanOptions(song.options), ...(req.body?.improve ? { quality: "high" } : {}) }, // normaliza opções de músicas antigas
    reference: null,
    spec: { idea: song.spec?.idea, ideaParts: song.spec?.ideaParts, lyricsSource: song.spec?.lyricsSource, note },
    check,
    replaceId: song.id,
  };
  const id = randomUUID();
  enqueueSong(id, input, { label: `${song.title} (refazendo${check ? " com revisão de pronúncia" : ""})` });
  res.json({ jobId: id, check });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Trabalho não encontrado." });
  if (job.isSong) job.progress = songPct(job);
  res.json(job);
});

app.get("/api/songs", async (_req, res) => res.json(await loadSongs()));

// Renomear / favoritar
app.patch("/api/songs/:id", async (req, res) => {
  const b = req.body || {};
  let updated = null;
  await updateSongs((songs) =>
    songs.map((s) => {
      if (s.id !== req.params.id) return s;
      updated = { ...s };
      if (typeof b.title === "string" && b.title.trim()) updated.title = b.title.trim().slice(0, 120);
      if (typeof b.favorite === "boolean") updated.favorite = b.favorite;
      return updated;
    }),
  );
  if (!updated) return res.status(404).json({ error: "Música não encontrada." });
  res.json(updated);
});

// ---------- Minhas letras (salvas para usar em outros arranjos) ----------
const LYRICS_DB = path.join(DATA_DIR, "lyrics.json");
async function loadLyricsLib() {
  if (!existsSync(LYRICS_DB)) return [];
  try {
    return JSON.parse(await fs.readFile(LYRICS_DB, "utf8"));
  } catch {
    return [];
  }
}
let lyricsWriting = Promise.resolve();
function updateLyricsLib(fn) {
  lyricsWriting = lyricsWriting.then(async () => fs.writeFile(LYRICS_DB, JSON.stringify(fn(await loadLyricsLib()), null, 2)));
  return lyricsWriting;
}
const cleanLyricEntry = (b) => ({
  title: String(b.title || "Sem título").trim().slice(0, 120) || "Sem título",
  text: String(b.text || "").slice(0, 20000),
  mode: b.mode === "livre" ? "livre" : "catolica",
  moment: String(b.moment || "").slice(0, 60),
  season: String(b.season || "").slice(0, 60),
  references: (Array.isArray(b.references) ? b.references : []).map((x) => String(x).slice(0, 80)).slice(0, 10),
  notes: String(b.notes || "").slice(0, 300),
  source: ["ia", "propria", "missal"].includes(b.source) ? b.source : "propria",
  // letras guardadas sozinhas pela Missa pronta / Terço (as que a pessoa salva ficam com "")
  auto: ["missa", "terco"].includes(b.auto) ? b.auto : "",
  group: String(b.group || "").slice(0, 120),
});
// Letras antigas: as que a Missa pronta guardou sozinha chegam em rajadas (várias no mesmo minuto).
// Marca essas como automáticas, para "Minhas letras" mostrar primeiro as que a pessoa salvou.
async function markAutoLyrics() {
  const list = await loadLyricsLib();
  if (!list.some((l) => l.auto === undefined)) return;
  const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const clusters = [];
  for (const l of sorted) {
    const last = clusters.at(-1);
    if (last && Date.parse(l.createdAt) - Date.parse(last.at(-1).createdAt) <= 120_000) last.push(l);
    else clusters.push([l]);
  }
  const auto = new Map();
  for (const c of clusters)
    if (c.length >= 4) {
      const day = new Date(Date.parse(c[0].createdAt) - 3 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("/");
      for (const l of c) auto.set(l.id, `Missa pronta de ${day}`);
    }
  await updateLyricsLib((all) => all.map((l) => (l.auto !== undefined ? l : { ...l, auto: auto.has(l.id) ? "missa" : "", group: auto.get(l.id) || l.group || "" })));
  console.log(`Minhas letras: ${auto.size} letra(s) antigas marcadas como da Missa pronta`);
}
setTimeout(() => markAutoLyrics().catch((e) => console.log("Marcar letras automáticas falhou:", e.message)), 8000).unref();
app.get("/api/lyrics-lib", async (_req, res) => res.json(await loadLyricsLib()));
app.post("/api/lyrics-lib", async (req, res) => {
  const entry = cleanLyricEntry(req.body || {});
  if (!entry.text.trim()) return res.status(400).json({ error: "A letra está vazia." });
  const item = { id: randomUUID(), ...entry, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await updateLyricsLib((list) => [item, ...list]);
  res.json(item);
});
app.patch("/api/lyrics-lib/:id", async (req, res) => {
  let updated = null;
  await updateLyricsLib((list) =>
    list.map((l) => (l.id === req.params.id ? (updated = { ...l, ...cleanLyricEntry({ ...l, ...req.body }), updatedAt: new Date().toISOString() }) : l)),
  );
  if (!updated) return res.status(404).json({ error: "Letra não encontrada." });
  res.json(updated);
});
app.delete("/api/lyrics-lib/:id", async (req, res) => {
  await updateLyricsLib((list) => list.filter((l) => l.id !== req.params.id));
  res.json({ ok: true });
});

// ---------- Repertórios da Missa (lista de cantos de uma celebração) ----------
const SETLISTS_DB = path.join(DATA_DIR, "setlists.json");
async function loadSetlists() {
  if (!existsSync(SETLISTS_DB)) return [];
  try {
    return JSON.parse(await fs.readFile(SETLISTS_DB, "utf8"));
  } catch {
    return [];
  }
}
let setlistWriting = Promise.resolve();
function updateSetlists(fn) {
  setlistWriting = setlistWriting.then(async () => fs.writeFile(SETLISTS_DB, JSON.stringify(fn(await loadSetlists()), null, 2)));
  return setlistWriting;
}
const cleanSetlist = (b) => ({
  title: String(b.title || "Missa").trim().slice(0, 120) || "Missa",
  date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : "",
  season: String(b.season || "").slice(0, 60),
  notes: String(b.notes || "").slice(0, 500),
  items: (Array.isArray(b.items) ? b.items : []).slice(0, 40).map((it) => ({
    moment: String(it.moment || "").slice(0, 60),
    kind: it.kind === "lyric" ? "lyric" : it.kind === "song" ? "song" : "",
    ref: String(it.ref || "").slice(0, 60),
    note: String(it.note || "").slice(0, 200),
  })),
});
app.get("/api/setlists", async (_req, res) => res.json(await loadSetlists()));
app.post("/api/setlists", async (req, res) => {
  const item = { id: randomUUID(), ...cleanSetlist(req.body || {}), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await updateSetlists((list) => [item, ...list]);
  res.json(item);
});
app.put("/api/setlists/:id", async (req, res) => {
  let updated = null;
  await updateSetlists((list) =>
    list.map((s) => (s.id === req.params.id ? (updated = { ...s, ...cleanSetlist(req.body || {}), updatedAt: new Date().toISOString() }) : s)),
  );
  if (!updated) return res.status(404).json({ error: "Repertório não encontrado." });
  res.json(updated);
});
app.delete("/api/setlists/:id", async (req, res) => {
  await updateSetlists((list) => list.filter((s) => s.id !== req.params.id));
  res.json({ ok: true });
});

// ---------- Álbuns (coleções de músicas da biblioteca) ----------
// Cada Missa pronta vira um álbum sozinha (com as músicas já gravadas dela, na ordem da Missa).
// Um álbum automático apagado não volta: o repertório fica na lista "dismissed".
const ALBUMS_DB = path.join(DATA_DIR, "albums.json");
async function loadAlbumsDb() {
  try {
    const j = JSON.parse(await fs.readFile(ALBUMS_DB, "utf8"));
    return { albums: Array.isArray(j.albums) ? j.albums : [], dismissed: Array.isArray(j.dismissed) ? j.dismissed : [] };
  } catch {
    return { albums: [], dismissed: [] };
  }
}
let albumWriting = Promise.resolve();
function updateAlbums(fn) {
  const run = albumWriting.then(async () => {
    const db = fn(await loadAlbumsDb()) || {};
    await fs.writeFile(ALBUMS_DB, JSON.stringify(db, null, 2));
    return db;
  });
  albumWriting = run.catch(() => {});
  return run;
}
const ALBUM_COLORS = ["#7c3aed", "#db2777", "#ea580c", "#0891b2", "#16a34a", "#ca8a04", "#4f46e5", "#be123c"];
const cleanAlbum = (b, songIds) => ({
  title: String(b.title || "Novo álbum").trim().slice(0, 100) || "Novo álbum",
  description: String(b.description || "").trim().slice(0, 600),
  color: ALBUM_COLORS.includes(b.color) ? b.color : ALBUM_COLORS[0],
  songIds: [...new Set((Array.isArray(b.songIds) ? b.songIds : []).map(String))].filter((id) => songIds.has(id)).slice(0, 300),
});
// cria/atualiza os álbuns das Missas prontas e tira músicas que não existem mais
async function syncAlbums() {
  const [setlists, songs] = await Promise.all([loadSetlists(), loadSongs()]);
  const ids = new Set(songs.map((s) => s.id));
  const db = await loadAlbumsDb();
  let changed = false;
  for (const a of db.albums) {
    const keep = a.songIds.filter((id) => ids.has(id));
    if (keep.length !== a.songIds.length) (a.songIds = keep), (changed = true);
  }
  for (const sl of setlists) {
    if (!/Missa pronta/i.test(sl.notes || "") || db.dismissed.includes(sl.id)) continue;
    const recorded = sl.items.filter((it) => it.kind === "song" && ids.has(it.ref)).map((it) => it.ref);
    if (!recorded.length) continue;
    let a = db.albums.find((x) => x.setlistId === sl.id);
    if (!a) {
      a = { id: randomUUID(), title: sl.title, description: sl.notes.replace(/ · Montada pela Missa pronta do ACAIAMUSIC$/, ""), color: ALBUM_COLORS[db.albums.length % ALBUM_COLORS.length], songIds: [], setlistId: sl.id, removed: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      db.albums.unshift(a);
      changed = true;
    }
    for (const id of recorded) if (!a.songIds.includes(id) && !(a.removed || []).includes(id)) (a.songIds.push(id), (changed = true));
  }
  if (changed) await updateAlbums(() => db);
  return db.albums;
}
app.get("/api/albums", async (_req, res) => res.json(await syncAlbums()));
app.post("/api/albums", async (req, res) => {
  const ids = new Set((await loadSongs()).map((s) => s.id));
  const now = new Date().toISOString();
  const album = { id: randomUUID(), ...cleanAlbum(req.body || {}, ids), removed: [], createdAt: now, updatedAt: now };
  if (!req.body?.color) album.color = ALBUM_COLORS[Math.floor(Math.random() * ALBUM_COLORS.length)];
  await updateAlbums((db) => ({ ...db, albums: [album, ...db.albums] }));
  res.json(album);
});
app.put("/api/albums/:id", async (req, res) => {
  const ids = new Set((await loadSongs()).map((s) => s.id));
  let updated = null;
  await updateAlbums((db) => ({
    ...db,
    albums: db.albums.map((a) => {
      if (a.id !== req.params.id) return a;
      const next = cleanAlbum({ ...a, ...req.body }, ids);
      // música tirada de um álbum de Missa não volta sozinha
      const removed = [...new Set([...(a.removed || []), ...a.songIds.filter((x) => !next.songIds.includes(x))])].filter((x) => !next.songIds.includes(x));
      return (updated = { ...a, ...next, removed, updatedAt: new Date().toISOString() });
    }),
  }));
  if (!updated) return res.status(404).json({ error: "Álbum não encontrado." });
  res.json(updated);
});
// Juntar álbuns: as músicas dos outros vêm para este (na ordem, sem repetir); os outros podem
// ser apagados ou ficar como estão
app.post("/api/albums/:id/merge", async (req, res) => {
  const from = (Array.isArray(req.body?.from) ? req.body.from : []).map(String).filter((x) => x !== req.params.id);
  const remove = req.body?.remove === true;
  if (!from.length) return res.status(400).json({ error: "Escolha pelo menos um álbum para juntar." });
  const ids = new Set((await loadSongs()).map((s) => s.id));
  let target = null;
  await updateAlbums((db) => {
    const t = db.albums.find((a) => a.id === req.params.id);
    if (!t) return db;
    const sources = from.map((id) => db.albums.find((a) => a.id === id)).filter(Boolean);
    const songIds = [...new Set([...t.songIds, ...sources.flatMap((a) => a.songIds)])].filter((x) => ids.has(x)).slice(0, 300);
    target = { ...t, songIds, removed: (t.removed || []).filter((x) => !songIds.includes(x)), updatedAt: new Date().toISOString() };
    const gone = new Set(remove ? sources.map((a) => a.id) : []);
    const dismissed = [...new Set([...db.dismissed, ...sources.filter((a) => gone.has(a.id) && a.setlistId).map((a) => a.setlistId)])];
    return { albums: db.albums.filter((a) => !gone.has(a.id)).map((a) => (a.id === t.id ? target : a)), dismissed };
  });
  if (!target) return res.status(404).json({ error: "Álbum não encontrado." });
  res.json({ album: target, removed: remove ? from : [] });
});
app.delete("/api/albums/:id", async (req, res) => {
  await updateAlbums((db) => {
    const a = db.albums.find((x) => x.id === req.params.id);
    return { albums: db.albums.filter((x) => x.id !== req.params.id), dismissed: a?.setlistId ? [...new Set([...db.dismissed, a.setlistId])] : db.dismissed };
  });
  res.json({ ok: true });
});

// ---------- Gravar as músicas dos cantos que estão só com letra ----------
const saveSetlistItem = (setlistId, i, patch) =>
  updateSetlists((list) => list.map((s) => (s.id === setlistId ? { ...s, items: s.items.map((it, k) => (k === i ? { ...it, ...patch } : it)), updatedAt: new Date().toISOString() } : s)));

// Letra salva ("[Refrão]\nlinha…") -> plano de música; tira acordes [G] de dentro dos versos
function textToPlan(title, text) {
  const sections = [];
  let cur = null;
  for (const raw of String(text || "").split("\n")) {
    const h = /^\s*\[([^\[\]]{2,40})\]\s*$/.exec(raw);
    if (h && !/^[A-G](#|b)?[\w°º+/()#]*$/.test(h[1].trim())) {
      sections.push((cur = { name: h[1].trim(), lines: [] }));
      continue;
    }
    const line = raw.replace(/\[[A-G](#|b)?[\w°º+/()#]{0,10}\]/g, "").replace(/\s+/g, " ").trim();
    if (!line || /^([A-G](#|b)?[\w°º+/()#]*\s*)+$/.test(line)) continue; // linha só de acordes
    if (!cur) sections.push((cur = { name: "Estrofe", lines: [] }));
    cur.lines.push(line);
  }
  return cleanPlan({ title, sections: sections.filter((s) => s.lines.length) }, false);
}

// todo: [{ i, moment, plan }] — põe tudo na fila de criação (que grava no disco e tenta de novo se falhar)
// e acompanha até cada canto terminar; a própria fila troca a letra pela música no repertório.
async function recordItems(setlistId, todo, b, set, job, idea) {
  const musicOpts = (moment) =>
    cleanOptions({ mode: "catolica", moment, season: b.season, occasion: b.occasion, genre: b.genre, genreTags: b.genreTags, voice: b.voice, voiceTags: b.voiceTags ? [b.voiceTags] : [], quality: "high" });
  const tasks = todo.map((t) => {
    const sid = randomUUID();
    enqueueSong(sid, { plan: t.plan, duration: b.duration, language: "pt", meta: {}, options: musicOpts(t.moment), reference: null, spec: { idea, lyricsSource: t.plan.official ? "missal" : "ia" } }, { setlist: { id: setlistId, i: t.i }, label: t.moment });
    return { sid, t };
  });
  const base = job.step || 0;
  for (;;) {
    await sleep(3000);
    let finished = 0;
    let partial = 0;
    let msg = "";
    for (const [n, { sid, t }] of tasks.entries()) {
      const sj = jobs.get(sid);
      const k = job.items.findIndex((x) => x.i === t.i);
      const prev = k >= 0 ? job.items[k] : { i: t.i, moment: t.moment, title: t.plan.title };
      let next = prev;
      if (sj?.status === "done") next = { ...prev, kind: "song", songId: sj.song.id, error: undefined };
      else if ((sj?.status === "error" || sj?.status === "canceled")) next = { ...prev, error: sj.error || "falhou" };
      if (k >= 0) job.items[k] = next;
      else job.items.push(next);
      if (sj?.status === "done" || sj?.status === "error" || sj?.status === "canceled") finished++;
      else partial += songPct(sj) / 100;
      if (sj?.status !== "done" && sj?.status !== "error" && sj?.status !== "canceled" && !msg && sj && sj.status !== "queued") msg = `${t.moment} (${n + 1}/${tasks.length}) · ${sj.message}`;
    }
    set({ step: base + finished, progress: Math.min(99, Math.floor(((base + finished + partial) / (job.total || tasks.length)) * 100)), message: msg || `Na fila de criação · ${finished}/${tasks.length} prontas` });
    if (finished === tasks.length) break;
  }
}

// Botão do repertório: grava as músicas dos cantos que ainda são só letra (todos ou um só)
app.post("/api/setlists/:id/record", async (req, res) => {
  const b = req.body || {};
  const sl = (await loadSetlists()).find((s) => s.id === req.params.id);
  if (!sl) return res.status(404).json({ error: "Repertório não encontrado." });
  const lib = await loadLyricsLib();
  const only = Array.isArray(b.indices) ? new Set(b.indices.map(Number)) : null;
  const todo = sl.items
    .map((it, i) => ({ it, i }))
    .filter(({ it, i }) => it.kind === "lyric" && (!only || only.has(i)))
    .map(({ it, i }) => {
      const l = lib.find((x) => x.id === it.ref);
      return l && { i, moment: it.moment, plan: { ...textToPlan(l.title, l.text), official: l.source === "missal" } };
    })
    .filter((t) => t && t.plan.sections.length);
  if (!todo.length) return res.status(400).json({ error: "Não há cantos só com letra para gravar neste repertório." });
  const id = randomUUID();
  const job = { status: "generating", message: "Preparando…", step: 0, total: todo.length, items: todo.map((t) => ({ i: t.i, moment: t.moment, title: t.plan.title, kind: "lyric" })), setlistId: sl.id, createdAt: Date.now() };
  jobs.set(id, job);
  const set = (p) => Object.assign(job, p, { updatedAt: Date.now() });
  res.json({ jobId: id, count: todo.length });
  try {
    await recordItems(sl.id, todo, { ...b, season: sl.season, occasion: sl.title, duration: Math.max(MIN_SECONDS, Math.min(240, Number(b.duration) || 120)) }, set, job, `Repertório · ${sl.title}`);
    const ok = job.items.filter((x) => x.kind === "song").length;
    set({ status: "done", progress: 100, message: ok === todo.length ? "Músicas gravadas!" : `${ok} de ${todo.length} músicas gravadas.` });
  } catch (e) {
    set({ status: "error", error: e?.message || "Não consegui gravar." });
  }
});

// ---------- Missa pronta do dia ----------
app.get("/api/liturgy", async (req, res) => res.json(await getLiturgy(String(req.query.date || ""))));

// Escreve todas as letras da Missa do dia (e, se pedido, grava as músicas), monta o repertório
app.post("/api/mass-ready", async (req, res) => {
  const b = req.body || {};
  const lit = await getLiturgy(String(b.date || ""));
  const plan = massPlan(lit, { original: b.original !== false });
  const withMusic = b.withMusic === true;
  const duration = Math.max(MIN_SECONDS, Math.min(240, Number(b.duration) || 120));
  const id = randomUUID();
  const job = { status: "generating", message: "Lendo a liturgia do dia…", step: 0, total: plan.length * (withMusic ? 2 : 1), items: [], createdAt: Date.now() };
  jobs.set(id, job);
  const set = (p) => Object.assign(job, p, { updatedAt: Date.now() });
  res.json({ jobId: id, liturgy: lit });

  const nice = lit.title || `Missa de ${lit.date.split("-").reverse().join("/")}`;
  const setlist = {
    id: randomUUID(),
    ...cleanSetlist({ title: nice, date: lit.date, season: lit.season, notes: [lit.color && `Cor: ${lit.color}`, lit.readings?.gospel?.ref && `Evangelho: ${lit.readings.gospel.ref}`, "Montada pela Missa pronta do ACAIAMUSIC"].filter(Boolean).join(" · "), items: plan.map((p) => ({ moment: p.moment })) }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await updateSetlists((list) => [setlist, ...list]);
  const saveItem = (i, patch) => updateSetlists((list) => list.map((s) => (s.id === setlist.id ? { ...s, items: s.items.map((it, k) => (k === i ? { ...it, ...patch } : it)), updatedAt: new Date().toISOString() } : s)));
  set({ setlistId: setlist.id });

  const options = (moment) =>
    cleanOptions({
      mode: "catolica", moment, season: lit.season, occasion: lit.title,
      genre: b.genre, genreTags: b.genreTags, voice: b.voice, voiceTags: b.voiceTags ? [b.voiceTags] : [], quality: "high",
    });
  try {
    const plans = [];
    // 1) letras, uma por momento (o compositor gratuito pede pausas: espera e tenta de novo)
    for (const [i, p] of plan.entries()) {
      set({ step: job.step + 1, progress: Math.floor((i / job.total) * 100), message: `Compondo a letra · ${p.moment}` });
      const o = { ...options(p.moment), reading: p.reading };
      let lyr = p.fixed ? cleanPlan(p.fixed, false) : null;
      for (let t = 0; t < 4 && !lyr; t++) {
        try {
          // cantos compostos: no mínimo refrão + 3 estrofes (o tamanho "completo" do compositor)
          lyr = await writeLyrics({ idea: p.idea || `Inspire-se na liturgia de hoje: ${lit.title}`, options: o, language: "pt", duration: Math.max(duration, 200) });
        } catch (e) {
          if (!(e instanceof LyricsError) || t === 3) throw e;
          const wait = (e.retryAfter || 20) + 2;
          set({ message: `O compositor gratuito pediu uma pausa · ${p.moment} (${wait}s)` });
          await new Promise((r) => setTimeout(r, wait * 1000));
        }
      }
      const text = lyr.sections.map((s) => `[${s.name}]\n${s.lines.join("\n")}`).join("\n\n");
      const entry = { id: randomUUID(), ...cleanLyricEntry({ title: lyr.title, text, mode: "catolica", moment: p.moment, season: lit.season, references: lyr.references, notes: lyr.notes, source: lyr.official ? "missal" : "ia", auto: "missa", group: nice }), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await updateLyricsLib((list) => [entry, ...list]);
      await saveItem(i, { kind: "lyric", ref: entry.id });
      plans.push(lyr);
      job.items.push({ i, moment: p.moment, title: lyr.title, kind: "lyric" });
    }
    // 2) músicas (opcional): grava cada canto e troca a letra pela música no repertório
    if (withMusic) {
      const todo = plan.map((p, i) => ({ i, moment: p.moment, plan: plans[i] }));
      await recordItems(setlist.id, todo, { ...b, duration, occasion: lit.title, season: lit.season }, set, job, `Missa pronta · ${lit.title}`);
    }
    set({ status: "done", progress: 100, message: "Missa pronta!" });
  } catch (e) {
    console.error("Missa pronta:", e?.message || e);
    set({ status: "error", error: e?.message || "Não consegui montar a Missa." });
  }
});

// ---------- Música para uma pessoa (homenagem) ----------
// A pessoa conta a história de alguém e a ocasião; a IA compõe uma canção com o nome e a
// história, e ela entra na fila de criação. Depois dá para fazer o vídeo (história animada).
const TRIBUTES = {
  aniversario: { label: "Aniversário", genre: "Pop", genreTags: "uplifting pop", moods: ["Alegre", "Grato"], moodTags: ["joyful", "warm"], tone: "alegre e cheia de carinho, celebrando a vida da pessoa" },
  batizado: { label: "Batizado", genre: "Canto Litúrgico", genreTags: "gentle acoustic worship", moods: ["Terno", "Grato"], moodTags: ["tender", "peaceful"], tone: "terna, agradecendo a Deus pela vida da criança e pedindo a sua proteção" },
  comunhao: { label: "Primeira Comunhão", genre: "Louvor", genreTags: "gentle catholic worship", moods: ["Alegre", "Orante"], moodTags: ["joyful", "prayerful"], tone: "alegre e orante, celebrando o encontro com Jesus na Eucaristia" },
  crisma: { label: "Crisma", genre: "Louvor", genreTags: "modern catholic worship", moods: ["Confiante"], moodTags: ["hopeful", "uplifting"], tone: "confiante, sobre o Espírito Santo e a missão de testemunhar a fé" },
  quinze: { label: "15 anos", genre: "Pop", genreTags: "emotional pop ballad", moods: ["Emocionante"], moodTags: ["emotional", "hopeful"], tone: "emocionante, sobre a menina que vira mulher, os sonhos e a família" },
  casamento: { label: "Casamento", genre: "Balada", genreTags: "romantic wedding ballad", moods: ["Romântico"], moodTags: ["romantic", "tender"], tone: "romântica, sobre o amor do casal e a bênção de Deus para a nova família" },
  bodas: { label: "Bodas", genre: "Balada", genreTags: "romantic acoustic ballad", moods: ["Grato", "Romântico"], moodTags: ["nostalgic", "tender"], tone: "grata e romântica, lembrando a história do casal e os anos juntos" },
  maes: { label: "Dia das Mães", genre: "Balada", genreTags: "heartfelt acoustic ballad", moods: ["Grato"], moodTags: ["heartfelt", "warm"], tone: "agradecida e emocionante, sobre o amor e os cuidados da mãe" },
  pais: { label: "Dia dos Pais", genre: "Balada", genreTags: "heartfelt acoustic ballad", moods: ["Grato"], moodTags: ["heartfelt", "warm"], tone: "agradecida e emocionante, sobre o exemplo e o amor do pai" },
  formatura: { label: "Formatura", genre: "Pop", genreTags: "uplifting pop anthem", moods: ["Vitorioso"], moodTags: ["triumphant", "hopeful"], tone: "vitoriosa, sobre a caminhada, o esforço e o futuro" },
  luto: { label: "Saudade (7º dia / luto)", genre: "Canto Litúrgico", genreTags: "gentle sacred ballad", moods: ["Sereno", "Esperança"], moodTags: ["peaceful", "hopeful"], tone: "serena e cheia de esperança cristã na ressurreição, lembrando com carinho quem partiu, sem desespero" },
  amizade: { label: "Amizade", genre: "Pop acústico", genreTags: "acoustic pop", moods: ["Alegre"], moodTags: ["warm", "joyful"], tone: "alegre e sincera, sobre a amizade e as histórias vividas juntos" },
  agradecimento: { label: "Agradecimento", genre: "Louvor", genreTags: "acoustic worship", moods: ["Grato"], moodTags: ["grateful", "warm"], tone: "agradecida, reconhecendo o bem que a pessoa fez" },
};
const VOICE_TAGS = { Feminina: ["warm female vocals"], Masculina: ["warm male vocals"], Dueto: ["male and female duet vocals"], Coral: ["mixed choir"], Infantil: ["children's choir"] };
app.post("/api/tribute", async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 80);
  const T = TRIBUTES[b.occasion];
  const story = String(b.story || "").trim().slice(0, 2500);
  if (!name) return res.status(400).json({ error: "Escreva o nome da pessoa." });
  if (!T) return res.status(400).json({ error: "Escolha a ocasião." });
  if (story.length < 15) return res.status(400).json({ error: "Conte um pouco da história da pessoa (algumas frases)." });
  const voice = VOICE_TAGS[b.voice] ? b.voice : "Feminina";
  const from = String(b.from || "").trim().slice(0, 80);
  const options = cleanOptions({
    mode: "livre", genre: T.genre, genreTags: T.genreTags, moods: T.moods, moodTags: T.moodTags, voice, voiceTags: VOICE_TAGS[voice], quality: "high", form: "Refrão + estrofes",
  });
  const idea = `Canção de homenagem para ${name} (${T.label}). Tom: ${T.tone}.
Use o NOME "${name}" no refrão (de forma natural e cantável) e conte a história abaixo nas estrofes, com detalhes concretos dela (sem inventar fatos que não estão aqui).${from ? `\nQuem oferece a música: ${from} (pode aparecer na última estrofe, falando com ${name}).` : ""}
História: ${story}`;
  const id = randomUUID();
  const job = { status: "generating", message: `Compondo a canção para ${name}…`, createdAt: Date.now(), progress: 10 };
  jobs.set(id, job);
  res.json({ jobId: id });
  try {
    const plan = await writeLyrics({ idea, options, language: "pt", duration: 150 });
    const sid = randomUUID();
    enqueueSong(sid, { plan, duration: 150, language: "pt", meta: {}, options, reference: null, spec: { idea, lyricsSource: "ia", tribute: { name, occasion: b.occasion, from } } }, { label: `${plan.title} (para ${name})` });
    Object.assign(job, { status: "done", progress: 100, message: "Letra pronta! A música entrou na fila de criação.", title: plan.title, songJobId: sid, updatedAt: Date.now() });
  } catch (e) {
    Object.assign(job, { status: "error", error: e instanceof LyricsError ? e.message : "Não consegui compor agora: " + e.message, updatedAt: Date.now() });
  }
});

// ---------- Salmo de uma data ----------
// A pessoa escolhe a data; o app lê a liturgia desse dia e grava o Salmo com o texto exato.
// (Antes era automático todo dia; a pessoa preferiu escolher.)
const PSALM_DB = path.join(DATA_DIR, "salmo.json");
const brDate = (ms = Date.now()) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);
async function loadPsalmCfg() {
  try {
    return { voice: "Feminina", genre: "Canto Litúrgico", genreTags: "", days: {}, ...JSON.parse(await fs.readFile(PSALM_DB, "utf8")), enabled: false };
  } catch {
    return { voice: "Feminina", genre: "Canto Litúrgico", genreTags: "", days: {}, enabled: false };
  }
}
async function recordPsalm(date, { voice, genre, genreTags } = {}) {
  const cfg = await loadPsalmCfg();
  const lit = await getLiturgy(date);
  const ps = lit.readings?.psalm;
  const item = massPlan(lit, { original: true }).find((p) => p.moment === "Salmo Responsorial");
  if (!ps?.text || !item?.fixed) {
    const e = new Error(`A liturgia de ${date.split("-").reverse().join("/")} não trouxe o Salmo (a fonte gratuita só tem datas próximas). Tente outra data.`);
    e.status = 404;
    throw e;
  }
  const v = VOICE_TAGS[voice] ? voice : cfg.voice;
  const options = cleanOptions({ mode: "catolica", moment: "Salmo Responsorial", season: lit.season, occasion: lit.title, genre: genre || cfg.genre, genreTags: (genre ? genreTags : cfg.genreTags) || undefined, voice: v, voiceTags: VOICE_TAGS[v] || [], quality: "high" });
  const sid = randomUUID();
  enqueueSong(sid, { plan: { ...cleanPlan(item.fixed, false), title: `Salmo ${ps.ref} · ${date.split("-").reverse().join("/")}` }, duration: 150, language: "pt", meta: {}, options, reference: null, spec: { idea: `Salmo de ${date} · ${lit.title}`, lyricsSource: "missal", psalmOf: date } }, { label: `Salmo ${ps.ref} (${date.split("-").reverse().join("/")})` });
  cfg.days[date] = { songId: sid, ref: ps.ref, refrain: ps.refrain, title: lit.title, at: new Date().toISOString() };
  cfg.days = Object.fromEntries(Object.entries(cfg.days).sort().slice(-60));
  if (VOICE_TAGS[voice]) cfg.voice = voice;
  if (genre) (cfg.genre = String(genre).slice(0, 40)), (cfg.genreTags = String(genreTags || "").slice(0, 160));
  await fs.writeFile(PSALM_DB, JSON.stringify(cfg, null, 2));
  return cfg.days[date];
}
app.get("/api/salmo", async (_req, res) => {
  const cfg = await loadPsalmCfg();
  const songs = await loadSongs();
  const days = Object.entries(cfg.days)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, d]) => {
      const song = songs.find((s) => s.id === d.songId);
      return { date, ...d, song: song || null, pending: !song && queue.some((q) => q.id === d.songId) };
    })
    .filter((d) => d.song || d.pending);
  res.json({ voice: cfg.voice, genre: cfg.genre, today: brDate(), days });
});
// o texto do Salmo de uma data (para conferir antes de gravar)
app.get("/api/salmo/:date", async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.params.date) ? req.params.date : brDate();
  try {
    const lit = await getLiturgy(date);
    const ps = lit.readings?.psalm;
    if (!ps?.text) return res.status(404).json({ error: "Não achei o Salmo desta data na liturgia (a fonte gratuita só tem datas próximas)." });
    res.json({ date, ref: ps.ref, refrain: ps.refrain, text: ps.text, title: lit.title, season: lit.season });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/salmo/record", async (req, res) => {
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : brDate();
  try {
    res.json({ date, ...(await recordPsalm(date, b)) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------- Terço cantado: os 5 mistérios do dia, cada um com um canto curto ----------
const MYSTERIES = {
  gozosos: { name: "Mistérios Gozosos", list: [["A Anunciação do Anjo a Nossa Senhora", "Lc 1,26-38"], ["A Visitação de Nossa Senhora a sua prima Isabel", "Lc 1,39-56"], ["O Nascimento de Jesus em Belém", "Lc 2,1-20"], ["A Apresentação do Menino Jesus no Templo", "Lc 2,22-38"], ["A Perda e o Encontro do Menino Jesus no Templo", "Lc 2,41-52"]] },
  dolorosos: { name: "Mistérios Dolorosos", list: [["A Agonia de Jesus no Horto das Oliveiras", "Lc 22,39-46"], ["A Flagelação de Jesus", "Mc 15,15"], ["A Coroação de Espinhos", "Mt 27,27-31"], ["Jesus carregando a Cruz para o Calvário", "Jo 19,16-17"], ["A Crucifixão e Morte de Jesus", "Lc 23,33-46"]] },
  gloriosos: { name: "Mistérios Gloriosos", list: [["A Ressurreição de Jesus", "Mc 16,1-8"], ["A Ascensão de Jesus ao Céu", "At 1,6-11"], ["A Vinda do Espírito Santo sobre Maria e os Apóstolos", "At 2,1-13"], ["A Assunção de Nossa Senhora ao Céu", "Ap 12,1"], ["A Coroação de Nossa Senhora como Rainha do Céu e da Terra", "Ap 12,1"]] },
  luminosos: { name: "Mistérios Luminosos", list: [["O Batismo de Jesus no Rio Jordão", "Mt 3,13-17"], ["A Autorrevelação de Jesus nas Bodas de Caná", "Jo 2,1-12"], ["O Anúncio do Reino de Deus e o convite à conversão", "Mc 1,14-15"], ["A Transfiguração de Jesus", "Lc 9,28-36"], ["A Instituição da Eucaristia", "Lc 22,14-20"]] },
};
// domingo e quarta: gloriosos; segunda e sábado: gozosos; terça e sexta: dolorosos; quinta: luminosos
const MYSTERY_OF_DAY = ["gloriosos", "gozosos", "dolorosos", "gloriosos", "luminosos", "dolorosos", "gozosos"];
const ORD = ["1º", "2º", "3º", "4º", "5º"];
app.post("/api/terco", async (req, res) => {
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : brDate();
  const kind = MYSTERIES[b.kind] ? b.kind : MYSTERY_OF_DAY[new Date(date + "T12:00:00Z").getUTCDay()];
  const M = MYSTERIES[kind];
  const voice = VOICE_TAGS[b.voice] ? b.voice : "Feminina";
  const duration = Math.max(MIN_SECONDS, Math.min(150, Number(b.duration) || 90));
  const id = randomUUID();
  const job = { status: "generating", message: "Preparando o terço…", step: 0, total: 10, items: [], createdAt: Date.now() };
  jobs.set(id, job);
  const set = (p) => Object.assign(job, p, { updatedAt: Date.now() });
  const weekday = new Date(date + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
  const setlist = {
    id: randomUUID(),
    ...cleanSetlist({ title: `Terço cantado · ${M.name} (${weekday})`, date, notes: "Um canto curto para cada mistério, para cantar entre as dezenas. Montado pelo ACAIAMUSIC.", items: M.list.map(([t], i) => ({ moment: `${ORD[i]} mistério: ${t}`.slice(0, 60) })) }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await updateSetlists((list) => [setlist, ...list]);
  res.json({ jobId: id, setlistId: setlist.id, name: M.name });
  const saveItem = (i, patch) => updateSetlists((list) => list.map((s) => (s.id === setlist.id ? { ...s, items: s.items.map((it, k) => (k === i ? { ...it, ...patch } : it)), updatedAt: new Date().toISOString() } : s)));
  set({ setlistId: setlist.id });
  const o = cleanOptions({ mode: "catolica", moment: "Livre (tema religioso)", season: "", genre: b.genre || "Louvor", genreTags: b.genreTags || "gentle marian worship ballad", voice, voiceTags: VOICE_TAGS[voice], quality: "high", form: "Refrão + estrofes", moods: ["Orante"], moodTags: ["prayerful", "tender"] });
  try {
    const plans = [];
    for (const [i, [title, ref]] of M.list.entries()) {
      set({ step: i + 1, progress: Math.floor((i / 10) * 100), message: `Compondo o canto do ${ORD[i]} mistério: ${title}` });
      const idea = `Canto curto para o TERÇO, cantado no ${ORD[i]} ${M.name.replace("Mistérios", "Mistério").replace(/s$/, "")}: "${title}" (${ref}).
Uma estrofe que contempla a cena do mistério (o que aconteceu, com os personagens e o sentido para a nossa fé) e um refrão mariano CURTO (2 linhas), fácil de repetir entre as Ave-Marias, pedindo a intercessão de Nossa Senhora. Linguagem simples e orante. Não reescreva a Ave-Maria.`;
      let lyr = null;
      for (let t = 0; t < 4 && !lyr; t++) {
        try {
          lyr = await writeLyrics({ idea, options: { ...o, reading: `${title} (${ref})` }, language: "pt", duration });
        } catch (e) {
          if (!(e instanceof LyricsError) || t === 3) throw e;
          const wait = (e.retryAfter || 20) + 2;
          set({ message: `O compositor gratuito pediu uma pausa (${wait}s)…` });
          await new Promise((r) => setTimeout(r, wait * 1000));
        }
      }
      const text = lyr.sections.map((s) => `[${s.name}]\n${s.lines.join("\n")}`).join("\n\n");
      const entry = { id: randomUUID(), ...cleanLyricEntry({ title: lyr.title, text, mode: "catolica", moment: "Livre (tema religioso)", season: "", references: [ref, ...(lyr.references || [])], notes: `${M.name} · ${ORD[i]} mistério: ${title}`, source: "ia", auto: "terco", group: `Terço cantado · ${M.name} (${weekday})` }), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await updateLyricsLib((list) => [entry, ...list]);
      await saveItem(i, { kind: "lyric", ref: entry.id });
      plans.push(lyr);
      job.items.push({ i, moment: title, title: lyr.title, kind: "lyric" });
    }
    const todo = M.list.map(([title], i) => ({ i, moment: `${ORD[i]} mistério: ${title}`.slice(0, 60), plan: plans[i] }));
    await recordItems(setlist.id, todo, { ...b, voice, voiceTags: VOICE_TAGS[voice][0], genre: o.genre, genreTags: o.genreTags, duration }, set, job, `Terço cantado · ${M.name}`);
    set({ status: "done", progress: 100, message: "Terço pronto!" });
  } catch (e) {
    console.error("Terço cantado:", e?.message || e);
    set({ status: "error", error: e?.message || "Não consegui montar o terço." });
  }
});

// Cifra com letra (gerada por IA, no tom escolhido)
app.post("/api/songs/:id/chords", async (req, res) => {
  const song = (await loadSongs()).find((s) => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: "Música não encontrada." });
  if (!song.sections?.some((s) => s.lines.length)) return res.status(400).json({ error: "Música instrumental não tem letra para cifrar." });
  try {
    const key = String(req.body?.key || song.options?.key || "").slice(0, 10);
    let chords = null;
    if (hearingUrl() && req.body?.source !== "ia") {
      try {
        let heard = song.hearing;
        if (!heard?.words?.length) {
          heard = await listen(await fs.readFile(path.join(SONGS_DIR, `${song.id}.mp3`)), song.spec?.language || "pt");
          heard = { words: heard.words, chords: heard.chords, key: heard.key, tempo: heard.tempo };
          await updateSongs((songs) => songs.map((s) => (s.id === song.id ? { ...s, hearing: heard } : s)));
        }
        chords = chordSheetFromAudio(sungOrder(song.sections), heard);
      } catch (e) {
        console.log("Cifra pelo áudio não deu, usando a IA:", e.message);
      }
    }
    chords ||= await generateChords({ sections: song.sections, key, mode: song.options?.mode, genre: song.genre });
    await updateSongs((songs) => songs.map((s) => (s.id === song.id ? { ...s, chords } : s)));
    res.json(chords);
  } catch (e) {
    lyricsError(res, e);
  }
});

app.delete("/api/songs/:id", async (req, res) => {
  const songs = await loadSongs();
  const song = songs.find((s) => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: "Música não encontrada." });
  await fs.rm(path.join(SONGS_DIR, `${song.id}.mp3`), { force: true });
  await fs.rm(path.join(SONGS_DIR, `${song.id}-v2.mp3`), { force: true });
  await fs.rm(studio.mediaDir(song.id), { recursive: true, force: true });
  await updateSongs((list) => list.filter((s) => s.id !== song.id));
  res.json({ ok: true });
});

// Troca a versão principal pela alternativa (as duas vieram juntas do estúdio com GPU).
// Os arquivos trocam de lugar no disco, porque faixas, vídeo e karaokê leem sempre <id>.mp3;
// o que foi feito a partir da versão antiga (faixas separadas, tempo do karaokê) é refeito depois.
app.post("/api/songs/:id/swap-version", async (req, res) => {
  const song = (await loadSongs()).find((s) => s.id === req.params.id);
  if (!song?.alt) return res.status(404).json({ error: "Esta música não tem outra versão." });
  const main = path.join(SONGS_DIR, `${song.id}.mp3`), alt = path.join(SONGS_DIR, `${song.id}-v2.mp3`), tmp = main + ".swap";
  try {
    await fs.rename(main, tmp);
    await fs.rename(alt, main);
    await fs.rename(tmp, alt);
  } catch (e) {
    return res.status(500).json({ error: "Não consegui trocar as versões: " + e.message });
  }
  for (const f of ["instrumental", "vocals", "drums", "bass", "other"]) await fs.rm(path.join(studio.mediaDir(song.id), `${f}.mp3`), { force: true });
  let updated = null;
  await updateSongs((songs) =>
    songs.map((s) => {
      if (s.id !== song.id) return s;
      const rev = (s.rev || 0) + 1; // muda o endereço para o navegador não tocar o áudio antigo do cache
      const take = s.take === "B" ? "A" : "B";
      const { stems, timing, ...rest } = s;
      updated = {
        ...rest,
        rev,
        take,
        duration: s.alt.duration || s.duration,
        url: `/audio/${s.id}.mp3?v=${rev}`,
        alt: { url: `/audio/${s.id}-v2.mp3?v=${rev}`, duration: s.duration },
      };
      return updated;
    }),
  );
  res.json({ song: updated });
});

app.get("/api/status", async (_req, res) => {
  const kaggle = kaggleConfigured() ? await kaggleHealth() : { ok: false, error: "não configurado" };
  const modal = modalStatus(); // não liga a GPU só para ver o status (economiza crédito)
  const auto = { available: Boolean(KAGGLE_USER), user: KAGGLE_USER, ...autoState(), quota: KAGGLE_USER ? await kaggleQuota().catch(() => null) : null };
  res.json({ lyrics: true, music: Boolean(HF_TOKEN) || kaggle.ok || modal.ok || auto.available, kaggle, kaggleCpu: Boolean(getSettings().kaggleCpu), modal, auto, minSeconds: MIN_SECONDS, maxSeconds: MAX_SECONDS });
});

// Ligar / desligar o estúdio do Kaggle pelo app
app.post("/api/studio/start", (_req, res) => {
  if (!KAGGLE_USER) return res.status(400).json({ error: "Conta do Kaggle não conectada neste PC." });
  ensureStudio(() => {}).catch((e) => console.error("Estúdio:", e.message));
  res.json({ ok: true });
});
app.post("/api/studio/stop", async (_req, res) => {
  await stopStudio(getSettings().kaggleTopic);
  await saveSettings({ kaggleUrl: "", kaggleKey: "", kaggleTopic: "", pendingStudio: null });
  res.json({ ok: true });
});

// Servidores de música próprios (Kaggle e Modal): ver, testar e salvar
app.get("/api/settings", async (_req, res) => {
  const s = getSettings();
  const quota = KAGGLE_USER ? await kaggleQuota().catch(() => null) : null;
  res.json({
    kaggleUrl: s.kaggleUrl,
    hasKey: Boolean(s.kaggleKey),
    keyMasked: s.kaggleKey ? "•".repeat(10) + s.kaggleKey.slice(-4) : "",
    kaggleCpu: Boolean(s.kaggleCpu),
    studioSince: s.studioSince || 0,
    quota,
    modalUrl: s.modalUrl,
    hasModalKey: Boolean(s.modalKey),
  });
});
app.post("/api/settings", async (req, res) => {
  const b = req.body || {};
  const modal = b.server === "modal";
  const U = modal ? "modalUrl" : "kaggleUrl", K = modal ? "modalKey" : "kaggleKey";
  const url = String(b[U] || "").trim().replace(/\/+$/, "");
  const key = typeof b[K] === "string" && b[K].trim() ? b[K].trim() : getSettings()[K];
  if (!url) {
    await saveSettings({ [U]: "", [K]: "" });
    return res.json({ ok: true, cleared: true });
  }
  // o Modal pode estar desligado: o teste espera ele ligar (1ª vez demora)
  const h = modal ? await wakeModal(null, url, key) : await kaggleHealth(url, key);
  if (!h.ok) return res.status(400).json({ error: h.error });
  await saveSettings({ [U]: url, [K]: key });
  res.json({ ok: true });
});

// ---------- Pré-aquecimento do estúdio no Modal ----------
// A GPU do Modal leva ~4 min para ligar e carregar os modelos. Assim que a pessoa começa a
// escrever a ideia ou a letra, o app já manda ligar: quando ela tocar em "Criar", está pronto.
// Só liga se o Modal for mesmo ser usado (o Kaggle está sem GPU) e no máximo a cada 4 min.
let warmAt = 0;
app.post("/api/studio/warm", async (_req, res) => {
  res.json({ ok: true });
  if (!modalConfigured() || Date.now() - warmAt < 4 * 60 * 1000) return;
  const s = getSettings();
  if (kaggleConfigured() && !s.kaggleCpu && (await kaggleHealth()).ok) return; // Kaggle com GPU grátis: não gasta crédito
  warmAt = Date.now();
  console.log("Modal: pré-aquecendo o estúdio");
  fetch(`${s.modalUrl.replace(/\/+$/, "")}/health`, {
    headers: s.modalKey ? { Authorization: `Bearer ${s.modalKey}` } : {},
    signal: AbortSignal.timeout(10 * 60 * 1000),
  }).catch(() => {});
});

// ---------- Manter acordado ----------
// O Render grátis "dorme" depois de ~15 min sem visitas, mesmo com músicas na fila: o trabalho
// parava no meio e o estúdio do Kaggle ficava ligado sem ninguém usar. Enquanto houver trabalho
// (ou o estúdio estiver ligado e pronto para a próxima música), o app visita a si mesmo.
let lastStudioUse = 0;
const SELF_URL = (process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
const hasWork = () =>
  queue.length > 0 ||
  autoState().running ||
  Date.now() - lastStudioUse < 35 * 60 * 1000 ||
  [...jobs.values()].some((j) => !["done", "error", "canceled"].includes(j.status) && Date.now() - (j.updatedAt || j.createdAt) < 20 * 60 * 1000);
if (SELF_URL)
  setInterval(() => {
    if (hasWork()) fetch(SELF_URL + "/manifest.json", { signal: AbortSignal.timeout(20000) }).catch(() => {});
  }, 4 * 60 * 1000).unref();

// Limpa trabalhos antigos da memória
setInterval(() => {
  const old = Date.now() - 3600_000;
  const waiting = new Set(queue.map((q) => q.id)); // tarefas na fila nunca são esquecidas
  for (const [id, j] of jobs) if ((j.updatedAt || j.createdAt) < old && !waiting.has(id)) jobs.delete(id);
}, 600_000).unref();

app.listen(PORT, () => {
  console.log(`\nAcaiaMusic rodando em http://localhost:${PORT}`);
  if (queue.length) {
    console.log(`Retomando a fila de criação: ${queue.length} música(s)`);
    queue.forEach((q) => (q.notBefore = 0));
    pump();
  }
  console.log(`Letras: ${process.env.GEMINI_API_KEY ? "Gemini" : "Pollinations (gratuito)"}`);
  console.log(`Música: ${ACE_SPACE} ${HF_TOKEN ? "(com HF_TOKEN)" : "(SEM HF_TOKEN: configure no .env)"}`);
  setTimeout(() => keyboardMissing().catch((e) => console.log("Varredura do teclado falhou:", e.message)), 15000);
  // capas ilustradas que faltam (só com o Modal ligado, que desenha as imagens de graça nos créditos)
  if (getSettings().modalUrl) setTimeout(() => illustrateMissing().catch(() => {}), 60000);
});
