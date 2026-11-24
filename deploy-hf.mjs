// Publica o ACAIAMUSIC no Hugging Face Spaces (grátis) — rode: node deploy-hf.mjs
// Lê do .env: HF_WRITE_TOKEN, APP_PASSWORD, KAGGLE_USERNAME, KAGGLE_API_TOKEN (nada disso vai para o código público:
// tudo vira "segredo" do Space). A biblioteca (pasta data/) vai para um repositório PRIVADO.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { whoAmI, createRepo, repoExists, uploadFiles } from "@huggingface/hub";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => (process.env[k] || "").trim();
const accessToken = env("HF_WRITE_TOKEN");
if (!accessToken) throw new Error("Falta HF_WRITE_TOKEN no .env (token de ESCRITA do Hugging Face).");
if (!env("APP_PASSWORD")) throw new Error("Falta APP_PASSWORD no .env (senha de acesso do app).");

const me = await whoAmI({ accessToken });
const user = me.name;
const space = { type: "space", name: `${user}/${env("SPACE_NAME") || "acaiamusic"}` };
const dataRepo = { type: "dataset", name: `${user}/acaiamusic-dados` };
const api = (p, body) =>
  fetch(`https://huggingface.co/api/${p}`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => {
    if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  });

async function walk(dir, skip, out = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(here, full).split(path.sep).join("/");
    if (skip(rel, e)) continue;
    if (e.isDirectory()) await walk(full, skip, out);
    else out.push(rel);
  }
  return out;
}
async function send(repo, files, title, base = here, prefix = "") {
  for (let i = 0; i < files.length; i += 40) {
    const part = files.slice(i, i + 40);
    await uploadFiles({
      repo,
      accessToken,
      commitTitle: title,
      files: await Promise.all(part.map(async (f) => ({ path: prefix + path.relative(base, path.join(here, f)).split(path.sep).join("/"), content: new Blob([await fs.readFile(path.join(here, f))]) }))),
    });
    console.log(`  ${Math.min(i + 40, files.length)}/${files.length}`);
  }
}

// 1) biblioteca → repositório privado
if (!(await repoExists({ repo: dataRepo, accessToken }))) await createRepo({ repo: dataRepo, accessToken, private: true });
const dataFiles = await walk(path.join(here, "data"), (rel) => /(^|\/)kaggle-auto(\/|$)/.test(rel));
console.log(`Enviando a biblioteca (${dataFiles.length} arquivos) para ${dataRepo.name} (privado)…`);
await send(dataRepo, dataFiles, "Biblioteca do ACAIAMUSIC", path.join(here, "data"));

// 2) Space (o app)
if (!(await repoExists({ repo: space, accessToken }))) {
  await createRepo({ repo: space, accessToken, sdk: "docker", private: false });
  console.log(`Space criado: ${space.name}`);
}
const secrets = { HF_TOKEN: accessToken, DATA_REPO: dataRepo.name, APP_PASSWORD: env("APP_PASSWORD"), KAGGLE_USERNAME: env("KAGGLE_USERNAME"), KAGGLE_API_TOKEN: env("KAGGLE_API_TOKEN") };
for (const [key, value] of Object.entries(secrets)) if (value) await api(`spaces/${space.name}/secrets`, { key, value });
console.log("Segredos configurados:", Object.keys(secrets).filter((k) => secrets[k]).join(", "));

const ignore = /^(node_modules|data|instaladores|modal|\.git|\.claude)(\/|$)|^\.env$|^_.*\.mjs$|\.log$|^deploy-hf\.mjs$|^README\.md$/;
const code = await walk(here, (rel) => ignore.test(rel));
await fs.writeFile(
  path.join(here, ".space-readme.md"),
  `---\ntitle: ACAIAMUSIC\nemoji: 🎵\ncolorFrom: purple\ncolorTo: pink\nsdk: docker\napp_port: 7860\npinned: false\n---\n\nACAIAMUSIC — sua fé em forma de canção. Acesso com senha.\n`,
);
console.log(`Enviando o app (${code.length} arquivos) para ${space.name}…`);
await uploadFiles({ repo: space, accessToken, commitTitle: "README", files: [{ path: "README.md", content: new Blob([await fs.readFile(path.join(here, ".space-readme.md"))]) }] });
await fs.rm(path.join(here, ".space-readme.md"));
await send(space, code, "Publicação do ACAIAMUSIC");

const host = space.name.toLowerCase().replace(/[/_.]/g, "-");
console.log(`\nPronto! Endereço: https://${host}.hf.space  (a primeira montagem leva uns 5–10 min)`);
