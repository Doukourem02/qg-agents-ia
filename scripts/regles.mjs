// Les règles du patron (« Mes règles » du Cerveau), lues par L, Light, Clara et Mafe au début de chaque passage.
// Usage : NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1 node scripts/regles.mjs
// Affiche { "regles": ["…", "…"] }. Lecture seule : rien n'est écrit.
// L'adresse vient de QG_URL (par défaut https://mon-qg.vercel.app).
// Aucun secret n'est écrit ici : dans une routine Claude Code, le proxy ajoute lui-même le laissez-passer
// (lancer avec NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1). Pour un essai depuis le Mac, QG_BYPASS est accepté.
import { pathToFileURL } from 'node:url';

const DEFAUT = 'https://mon-qg.vercel.app';

export function construireRequete(env = {}) {
  const base = (env.QG_URL || DEFAUT).replace(/\/$/, '');
  const headers = { ...(env.QG_BYPASS ? { 'x-vercel-protection-bypass': env.QG_BYPASS } : {}), ...(env.QG_CLE_AGENT ? { 'x-qg-agent-cle': env.QG_CLE_AGENT } : {}) };
  return { url: `${base}/api/agents/regles`, init: { method: 'GET', headers, redirect: 'manual' } };
}

async function principal() {
  const [commande] = process.argv.slice(2);
  if (commande && commande !== 'lire') throw new Error('usage : node scripts/regles.mjs');
  const { url, init } = construireRequete(process.env);
  const r = await fetch(url, init);
  if (r.status >= 300 && r.status < 400) throw new Error(`bloqué par la protection Vercel (${r.status}) : laissez-passer manquant ou faux (lancer avec NODE_USE_ENV_PROXY=1 dans la routine)`);
  if (r.status === 401) throw new Error('401 : laissez-passer manquant ou faux');
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${json.erreur ?? 'refusé'}`);
  console.log(JSON.stringify(json, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch(e => { console.error(`Échec : ${e.message}`); process.exit(1); });
}
