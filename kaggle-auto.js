// Liga o estúdio no Kaggle sozinho, sem abrir o notebook no navegador.
// Usa a ferramenta oficial do Kaggle (kaggle kernels push) para rodar o notebook em segundo plano
// numa GPU gratuita. O notebook avisa o endereço pelo ntfy.sh (só o endereço: a chave fica no
// notebook privado e aqui no app) e se desliga sozinho quando fica sem uso.
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const IDLE_MIN = 30; // desliga depois de 30 min sem criar músicas (economiza as horas grátis)
const SLUG = "acaiamusic-estudio-auto";
const SLUG_CPU = "acaiamusic-estudio-cpu";
let DIR = "";
let state = { running: false, phase: "", startedAt: 0, error: "" };
let starting = null;

export function initAuto(dataDir) {
  DIR = path.join(dataDir, "kaggle-auto");
  mkdirSync(DIR, { recursive: true });
}
export const autoState = () => ({ ...state });

function kaggleCli(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const p = spawn(process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-W", "ignore", "-m", "kaggle", ...args], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: -1, out: String(e.message) });
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out: out.trim() });
    });
  });
}

// Usuário do Kaggle logado no PC (kaggle auth login)
export async function kaggleUser() {
  if (process.env.KAGGLE_USERNAME) return process.env.KAGGLE_USERNAME.trim(); // na nuvem: vem dos segredos do Space
  const r = await kaggleCli(["config", "view"], 30000);
  const m = /username:\s*(\S+)/i.exec(r.out);
  return m && m[1] !== "None" ? m[1] : null;
}

