// Guarda a pasta data/ (músicas, letras, repertórios, configurações) num repositório PRIVADO
// do Hugging Face, para nada se perder quando o app roda na nuvem (o disco do Space é temporário).
// Só funciona quando DATA_REPO e HF_WRITE_TOKEN (ou HF_TOKEN com escrita) estão definidos.
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { listFiles, downloadFile, uploadFiles, deleteFiles, createRepo, repoExists } from "@huggingface/hub";

const SKIP = /(^|\/)(kaggle-auto|\.tmp)(\/|$)|\.part$/; // arquivos de trabalho que não precisam ir para a nuvem

async function walk(dir, base = dir, out = new Map()) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (SKIP.test(rel)) continue;
    if (e.isDirectory()) await walk(full, base, out);
    else {
      const st = await fs.stat(full);
      out.set(rel, `${st.size}:${Math.floor(st.mtimeMs)}`);
    }
  }
  return out;
}

export function initPersist(dataDir) {
  const name = (process.env.DATA_REPO || "").trim();
  const accessToken = (process.env.HF_WRITE_TOKEN || process.env.HF_TOKEN || "").trim();
  if (!name || !accessToken) return { enabled: false, restore: async () => {}, flush: async () => {} };
  const repo = { type: "dataset", name };
  let known = new Map(); // estado do disco na última sincronização
  let busy = false;

  async function restore() {
    if (!(await repoExists({ repo, accessToken }))) {
      await createRepo({ repo, accessToken, private: true });
      console.log(`Nuvem: repositório privado ${name} criado`);
    }
    let n = 0;
    for await (const f of listFiles({ repo, accessToken, recursive: true })) {
      if (f.type !== "file" || f.path.startsWith(".")) continue;
      const dest = path.join(dataDir, f.path);
      if (existsSync(dest)) continue;
      const blob = await downloadFile({ repo, path: f.path, accessToken });
      if (!blob) continue;
      mkdirSync(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, Buffer.from(await blob.arrayBuffer()));
      n++;
    }
    known = await walk(dataDir);
    console.log(`Nuvem: ${n} arquivo(s) restaurado(s) de ${name}`);
  }

  // envia o que mudou e apaga o que foi excluído
  async function flush() {
    if (busy) return;
    busy = true;
    try {
      const now = await walk(dataDir);
      const changed = [...now].filter(([p, sig]) => known.get(p) !== sig).map(([p]) => p);
      const removed = [...known.keys()].filter((p) => !now.has(p));
      for (let i = 0; i < changed.length; i += 40) {
        const part = changed.slice(i, i + 40);
        const files = await Promise.all(part.map(async (p) => ({ path: p, content: new Blob([await fs.readFile(path.join(dataDir, p))]) })));
        await uploadFiles({ repo, accessToken, files, commitTitle: `ACAIAMUSIC: ${part.length} arquivo(s) atualizado(s)` });
      }
      if (removed.length) await deleteFiles({ repo, accessToken, paths: removed, commitTitle: `ACAIAMUSIC: ${removed.length} arquivo(s) removido(s)` }).catch(() => {});
      known = now;
      if (changed.length || removed.length) console.log(`Nuvem: ${changed.length} enviado(s), ${removed.length} removido(s)`);
    } catch (e) {
      console.error("Nuvem: falha ao sincronizar:", e.message);
    } finally {
      busy = false;
    }
  }

  setInterval(flush, 60_000).unref();
  for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, () => flush().finally(() => process.exit(0)));
  return { enabled: true, restore, flush };
}
