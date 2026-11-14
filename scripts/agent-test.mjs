// Un agent de test : il fait ce que fera chaque vrai agent (routine, relais Mac) —
// il récupère ses missions, écrit « au travail », puis « terminé » avec un résultat en une phrase.
// Les secrets viennent de l'environnement (jamais du code) :
//   QG_CLE_AGENTS : la clé des agents ; QG_BYPASS : le laissez-passer de la protection Vercel.
// Dans une routine Claude Code, le laissez-passer est un « secret réseau » : le proxy d'Anthropic l'ajoute
// lui-même aux requêtes vers le QG (il suffit seul), le script ne le connaît pas (lancer avec --secrets-proxy).
// ⚠ Le fetch de Node ignore le proxy par défaut : dans une routine, lancer avec NODE_USE_ENV_PROXY=1
//   (sinon la requête contourne le proxy, n'a pas le secret, et Vercel répond 401/302).
// Usage : node scripts/agent-test.mjs [agent] [adresse] [--secrets-proxy]   (par défaut : mafe, https://mon-qg.vercel.app)
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const agent = args[0] ?? 'mafe';
const base = (args[1] ?? 'https://mon-qg.vercel.app').replace(/\/$/, '');
const proxy = process.argv.includes('--secrets-proxy');
const cle = process.env.QG_CLE_AGENTS, bypass = process.env.QG_BYPASS;
if (!cle && !proxy) { console.error('QG_CLE_AGENTS manquant (ou lancer avec --secrets-proxy dans une routine)'); process.exit(1); }
const entetes = { 'content-type': 'application/json', ...(cle ? { authorization: `Bearer ${cle}` } : {}), ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) };

async function appel(chemin, init = {}) {
  const r = await fetch(base + chemin, { ...init, headers: entetes, redirect: 'manual' });
  if (r.status >= 300 && r.status < 400) throw new Error(`bloqué par la protection Vercel (${r.status}) : laissez-passer manquant ou faux`);
  const corps = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${corps.erreur ?? ''}`);
  return corps;
}
const etat = (statut, tache, extra = {}) =>
  appel('/api/agents/etat', { method: 'POST', body: JSON.stringify({ agent, statut, tache, ...extra }) });

try {
  const { missions } = await appel(`/api/agents/missions?agent=${encodeURIComponent(agent)}`);
  console.log(`${missions.length} mission(s) récupérée(s)`);
  const sujet = missions[0]?.texte ?? 'vérifie que le branchement fonctionne';
  await etat('au travail', `TEST · ${sujet}`.slice(0, 140), { outil: 'C', cle: `test-${agent}-${missions[0]?.id ?? Date.now()}-debut` });
  console.log('état écrit : au travail');
  await new Promise(r => setTimeout(r, 4000));
  await etat('termine', `TEST · ${sujet}`.slice(0, 140), { resultat: 'Branchement vérifié : la page voit mon état.', cle: `test-${agent}-${missions[0]?.id ?? Date.now()}-fin` });
  console.log('état écrit : terminé');
} catch (e) {
  console.error(`Échec : ${e.message}`);
  process.exit(1);
}