export function notebook(key, topic, cpu = false) {
  const code = `
import os, re, time, json, subprocess, threading, queue, urllib.request
KEY, TOPIC, IDLE_MIN, CPU = ${JSON.stringify(key)}, ${JSON.stringify(topic)}, ${IDLE_MIN}, ${cpu ? "True" : "False"}
W = '/tmp/acaia'; os.makedirs(W, exist_ok=True); os.chdir(W)
def ntfy(msg):
    try: urllib.request.urlopen(urllib.request.Request('https://ntfy.sh/' + TOPIC, data=msg.encode(), method='POST'), timeout=15)
    except Exception as e: print('ntfy falhou', e)
def log(m): print(m, flush=True); ntfy('log:' + m)
def sh(cmd):
    print('$', cmd, flush=True)
    if subprocess.run(cmd, shell=True).returncode != 0:
        log('erro:Falhou: ' + cmd[:80]); raise SystemExit(1)

g = subprocess.run('nvidia-smi --query-gpu=name --format=csv,noheader', shell=True, capture_output=True, text=True)
GPU = g.returncode == 0 and g.stdout.strip()
if GPU: log('GPU ligada (' + GPU.splitlines()[0] + '). Instalando o estúdio…')
elif CPU: log('Máquina ligada (modo processador, mais lento). Instalando o estúdio…')
else: log('erro:O Kaggle não liberou GPU.'); raise SystemExit(1)
sh('pip install -q uv')
if not os.path.isdir('ACE-Step-1.5'): sh('git clone -q --depth 1 https://github.com/ACE-Step/ACE-Step-1.5.git')
os.environ['UV_LINK_MODE'] = 'copy'
sh('cd ACE-Step-1.5 && uv sync -q')
log('Instalado. Carregando o modelo de música…')
env = dict(os.environ, ACESTEP_API_HOST='127.0.0.1', ACESTEP_API_PORT='8001', ACESTEP_API_KEY=KEY,
           ACESTEP_CONFIG_PATH='acestep-v15-turbo', ACESTEP_INIT_LLM='false', ACESTEP_LM_BACKEND='pt',
           ACESTEP_CHECKPOINTS_DIR=W + '/models')
env['MPLBACKEND'] = 'Agg'  # o Kaggle define um backend de gráficos que não existe no ambiente do estúdio
if not GPU: env.update(ACESTEP_DEVICE='cpu', ACESTEP_USE_FLASH_ATTENTION='false', ACESTEP_OFFLOAD_TO_CPU='false')
server = subprocess.Popen(['uv', 'run', 'acestep-api'], cwd=W + '/ACE-Step-1.5', env=env,
                          stdout=open(W + '/acestep.log', 'w'), stderr=subprocess.STDOUT)
def stats():
    r = urllib.request.Request('http://127.0.0.1:8001/v1/stats', headers={'Authorization': 'Bearer ' + KEY})
    return json.loads(urllib.request.urlopen(r, timeout=5).read())
for i in range(400):
    if server.poll() is not None:
        tail = open(W + '/acestep.log', errors='ignore').read().splitlines()[-5:]
        log('erro:O servidor de música parou: ' + ' | '.join(tail)[:300]); raise SystemExit(1)
    try: stats(); break
    except Exception:
        time.sleep(5)
        if i % 24 == 23: log(f'Ainda carregando o modelo… {(i + 1) // 12} min')
else:
    log('erro:O modelo demorou demais para carregar.'); raise SystemExit(1)

CF = W + '/cloudflared'
if not os.path.exists(CF):
    urllib.request.urlretrieve('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64', CF); os.chmod(CF, 0o755)
def tunnel():
    t = subprocess.Popen([CF, 'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8001'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    q = queue.Queue(); threading.Thread(target=lambda: [q.put(l) for l in t.stdout], daemon=True).start()
    fim = time.time() + 120
    while time.time() < fim:
        try: m = re.search(r'https://[a-z0-9-]+\\.trycloudflare\\.com', q.get(timeout=5))
        except queue.Empty: continue
        if m: ntfy(('url:' if GPU else 'urlcpu:') + m.group(0)); return t
    t.kill(); return None
tun = None
for _ in range(3):
    tun = tunnel()
    if tun: break
if not tun: log('erro:Não consegui criar o endereço público.'); raise SystemExit(1)

last_total, last_act, since = -1, time.time(), int(time.time())
while server.poll() is None:
    time.sleep(60)
    try:
        j = stats().get('data', {}).get('jobs', {})
        busy = j.get('queued', 0) + j.get('running', 0)
        if j.get('total', 0) != last_total or busy: last_total, last_act = j.get('total', 0), time.time()
    except Exception: pass
    try:
        lines = urllib.request.urlopen(f'https://ntfy.sh/{TOPIC}/json?poll=1&since={since}', timeout=15).read().decode().splitlines()
        msgs = [json.loads(l).get('message') for l in lines if l.strip()]
        if 'stop' in msgs: log('fim:Desligado pelo app.'); break
        if 'stopcpu' in msgs and not GPU: log('fim:A GPU ligou: o modo processador foi desligado.'); break
    except Exception: pass
    if tun.poll() is not None: tun = tunnel() or tun
    if time.time() - last_act > IDLE_MIN * 60: log(f'fim:Desligado após {IDLE_MIN} min sem uso (economiza suas horas grátis).'); break
server.kill(); tun.kill()
`;
  return {
    metadata: { kernelspec: { name: "python3", display_name: "Python 3", language: "python" }, language_info: { name: "python" } },
    nbformat: 4,
    nbformat_minor: 5,
    cells: [{ cell_type: "code", execution_count: null, id: "acaia", metadata: {}, outputs: [], source: code.trim() }],
  };
}

