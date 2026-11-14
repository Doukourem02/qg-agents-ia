// L'outil de la routine de Mafe (et du Mac) : la seule porte de Mafe vers le QG.
// Usage : node scripts/mafe.mjs releve > /tmp/releve.json
//         node scripts/mafe.mjs point /tmp/point.json      ({ "phrase": "…" })
//         node scripts/mafe.mjs envoyer /tmp/envoi.json    ({ "telegram": "Commence par …", "bilan": "…" })
//         node scripts/mafe.mjs note /tmp/note.json        ({ "id": "…", "markdown": "…" })
//         node scripts/mafe.mjs notion /tmp/notion.json    ({ "id": "…", "url": "https://…notion…" })
//         (le Mac : rafraichir, a-copier, copie /tmp/copie.json)
// L'adresse vient de QG_URL (par défaut https://mon-qg.vercel.app).
// Aucun secret n'est écrit ici : dans une routine Claude Code, le proxy ajoute lui-même le laissez-passer
// (lancer avec NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1). Pour un essai depuis le Mac, QG_BYPASS est accepté.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAUT = 'https://mon-qg.vercel.app';
const LECTURES = ['releve', 'a-copier'];
const ECRITURES = ['point', 'envoyer', 'note', 'notion', 'rafraichir', 'copie'];
const AVEC_FICHIER = ['point', 'envoyer', 'note', 'notion', 'copie'];

export function construireRequete(commande, corps, env = {}) {
  const lecture = LECTURES.includes(commande);
  if (!lecture && !ECRITURES.includes(commande)) throw new Error(`commande inconnue : ${commande}`);
  const base = (env.QG_URL || DEFAUT).replace(/\/$/, '');
  const headers = { ...(env.QG_BYPASS ? { 'x-vercel-protection-bypass': env.QG_BYPASS } : {}) };
  const init = { method: lecture ? 'GET' : 'POST', headers, redirect: 'manual' };
  if (!lecture) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(corps ?? {}); }
  return { url: `${base}/api/agents/mafe/${commande}`, init };
}

async function principal() {
  const [commande, fichier] = process.argv.slice(2);
  if (!commande) throw new Error('usage : node scripts/mafe.mjs <releve|point|envoyer|note|notion|rafraichir|a-copier|copie> [fichier.json]');
  let corps;
  if (AVEC_FICHIER.includes(commande)) {
    if (!fichier) throw new Error(`« ${commande} » demande un fichier JSON`);
    try { corps = JSON.parse(readFileSync(fichier, 'utf8')); } catch (e) { throw new Error(`fichier illisible ou JSON invalide (${fichier}) : ${e.message}`); }
  }
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
