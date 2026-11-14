// L'outil de la routine hebdomadaire de Kuroro : envoie au QG ce qu'il sait du projet et des personnages.
// Usage : node scripts/connaissances.mjs envoyer /tmp/connaissances.json   (même forme que src/data/connaissances.json)
// L'adresse vient de QG_URL (par défaut https://mon-qg.vercel.app).
// Aucun secret n'est écrit ici : dans une routine Claude Code, le proxy ajoute lui-même le laissez-passer
// (lancer avec NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1). Pour un essai depuis le Mac, QG_BYPASS est accepté.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAUT = 'https://mon-qg.vercel.app';

export function construireRequete(commande, corps, env = {}) {
  if (commande !== 'envoyer') throw new Error(`commande inconnue : ${commande}`);
  const base = (env.QG_URL || DEFAUT).replace(/\/$/, '');
  const headers = { 'content-type': 'application/json', ...(env.QG_BYPASS ? { 'x-vercel-protection-bypass': env.QG_BYPASS } : {}), ...(env.QG_CLE_AGENT ? { 'x-qg-agent-cle': env.QG_CLE_AGENT } : {}) };
  return { url: `${base}/api/agents/connaissances`, init: { method: 'POST', headers, redirect: 'manual', body: JSON.stringify(corps ?? {}) } };
}

async function principal() {
  const [commande, fichier] = process.argv.slice(2);
  if (commande !== 'envoyer' || !fichier) throw new Error('usage : node scripts/connaissances.mjs envoyer <fichier.json>');
  let corps;
  try { corps = JSON.parse(readFileSync(fichier, 'utf8')); } catch (e) { throw new Error(`fichier illisible ou JSON invalide (${fichier}) : ${e.message}`); }
  const { url, init } = construireRequete(commande, corps, process.env);
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
