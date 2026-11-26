import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client, handle_file } from "@gradio/client";
import { OFFICIAL_TEXTS, LyricsError, buildTags, cleanOptions, cleanPlan, generateChords, refineLyrics, sanitizeChords, writeLyrics } from "./lyrics.js";
import { masterOrPlain } from "./audio.js";
import { registerStudio } from "./studio.js";
import { initSettings, getSettings, saveSettings, kaggleHealth, kaggleConfigured, generateKaggle, modalConfigured, modalStatus, wakeModal } from "./kaggle.js";
import { initAuto, autoState, kaggleUser, kaggleQuota, startStudio, stopStudio, requestGpu } from "./kaggle-auto.js";
import { getLiturgy, massPlan } from "./liturgy.js";
import { initPersist } from "./persist.js";

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

// arquivos públicos (o .well-known/assetlinks.json é exigido pelo APK do Android)
app.use(express.static(path.join(here, "public"), { dotfiles: "allow" }));
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
    const plan = await writeLyrics({ idea, options, language: String(b.language || "pt"), duration: Number(b.duration) || 60 });
    plan.styles = buildTags(options, plan.styles).split(", ").slice(0, 14);
    res.json(plan);
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

function toAceLyrics(sections) {
  const parts = sections.map((s) => {
    const tag = tagFor(s.name);
    const lines = s.lines.map((l) => singable(l.replace(/^\s*[\[(][^\])]{1,20}[\])]\s*[:\-–]?\s*/, ""))).filter(Boolean);
    const Tag = tag[0].toUpperCase() + tag.slice(1); // formato da documentação do ACE-Step: [Verse], [Chorus]…
    return lines.length ? `[${Tag}]\n${lines.join("\n")}` : `[${Tag}]\n[Instrumental]`;
  });
  const text = parts.join("\n\n");
  return sections.every((s) => !s.lines.length) ? "[instrumental]" : text;
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
const studio = registerStudio(app, { loadSongs, updateSongs, SONGS_DIR, jobs, HF_TOKEN });

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
      at("vocal_language", ["pt", "en", "es"].includes(language) ? language : "unknown");
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

