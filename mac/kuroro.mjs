// Kuroro par le Mac : une boucle qui tourne en permanence (launchd, KeepAlive : fr.qg.kuroro.plist).
// La page du QG (Safari, téléphone) ne peut pas joindre Ollama sur le Mac ; elle dépose sa demande au QG, cette boucle
// la prend (/api/agents/kuroro/suivante), fait parler le modèle local avec le prompt
// et les faits construits par le serveur, et renvoie la réponse (/api/agents/kuroro/reponse). Le serveur valide, dépose
// la mission et écrit la confirmation. Le journal ne contient que des statuts, jamais le texte des messages.
// Peu d'appels au repos (l'offre gratuite d'Upstash) : toutes les 20 s, une seule commande (la file) ; la page le réveille
// quand j'ouvre la conversation (1,5 s pendant 2 min, et pendant 1 min après chaque demande). Il ne signale sa présence
// qu'à chaque nouvelle tranche : 10 s réveillé (vu), 5 min sinon (allume). Au repos : ≈ 4 600 commandes par jour.
// Tout ce qui touche au système (réseau, horloge, attente) est injecté.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const BASE = process.env.QG_BASE ?? 'https://mon-qg.vercel.app';
export const OLLAMA = 'http://localhost:11434';
export const MODELE = 'qwen3:8b'; // le même que MODELE_LOCAL (src/sim/kuroro-ia.ts)
export const GARDER = '2h';
export const DELAI_OLLAMA_MS = 25_000;
export const PAS_ACTIF_MS = 1_500;
export const PAS_REPOS_MS = 20_000;
export const EVEIL_MS = 120_000;
export const APRES_DEMANDE_MS = 60_000;
const TRANCHE_VU_MS = 10_000;
const TRANCHE_ALLUME_MS = 5 * 60_000;

/** L'état de la cadence : réveillé jusqu'à quand, et les dernières tranches signalées. */
export const cadenceInitiale = () => ({ rapideJusqua: 0, trancheVu: null, trancheAllume: null });

/** Après un passage : réveillé 2 min par la page, 1 min de plus après une demande. */
export function apresPassage(c, { eveil, demande }, now) {
  let r = c.rapideJusqua;
  if (eveil) r = Math.max(r, now + EVEIL_MS);
  if (demande) r = Math.max(r, now + APRES_DEMANDE_MS);
  return { ...c, rapideJusqua: r };
}

/** 1,5 s réveillé, 20 s sinon. */
export const prochainPas = (c, now) => (now < c.rapideJusqua ? PAS_ACTIF_MS : PAS_REPOS_MS);

/** Ce que le passage signale : « vu » réveillé et nouvelle tranche de 10 s ; « allume » à chaque nouvelle tranche de 5 min. */
export function signaux(c, now) {
  const tv = Math.floor(now / TRANCHE_VU_MS), ta = Math.floor(now / TRANCHE_ALLUME_MS);
  const vu = now < c.rapideJusqua && tv !== c.trancheVu, allume = ta !== c.trancheAllume;
  return { vu, allume, suivant: { ...c, ...(vu ? { trancheVu: tv } : {}), ...(allume ? { trancheAllume: ta } : {}) } };
}

export const adresseSuivante = ({ vu, allume }) => {
  const q = [vu ? 'vu=1' : '', allume ? 'allume=1' : ''].filter(Boolean).join('&');
  return q ? `suivante?${q}` : 'suivante';
};

/** Le contenu rendu par Ollama → { texte, mission } à envoyer ; null s'il est hors format (le serveur revalide tout). */
export function lireContenu(contenu) {
  if (typeof contenu !== 'string' || !contenu.trim()) return null;
  try {
    const v = JSON.parse(contenu);
    if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.texte !== 'string') return null;
    return { texte: v.texte, mission: v.mission ?? null };
  } catch {
    return /[{}]/.test(contenu) ? null : { texte: contenu.trim(), mission: null };
  }
}