async function readTopic(topic, sinceSec) {
  const r = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=${sinceSec}`, { signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((m) => m && m.event === "message");
}

// Liga o estúdio e espera o endereço. Pede GPU e processador ao mesmo tempo: usa o que ligar
// primeiro; se a GPU ligar depois, onUpgrade({url}) é chamado e o modo processador se desliga.
async function pushKernel(user, slug, nb, gpu) {
  const dir = path.join(DIR, slug);
  mkdirSync(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "estudio.ipynb"), JSON.stringify(nb));
  await fs.writeFile(
    path.join(dir, "kernel-metadata.json"),
    JSON.stringify({ id: `${user}/${slug}`, title: slug, code_file: "estudio.ipynb", language: "python", kernel_type: "notebook", is_private: true, enable_gpu: gpu, enable_internet: true, dataset_sources: [], competition_sources: [], kernel_sources: [] }),
  );
  const r = await kaggleCli(["kernels", "push", "-p", dir, ...(gpu ? ["--accelerator", "NvidiaTeslaT4"] : [])], 180000);
  return { ok: r.code === 0 && /successfully pushed/i.test(r.out), out: r.out };
}

export function startStudio(onProgress = () => {}, onUpgrade = () => {}) {
  if (starting) {
    starting.listeners.push(onProgress);
    return starting.promise;
  }
  const listeners = [onProgress];
  const progress = (m) => {
    state.phase = m;
    listeners.forEach((f) => f(m));
  };
  const promise = (async () => {
    state = { running: true, phase: "", startedAt: Date.now(), error: "" };
    try {
      const user = await kaggleUser();
      if (!user) throw new Error("Entre na sua conta do Kaggle neste PC primeiro (peça ao Claude: \"kaggle auth login\").");
      const key = randomBytes(18).toString("base64url");
      const topic = "acaia-" + randomBytes(12).toString("hex");
      const since = Math.floor(Date.now() / 1000) - 5;
      progress("Pedindo uma máquina grátis ao Kaggle…");
      const [g, c] = await Promise.all([pushKernel(user, SLUG, notebook(key, topic, false), true), pushKernel(user, SLUG_CPU, notebook(key, topic, true), false)]);
      if (!g.ok && !c.ok) throw new Error("O Kaggle recusou: " + (c.out || g.out).split("\n").slice(-2).join(" ").slice(0, 300));
      if (!g.ok) console.log("GPU não pedida:", g.out.split("\n").pop());
      progress("Ligando o estúdio. A instalação leva uns 10–15 min…");
      const t0 = Date.now();
      while (Date.now() - t0 < 50 * 60 * 1000) {
        await new Promise((res) => setTimeout(res, 10000));
        let msgs = [];
        try {
          msgs = await readTopic(topic, since);
        } catch {
          continue;
        }
        const errs = msgs.filter((m) => m.message.startsWith("log:erro:"));
        if (!c.ok && errs.length) throw new Error(errs[0].message.slice(9));
        if (errs.length >= 2) throw new Error(errs[errs.length - 1].message.slice(9));
        const gpuUrl = msgs.find((m) => m.message.startsWith("url:"));
        const cpuUrl = msgs.find((m) => m.message.startsWith("urlcpu:"));
        if (gpuUrl || cpuUrl) {
          state.topic = topic;
          if (gpuUrl) {
            await stopCpu(topic);
            progress("Estúdio ligado na GPU!");
            return { url: gpuUrl.message.slice(4), key, topic, cpu: false };
          }
          progress("Estúdio ligado (modo processador: mais lento, mas sem fila)!");
          if (g.ok) watchUpgrade(topic, since, onUpgrade);
          return { url: cpuUrl.message.slice(7), key, topic, cpu: true };
        }
        const last = msgs.filter((m) => m.message.startsWith("log:") && !m.message.startsWith("log:erro")).pop();
        const mins = Math.floor((Date.now() - t0) / 60000);
        progress(`${last ? last.message.slice(4) : "Aguardando o Kaggle ligar a máquina…"} (${mins} min)`);
      }
      throw new Error("O Kaggle demorou demais para ligar o estúdio.");
    } catch (e) {
      state.error = e.message;
      throw e;
    } finally {
      state.running = false;
      starting = null;
    }
  })();
  starting = { promise, listeners };
  return promise;
}

const stopCpu = (topic) => fetch(`https://ntfy.sh/${topic}`, { method: "POST", body: "stopcpu" }).catch(() => {});
// Fica de olho: quando a GPU sair da fila, troca para ela e desliga o modo processador
async function watchUpgrade(topic, since, onUpgrade) {
  const t0 = Date.now();
  while (Date.now() - t0 < 6 * 3600 * 1000) {
    await new Promise((r) => setTimeout(r, 30000));
    try {
      const msgs = await readTopic(topic, since);
      const g = msgs.find((m) => m.message.startsWith("url:"));
      if (g) {
        await onUpgrade({ url: g.message.slice(4) });
        await stopCpu(topic);
        return;
      }
      if (msgs.some((m) => m.message === "stop")) return;
    } catch {}
  }
}

export async function stopStudio(topic) {
  if (!topic) return;
  await fetch(`https://ntfy.sh/${topic}`, { method: "POST", body: "stop" }).catch(() => {});
}