async function runJob(id, { plan, duration, language, meta, options, reference, spec = {} }) {
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
      prompt: buildTags(options, plan.styles),
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
    set({ status: "saving", message: "Masterizando (volume e brilho de streaming)…" });
    // ffmpeg num processo à parte: converter/masterizar aqui dentro travava o servidor grátis
    // (o Render achava que o app tinha morrido e o reiniciava sem parar)
    // o estúdio com GPU devolve 2 versões: a 1ª é a principal, a 2ª fica para a pessoa comparar
    const [mainRaw, altRaw] = Array.isArray(raw) ? raw : [raw];
    const { mp3, seconds: realSeconds, mastered } = await masterOrPlain(mainRaw);
    if (job.canceled) throw new Error("CANCELED");
    await fs.writeFile(path.join(SONGS_DIR, `${id}.mp3`), mp3);
    let alt = null;
    if (altRaw) {
      set({ status: "saving", message: "Masterizando a 2ª versão…" });
      try {
        const a = await masterOrPlain(altRaw);
        await fs.writeFile(path.join(SONGS_DIR, `${id}-v2.mp3`), a.mp3);
        alt = { url: `/audio/${id}-v2.mp3`, duration: Math.round(a.seconds || 0) };
      } catch (e) {
        console.log("2ª versão não foi salva:", e.message);
      }
    }

    const song = {
      id,
      title: plan.title,
      styles: plan.styles,
      sections: plan.sections,
      references: plan.references,
      notes: plan.notes,
      ...(plan.chords ? { chords: plan.chords } : {}),
      ...(reference ? { reference: String(reference.name || "").slice(0, 120) } : {}),
      genre: options.genre,
      mood: options.moods.join(", "),
      voice: options.voice,
      options,
      cover: Number.isInteger(meta.cover) ? meta.cover : Math.floor(Math.random() * 1e6),
      favorite: false,
      duration: Math.round(realSeconds || seconds),
      createdAt: new Date().toISOString(),
      // Ficha técnica: tudo o que foi escolhido para criar esta música
      spec: {
        idea: String(spec.idea || "").slice(0, 1500),
        lyricsSource: ["ia", "propria", "missal"].includes(spec.lyricsSource) ? spec.lyricsSource : "ia",
        language,
        requestedDuration: seconds,
        quality: options.quality,
        engine: reference ? `${engine} · com áudio de referência` : engine,
        musicPrompt: params.prompt,
        mastered: Boolean(mastered),
        generationSeconds: Math.round((Date.now() - startedAt) / 1000),
      },
      url: `/audio/${id}.mp3`,
      ...(alt ? { alt } : {}),
    };
    await updateSongs((songs) => [song, ...songs]);
    set({ status: "done", message: "Pronta!", song });
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
function remember(t, status, extra = {}) {
  history.unshift({ id: t.id, label: t.label || t.input?.plan?.title || "Música", status, at: Date.now(), ...extra });
  history.length = Math.min(history.length, 12);
}
const queuePaused = () => Boolean(getSettings().queuePaused);

function enqueueSong(id, input, extra = {}) {
  queue.push({ id, input, tries: 0, notBefore: 0, addedAt: Date.now(), ...extra });
  jobs.set(id, { status: "queued", message: queue.length > 1 ? `Na fila de criação: ${queue.length - 1} música(s) antes desta` : "Aguardando…", createdAt: Date.now() });
  saveQueue();
  pump();
}
function markQueued() {
  queue.forEach((q, k) => {
    if (q === currentTask) return;
    const j = jobs.get(q.id) || jobs.set(q.id, { status: "queued", createdAt: Date.now() }).get(q.id);
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
      if (!jobs.has(t.id)) jobs.set(t.id, { status: "waiting", message: "Retomando…", createdAt: Date.now() });
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
      };
    }),
    history,
  };
};
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

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Trabalho não encontrado." });
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
});
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
    cleanOptions({ mode: "catolica", moment, season: b.season, occasion: b.occasion, genre: b.genre, genreTags: b.genreTags, voice: b.voice, voiceTags: b.voiceTags ? [b.voiceTags] : [], quality: "fast" });
  const tasks = todo.map((t) => {
    const sid = randomUUID();
    enqueueSong(sid, { plan: t.plan, duration: b.duration, language: "pt", meta: {}, options: musicOpts(t.moment), reference: null, spec: { idea, lyricsSource: t.plan.official ? "missal" : "ia" } }, { setlist: { id: setlistId, i: t.i }, label: t.moment });
    return { sid, t };
  });
  const base = job.step || 0;
  for (;;) {
    await sleep(3000);
    let finished = 0;
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
      else if (!msg && sj && sj.status !== "queued") msg = `${t.moment} (${n + 1}/${tasks.length}) · ${sj.message}`;
    }
    set({ step: base + finished, message: msg || `Na fila de criação · ${finished}/${tasks.length} prontas` });
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
    set({ status: "done", message: ok === todo.length ? "Músicas gravadas!" : `${ok} de ${todo.length} músicas gravadas.` });
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
  const plan = massPlan(lit);
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
      genre: b.genre, genreTags: b.genreTags, voice: b.voice, voiceTags: b.voiceTags ? [b.voiceTags] : [], quality: "fast",
    });
  try {
    const plans = [];
    // 1) letras, uma por momento (o compositor gratuito pede pausas: espera e tenta de novo)
    for (const [i, p] of plan.entries()) {
      set({ step: job.step + 1, message: `Compondo a letra · ${p.moment}` });
      const o = { ...options(p.moment), reading: p.reading };
      let lyr = p.fixed ? cleanPlan(p.fixed, false) : null;
      for (let t = 0; t < 4 && !lyr; t++) {
        try {
          lyr = await writeLyrics({ idea: p.idea || `Inspire-se na liturgia de hoje: ${lit.title}`, options: o, language: "pt", duration });
        } catch (e) {
          if (!(e instanceof LyricsError) || t === 3) throw e;
          const wait = (e.retryAfter || 20) + 2;
          set({ message: `O compositor gratuito pediu uma pausa · ${p.moment} (${wait}s)` });
          await new Promise((r) => setTimeout(r, wait * 1000));
        }
      }
      const text = lyr.sections.map((s) => `[${s.name}]\n${s.lines.join("\n")}`).join("\n\n");
      const entry = { id: randomUUID(), ...cleanLyricEntry({ title: lyr.title, text, mode: "catolica", moment: p.moment, season: lit.season, references: lyr.references, notes: lyr.notes, source: lyr.official ? "missal" : "ia" }), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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
    set({ status: "done", message: "Missa pronta!" });
  } catch (e) {
    console.error("Missa pronta:", e?.message || e);
    set({ status: "error", error: e?.message || "Não consegui montar a Missa." });
  }
});

// Cifra com letra (gerada por IA, no tom escolhido)
app.post("/api/songs/:id/chords", async (req, res) => {
  const song = (await loadSongs()).find((s) => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: "Música não encontrada." });
  if (!song.sections?.some((s) => s.lines.length)) return res.status(400).json({ error: "Música instrumental não tem letra para cifrar." });
  try {
    const key = String(req.body?.key || song.options?.key || "").slice(0, 10);
    const chords = await generateChords({ sections: song.sections, key, mode: song.options?.mode, genre: song.genre });
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
  console.log("Letras: Pollinations (gratuito)");
  console.log(`Música: ${ACE_SPACE} ${HF_TOKEN ? "(com HF_TOKEN)" : "(SEM HF_TOKEN: configure no .env)"}`);
});