/** Le modèle local, borné par le temps qui reste à la page. */
export async function demanderOllama(d, f, delai = DELAI_OLLAMA_MS) {
  const r = await f(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(Math.max(1_000, Math.min(delai, (d.reste_ms ?? delai) - 1_000))),
    body: JSON.stringify({
      // le prompt (règles + faits + connaissances) dépasse les 4096 jetons par défaut : sans num_ctx, Ollama le tronque ;
      // keep_alive garde le modèle chargé (le premier appel le charge, trop lent pour la page) ; think: false, sinon
      // Qwen 3 réfléchit longuement avant de répondre (sans effet sur un modèle qui ne réfléchit pas)
      model: d.modele, stream: false, think: false, format: d.format, keep_alive: GARDER, options: { temperature: 0.3, num_ctx: 8192 },
      messages: [{ role: 'system', content: d.systeme }, ...d.messages.map(t => ({ role: t.role === 'moi' ? 'user' : 'assistant', content: t.texte }))],
    }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  return (await r.json())?.message?.content;
}

/**
 * Quand j'ouvre la conversation : faire lire au modèle le prompt que le serveur vient d'envoyer (règles + connaissances
 * + faits). C'est cette lecture qui est lente (≈ 180 jetons par seconde, 3 800 jetons) ; Ollama garde le début lu en
 * mémoire, donc mon message n'a plus qu'à être lu lui-même : ≈ 2 s au lieu de plus de 20. Un seul jeton écrit.
 * Sans prompt (ancien serveur), le modèle est seulement chargé.
 */
export async function prechauffer(f, p) {
  const commun = { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(60_000) };
  if (!p?.systeme) {
    await f(`${OLLAMA}/api/generate`, { ...commun, body: JSON.stringify({ model: MODELE, keep_alive: GARDER, options: { num_ctx: 8192 } }) });
    return;
  }
  await f(`${OLLAMA}/api/chat`, {
    ...commun,
    body: JSON.stringify({ model: p.modele ?? MODELE, stream: false, think: false, keep_alive: GARDER, options: { temperature: 0.3, num_ctx: 8192, num_predict: 1 }, messages: [{ role: 'system', content: p.systeme }] }),
  });
}

/** Un tour : prendre une demande, répondre. → { statut: 'vide' | 'reponse' | 'echec', eveil } (statuts seulement, pour le journal). */
export async function tour({ appeler, ollama, journal = () => {}, adresse = 'suivante' }) {
  const { demande: d, eveil = false, isaac = false, prechauffage = null } = (await appeler('GET', adresse)) ?? {};
  const r = { statut: d ? await repondre(d, { appeler, ollama, journal }) : 'vide', eveil: !!eveil, isaac: !!isaac };
  return prechauffage ? { ...r, prechauffage } : r;
}

async function repondre(d, { appeler, ollama, journal }) {
  let corps;
  try {
    const lu = lireContenu(await ollama(d));
    corps = lu ? { id: d.id, ...lu } : { id: d.id, echec: true };
    if (!lu) journal('ollama : réponse hors format');
  } catch (e) {
    journal(`ollama : échec (${e?.name === 'TimeoutError' ? 'trop lent' : e?.message ?? 'erreur'})`);
    corps = { id: d.id, echec: true };
  }
  try { await appeler('POST', 'reponse', corps); }
  catch (e) { journal(`réponse : refusée (${e.message})`); return 'echec'; }
  return corps.echec ? 'echec' : 'reponse';
}

/** La boucle : jamais d'arrêt sur une erreur (réseau coupé, Mac en veille) ; le journal ne note que les changements. */
export async function boucle({ appeler, ollama, attendre, now = Date.now, journal = () => {}, continuer = () => true, prechauffer = async () => {}, lancerIsaac = async () => {} }) {
  let c = cadenceInitiale(), dernierEtat = '';
  const noter = e => { if (e !== dernierEtat) { journal(e); dernierEtat = e; } };
  while (continuer()) {
    const s = signaux(c, now());
    try {
      const r = await tour({ appeler, ollama, journal, adresse: adresseSuivante(s) });
      // la page vient de me réveiller : faire lire le prompt au modèle sans attendre (sans bloquer la boucle, une erreur
      // est sans gravité). À chaque réveil (un par 30 s au plus) : l'heure a pu changer, et un prompt déjà lu coûte < 1 s.
      if (r.prechauffage) prechauffer(r.prechauffage).catch(() => {});
      else if (r.eveil && now() >= c.rapideJusqua) prechauffer().catch(() => {});
      // une mission vient d'être confiée à Isaac : lancer le relais maintenant (sinon il attendrait son passage de 5 min)
      if (r.isaac) { journal('mission pour Isaac : relais lancé'); dernierEtat = ''; lancerIsaac().catch(e => journal(`relais : échec (${e.message})`)); }
      c = apresPassage(s.suivant, { eveil: r.eveil, demande: r.statut !== 'vide' }, now());
      if (r.statut !== 'vide') { journal(`demande traitée : ${r.statut}`); dernierEtat = ''; }
      else noter(now() < c.rapideJusqua ? 'réveillé' : 'en écoute');
    } catch (e) { noter(`QG injoignable (${e.message})`); }
    await attendre(prochainPas(c, now()));
  }
}

// ---- Branchement réel (seulement quand lancé directement) ----
const exec = promisify(execFile);

async function preuve() {
  // en local (serveur de développement) : la clé des agents ; sinon le laissez-passer du Trousseau, jamais journalisé
  if (process.env.QG_CLE_AGENTS) return { authorization: `Bearer ${process.env.QG_CLE_AGENTS}` };
  const { stdout } = await exec('security', ['find-generic-password', '-s', 'qg-bypass', '-w']);
  return { 'x-vercel-protection-bypass': stdout.trim() };
}

async function principal() {
  const journal = m => console.log(`${new Date().toISOString()} ${m}`);
  let entetes;
  const appeler = async (methode, commande, corps) => {
    entetes ??= await preuve();
    const r = await fetch(`${BASE}/api/agents/kuroro/${commande}`, {
      method: methode, redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { ...entetes, ...(corps ? { 'content-type': 'application/json' } : {}) },
      ...(corps ? { body: JSON.stringify(corps) } : {}),
    });
    if (r.status >= 300 && r.status < 400) throw new Error(`bloqué par la protection Vercel (${r.status})`);
    if (!r.ok) throw new Error(`statut ${r.status}`);
    return r.json();
  };
  journal('Kuroro (Mac) démarre');
  await boucle({ appeler, ollama: d => demanderOllama(d, fetch), attendre: ms => new Promise(r => setTimeout(r, ms)), journal, prechauffer: p => prechauffer(fetch, p),
    lancerIsaac: () => exec('launchctl', ['kickstart', `gui/${process.getuid()}/fr.qg.relais`]) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch(e => { console.error(`Échec : ${e.message}`); process.exit(1); });
}
