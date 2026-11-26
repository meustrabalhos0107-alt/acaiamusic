// Publica o ACAIAMUSIC no Render.com (grátis) a partir do repositório do GitHub — rode: node deploy-render.mjs <url-do-github>
// Lê do .env: RENDER_API_KEY, HF_WRITE_TOKEN, APP_PASSWORD, KAGGLE_USERNAME, KAGGLE_API_TOKEN (viram variáveis secretas no Render).
import "dotenv/config";

const env = (k) => (process.env[k] || "").trim();
const key = env("RENDER_API_KEY");
const repo = process.argv[2];
if (!key) throw new Error("Falta RENDER_API_KEY no .env.");
if (!repo) throw new Error("Informe a URL do repositório do GitHub.");
const R = async (method, p, body) => {
  const r = await fetch(`https://api.render.com/v1${p}`, { method, headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Render ${method} ${p}: ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
};

const owners = await R("GET", "/owners?limit=5");
const ownerId = owners[0]?.owner?.id;
if (!ownerId) throw new Error("Não encontrei a sua conta no Render.");
const envVars = [
  { key: "PORT", value: "7860" },
  { key: "DATA_REPO", value: env("DATA_REPO") || "Agatha0107/acaiamusic-dados" },
  { key: "HF_TOKEN", value: env("HF_WRITE_TOKEN") },
  { key: "APP_PASSWORD", value: env("APP_PASSWORD") },
  { key: "KAGGLE_USERNAME", value: env("KAGGLE_USERNAME") },
  { key: "KAGGLE_API_TOKEN", value: env("KAGGLE_API_TOKEN") },
  // compositores de letra melhores (opcionais, gratuitos)
  { key: "GEMINI_API_KEY", value: env("GEMINI_API_KEY") },
  { key: "LYRICS_HF_TOKEN", value: env("LYRICS_HF_TOKEN") },
].filter((v) => v.value);

const existing = (await R("GET", `/services?name=acaiamusic&ownerId=${ownerId}&limit=5`)).map((x) => x.service).find((s) => s?.name === "acaiamusic");
let svc = existing;
if (!svc) {
  const created = await R("POST", "/services", {
    type: "web_service",
    name: "acaiamusic",
    ownerId,
    repo,
    branch: "main",
    autoDeploy: "yes",
    envVars,
    serviceDetails: { runtime: "docker", plan: "free", region: "oregon", healthCheckPath: "/manifest.json", envSpecificDetails: { dockerfilePath: "./Dockerfile", dockerContext: "." } },
  });
  svc = created.service || created;
  console.log("Serviço criado no Render.");
} else {
  await R("PUT", `/services/${svc.id}/env-vars`, envVars);
  await R("POST", `/services/${svc.id}/deploys`, {});
  console.log("Serviço atualizado e nova publicação iniciada.");
}
console.log(`ID: ${svc.id}`);
console.log(`Endereço: ${svc.serviceDetails?.url || `https://${svc.slug || "acaiamusic"}.onrender.com`}`);
