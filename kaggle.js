// Servidor de música próprio (ACE-Step 1.5 rodando no Kaggle, GPU gratuita)
// Conversa com a REST API oficial do ACE-Step 1.5: /release_task -> /query_result -> /v1/audio
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

let SETTINGS_FILE = "";
let settings = { kaggleUrl: "", kaggleKey: "", modalUrl: "", modalKey: "" };

export async function initSettings(dataDir) {
  SETTINGS_FILE = path.join(dataDir, "settings.json");
  if (existsSync(SETTINGS_FILE)) {
    try {
      settings = { ...settings, ...JSON.parse(await fs.readFile(SETTINGS_FILE, "utf8")) };
    } catch {}
  }
}
export const getSettings = () => settings;
export async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  return settings;
}

const cleanUrl = (u) => String(u || "").trim().replace(/\/+$/, "");
const authHeaders = (key) => (key ? { Authorization: `Bearer ${key}` } : {});

// Testa se o servidor está no ar. timeoutMs maior serve para "acordar" o Modal (liga a GPU sob demanda).
export async function kaggleHealth(url = settings.kaggleUrl, key = settings.kaggleKey, timeoutMs = 12000) {
  url = cleanUrl(url);
  if (!/^https:\/\/[\w.-]+(:\d+)?$/i.test(url)) return { ok: false, error: "Endereço inválido. Ele começa com https://" };
  try {
    const r = await fetch(`${url}/health`, { headers: authHeaders(key), signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 401 || r.status === 403) return { ok: false, error: "Chave incorreta." };
    if (!r.ok) return { ok: false, error: `O servidor respondeu ${r.status}.` };
    // confere a chave numa rota protegida
    const s = await fetch(`${url}/v1/stats`, { headers: authHeaders(key), signal: AbortSignal.timeout(timeoutMs) });
    if (s.status === 401 || s.status === 403) return { ok: false, error: "Chave incorreta." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Não encontrei o servidor. Ele está ligado?" };
  }
}
export const kaggleConfigured = () => Boolean(settings.kaggleUrl);
export const modalConfigured = () => Boolean(settings.modalUrl);

// O Modal desliga quando ninguém usa (para não gastar crédito). Sem pedir nada à GPU,
// só confere se o endereço é do Modal; para ligar de verdade use wakeModal.
export function modalStatus() {
  if (!settings.modalUrl) return { ok: false, error: "não configurado" };
  return { ok: true, sleeping: true };
}
// Liga a GPU do Modal e espera ela ficar pronta (1ª vez: baixa o modelo, pode levar ~10 min)
export async function wakeModal(set, url = settings.modalUrl, key = settings.modalKey) {
  const t0 = Date.now();
  let last = { ok: false, error: "não respondeu" };
  // o relógio anda sozinho: a resposta do Modal pode demorar minutos enquanto a GPU liga
  let stop = null; // música cancelada: para de esperar
  const tick = () => {
    const secs = Math.round((Date.now() - t0) / 1000);
    try {
      set?.({ status: "connecting", message: `Ligando o seu estúdio no Modal (GPU)… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} · costuma levar de 2 a 5 min quando estava desligado` });
    } catch (e) {
      stop = e;
    }
  };
  tick();
  const clock = setInterval(tick, 5000);
  try {
    while (Date.now() - t0 < 20 * 60 * 1000) {
      if (stop) throw stop;
      last = await kaggleHealth(url, key, 150000);
      if (stop) throw stop;
      if (last.ok || /Chave incorreta|Endereço inválido/.test(last.error)) return last;
      await new Promise((r) => setTimeout(r, 5000));
    }
    return last;
  } finally {
    clearInterval(clock);
  }
}

// "G major" -> "G Major"; "" -> ""
const keyScale = (k) => (k ? k.replace(/\b(major|minor)\b/i, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase()) : "");

export async function generateKaggle({ params, options, language, reference }, set, server = "kaggle") {
  const url = cleanUrl(server === "modal" ? settings.modalUrl : settings.kaggleUrl);
  const key = server === "modal" ? settings.modalKey : settings.kaggleKey;
  const where = server === "modal" ? "Modal" : "Kaggle";
  const fields = {
    prompt: params.prompt,
    lyrics: params.lyrics,
    audio_duration: params.audio_duration,
    vocal_language: ["pt", "en", "es", "it", "fr", "de", "la"].includes(language) ? language : "unknown",
    inference_steps: options.quality === "high" ? 16 : 8,
    batch_size: 1,
    audio_format: "mp3",
    task_type: "text2music",
    use_random_seed: true,
  };
  if (options.bpm) fields.bpm = options.bpm;
  const ks = keyScale(options.key);
  if (ks) fields.key_scale = ks;
  // Com GPU, o planejador musical (5Hz LM) compõe a estrutura e a melodia antes de gravar: soa
  // bem mais humano e natural (é o modo de melhor qualidade do ACE-Step 1.5). Mantemos a nossa
  // descrição e o idioma; no modo processador ele fica desligado (seria lento demais).
  const lm = server === "modal" || !settings.kaggleCpu;
  Object.assign(fields, lm
    ? { thinking: true, use_cot_caption: false, use_cot_language: false, lm_temperature: 0.85, lm_cfg_scale: 2.5 }
    : { thinking: false, use_cot_caption: false, use_cot_language: false });
  // Na GPU grátis do Kaggle grava 2 versões para a pessoa escolher. No Modal (crédito por
  // minuto) fica 1: o planejador compõe uma versão de cada vez e a 2ª quase dobrava a espera.
  if (lm && server !== "modal") fields.batch_size = 2;
  // Se o estúdio reiniciar no meio (ex.: foi republicado), o pedido some: envia de novo
  const sendWithRetry = async (f) => {
    for (let tries = 0; ; tries++) {
      try {
        return await submitAndWait({ fields: f, url, key, where, server, reference }, set);
      } catch (e) {
        if (!e.lost || tries >= 1) throw e;
        console.log(`${where}: o estúdio reiniciou e perdeu o pedido, enviando de novo`);
      }
    }
  };
  try {
    return await sendWithRetry(fields);
  } catch (e) {
    if (!fields.thinking || e.canceled || /CANCELED/.test(e.message)) throw e;
    console.log(`${where}: falhou com o planejador musical, tentando sem ele:`, e.message);
    set({ status: "generating", message: `Gravando de novo no ${where} (modo simples)…` });
    return sendWithRetry({ ...fields, thinking: false });
  }
}

async function submitAndWait({ fields, url, key, where, server, reference }, set) {

  set({ status: "queued", message: `Enviando para o seu estúdio no ${where}…` });
  let r;
  if (reference) {
    // com áudio de referência: multipart (o servidor aceita o arquivo no campo "reference_audio")
    const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(reference.data || ""));
    if (!m) throw new Error("Áudio de referência inválido.");
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    form.append("reference_audio", new Blob([Buffer.from(m[2], "base64")], { type: m[1] }), reference.name || "referencia.mp3");
    r = await fetch(`${url}/release_task`, { method: "POST", headers: authHeaders(key), body: form, signal: AbortSignal.timeout(120000) });
  } else {
    r = await fetch(`${url}/release_task`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(key) },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(60000),
    });
  }
  const sub = await r.json().catch(() => ({}));
  if (!r.ok || !sub?.data?.task_id) throw new Error(`${where} recusou o pedido: ${sub?.error || r.status}`);
  const taskId = sub.data.task_id;

  const t0 = Date.now();
  let lostSince = 0; // o estúdio responde "status 0 e lista vazia" para um pedido que não conhece
  for (;;) {
    await new Promise((res) => setTimeout(res, 3000));
    if (Date.now() - t0 > 120 * 60 * 1000) throw new Error(`O estúdio do ${where} demorou demais.`);
    // Na GPU do Modal uma música leva ~1-2 min: passou de 15, o pedido se perdeu; envia de novo
    if (server === "modal" && Date.now() - t0 > 15 * 60 * 1000) throw Object.assign(new Error("O estúdio do Modal não terminou a tempo."), { lost: true });
    let q;
    try {
      const qr = await fetch(`${url}/query_result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(key) },
        body: JSON.stringify({ task_id_list: [taskId] }),
        signal: AbortSignal.timeout(30000),
      });
      q = await qr.json();
    } catch {
      continue; // oscilação do túnel: tenta de novo
    }
    const item = Array.isArray(q?.data) ? q.data.find((d) => d.task_id === taskId) || q.data[0] : null;
    if (!item) continue;
    if (item.status === 0) {
      let known = true;
      try { known = JSON.parse(item.result || "[1]").length > 0; } catch {}
      if (!known) {
        lostSince ||= Date.now();
        if (Date.now() - lostSince > 45000) throw Object.assign(new Error(`O estúdio do ${where} reiniciou e perdeu o pedido.`), { lost: true });
      } else lostSince = 0;
      const secs = Math.round((Date.now() - t0) / 1000);
      const slow = server !== "modal" && settings.kaggleCpu ? " · modo processador, mais lento" : "";
      set({ status: "generating", message: `Compondo e gravando no seu estúdio (${where}${slow})… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` });
      continue;
    }
    if (item.status === 2) throw new Error(`O estúdio do ${where} não conseguiu gerar: ` + String(item.result || item.error || "erro").slice(0, 200));
    if (item.status === 1) {
      let list = item.result;
      if (typeof list === "string") list = JSON.parse(list);
      const files = (Array.isArray(list) ? list : [list]).map((x) => x?.file).filter(Boolean).slice(0, 2);
      if (!files.length) throw new Error(`O estúdio do ${where} não devolveu o arquivo.`);
      set({ status: "saving", message: `Baixando ${files.length > 1 ? "as 2 versões" : "a música"} do ${where}…` });
      // devolve uma lista: [versão principal, versão alternativa?]; só a 1ª é obrigatória
      const out = [];
      for (const [i, file] of files.entries()) {
        const audioUrl = /^https?:/i.test(file) ? file : url + (file.startsWith("/") ? "" : "/") + file;
        try {
          const dl = await fetch(audioUrl, { headers: authHeaders(key), signal: AbortSignal.timeout(300000) });
          if (!dl.ok) throw new Error(`Falha ao baixar a música (${dl.status}).`);
          out.push(Buffer.from(await dl.arrayBuffer()));
        } catch (e) {
          if (i === 0) throw e;
          console.log(`${where}: 2ª versão não baixou:`, e.message);
        }
      }
      return out;
    }
  }
}
