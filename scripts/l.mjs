// L'outil de la routine de L : la seule porte de L vers le QG.
// Usage : node scripts/l.mjs contexte
//         node scripts/l.mjs <propositions|brouillon|traite|question|memoire|bilan> fichier.json
//         node scripts/l.mjs apercu visuel.json sortie.png   (rend le visuel sans rien envoyer)
//         Le corps de « brouillon » accepte un champ facultatif « visuel » (carte, schema, capture ou carrousel :
//         voir agents/L/CONSIGNES.md § 7 bis) ; « contexte » liste les « captures » utilisables.
// L'adresse vient de QG_URL (par défaut https://mon-qg.vercel.app).
// Aucun secret n'est écrit ici : dans une routine Claude Code, le proxy ajoute lui-même le laissez-passer
// (lancer avec NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1). Pour un essai depuis le Mac, QG_BYPASS est accepté.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAUT = 'https://mon-qg.vercel.app';
const LECTURES = ['contexte'];
const ECRITURES = ['propositions', 'brouillon', 'apercu', 'traite', 'question', 'memoire', 'bilan'];

export function construireRequete(commande, corps, env = {}) {
  const lecture = LECTURES.includes(commande);
  if (!lecture && !ECRITURES.includes(commande)) throw new Error(`commande inconnue : ${commande}`);
  const base = (env.QG_URL || DEFAUT).replace(/\/$/, '');
  const headers = { ...(env.QG_BYPASS ? { 'x-vercel-protection-bypass': env.QG_BYPASS } : {}) };
  const init = { method: lecture ? 'GET' : 'POST', headers, redirect: 'manual' };
  if (!lecture) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(corps ?? {}); }
  return { url: `${base}/api/agents/l/${commande}`, init };
}

async function principal() {
  const [commande, fichier, sortie] = process.argv.slice(2);
  if (!commande) throw new Error('usage : node scripts/l.mjs <contexte|propositions|brouillon|apercu|traite|question|memoire|bilan> [fichier.json] [sortie.png]');
  if (commande === 'apercu' && !sortie) throw new Error('usage : node scripts/l.mjs apercu <visuel.json> <sortie.png>');
  let corps;
  if (ECRITURES.includes(commande)) {
    if (!fichier) throw new Error(`« ${commande} » demande un fichier JSON`);
    try { corps = JSON.parse(readFileSync(fichier, 'utf8')); } catch (e) { throw new Error(`fichier illisible ou JSON invalide (${fichier}) : ${e.message}`); }
  }
  const { url, init } = construireRequete(commande, corps, process.env);
  const r = await fetch(url, init);
  if (r.status >= 300 && r.status < 400) throw new Error(`bloqué par la protection Vercel (${r.status}) : laissez-passer manquant ou faux (lancer avec NODE_USE_ENV_PROXY=1 dans la routine)`);
  if (r.status === 401) throw new Error('401 : laissez-passer manquant ou faux');
  if (commande === 'apercu' && r.ok) {
    writeFileSync(sortie, Buffer.from(await r.arrayBuffer()));
    console.log(`Image écrite : ${sortie}`);
    return;
  }
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${json.erreur ?? 'refusé'}`);
  console.log(JSON.stringify(json, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch(e => { console.error(`Échec : ${e.message}`); process.exit(1); });
}
