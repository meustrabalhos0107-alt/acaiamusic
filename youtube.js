// Áudio de referência a partir de um link do YouTube: baixa só o áudio (yt-dlp),
// corta o trecho escolhido (ffmpeg) e devolve como MP3, igual a um arquivo enviado.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpegPath from "ffmpeg-static";

const HOSTS = /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

// Aceita só links do YouTube (nada de outros endereços: o servidor não busca qualquer coisa)
export function youtubeId(raw) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !HOSTS.test(u.hostname)) return null;
  const id = u.hostname.endsWith("youtu.be") ? u.pathname.slice(1) : u.searchParams.get("v") || (/^\/(shorts|embed|live)\/([\w-]+)/.exec(u.pathname) || [])[2];
  return /^[\w-]{11}$/.test(id || "") ? id : null;
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => (p.kill("SIGKILL"), reject(new Error("O YouTube demorou demais para responder."))), timeoutMs);
    p.on("error", (e) => (clearTimeout(t), reject(e)));
    p.on("close", (code) => (clearTimeout(t), code === 0 ? resolve(out) : reject(new Error(err.trim().split("\n").pop() || `saiu com código ${code}`))));
  });
}

function friendly(msg) {
  const m = String(msg);
  if (/ENOENT|No module named/i.test(m)) return "O baixador do YouTube não está instalado neste servidor.";
  if (/sign in|bot|confirm you|429|Too Many/i.test(m)) return "O YouTube bloqueou o download pelo servidor agora. Tente mais tarde ou baixe o áudio e envie o arquivo.";
  if (/private|unavailable|removed|not available|copyright/i.test(m)) return "Este vídeo não está disponível (privado, removido ou bloqueado).";
  if (/larger than max-filesize|File is larger/i.test(m)) return "O vídeo é longo demais. Use um vídeo de até ~1 hora.";
  if (/live/i.test(m)) return "Transmissões ao vivo não podem ser usadas como referência.";
  return `Não consegui pegar o áudio do vídeo: ${m.slice(0, 160)}`;
}

// start e seconds em segundos; devolve { name, data: "data:audio/mpeg;base64,…", title, duration }
export async function youtubeReference(url, { start = 0, seconds = 45 } = {}) {
  const id = youtubeId(url);
  if (!id) throw Object.assign(new Error("Cole um link do YouTube (youtube.com/watch?v=… ou youtu.be/…)."), { status: 400 });
  const dir = path.join(os.tmpdir(), `ytref-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const py = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  try {
    let info;
    try {
      info = await run(
        py,
        ["-m", "yt_dlp", "--no-playlist", "--no-progress", "--no-warnings", "--js-runtimes", "node", "-f", "bestaudio[filesize<60M]/bestaudio/best[height<=360]", "--max-filesize", "60M", "--match-filter", "!is_live",
          "--ffmpeg-location", ffmpegPath, "-o", path.join(dir, "src.%(ext)s"), "--print", "after_move:%(title)s\t%(duration)s", `https://www.youtube.com/watch?v=${id}`],
        180000,
      );
    } catch (e) {
      throw Object.assign(new Error(friendly(e.message)), { status: 502 });
    }
    const [title = "Vídeo do YouTube", dur = "0"] = info.trim().split("\n").pop().split("\t");
    const file = (await fs.readdir(dir)).find((f) => f.startsWith("src."));
    if (!file) throw Object.assign(new Error("O YouTube não entregou o áudio deste vídeo."), { status: 502 });
    const duration = Math.round(Number(dur) || 0);
    const len = Math.max(10, Math.min(60, Number(seconds) || 45));
    // começo pedido; se passar do fim, pega o trecho do meio da música
    let ss = Math.max(0, Number(start) || 0);
    if (duration && ss + 10 > duration) ss = Math.max(0, Math.floor(duration / 2 - len / 2));
    const outFile = path.join(dir, "ref.mp3");
    await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(ss), "-t", String(len), "-i", path.join(dir, file), "-vn", "-ac", "2", "-ar", "44100", "-b:a", "160k", outFile], 120000);
    const buf = await fs.readFile(outFile);
    if (buf.length < 8000) throw Object.assign(new Error("O trecho do vídeo ficou vazio. Escolha outro início."), { status: 422 });
    return { name: `${title.slice(0, 100)} (YouTube ${fmt(ss)}–${fmt(duration ? Math.min(ss + len, duration) : ss + len)})`, data: `data:audio/mpeg;base64,${buf.toString("base64")}`, title, duration, start: ss, seconds: len, youtube: id };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
