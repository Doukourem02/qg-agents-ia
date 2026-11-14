// Paul : ce que le serveur garde dans Upstash, et les petites lectures communes (lot, rapport, écriture, page).
// Jamais un secret : les contenus gardés sont ceux du lot, déjà passés au repérage des clés et masqués.
import type { KV } from '../memoire';
import { Refus } from '../qg';
import { listeCourte } from '../lea/etiquette';
import type { DocLu, Echec, Passage, Proposition, RefusQG } from './types';

export const CLES_PAUL = {
  /** Hash `sha` : dernier commit documenté de la branche par défaut. */
  vu: (depot: string) => `paul:vu:${depot}`,
  /** Hash : `meta` = le lot remis (MetaLot), `p:<dépôt>` = ce que le serveur garde de chaque projet, `fait` = id du dernier lot rendu. */
  lot: 'paul:lot',
  /** Hash id → Proposition. */
  propositions: 'paul:propositions',
  /** Liste des propositions refusées par le QG (les plus récentes en tête). */
  refus: 'paul:refus-qg',
  /** Hash `json` : le dernier passage complet (Passage). */
  passage: 'paul:passage',
  /** Valeur : le jeton du passage qui tient le verrou. */
  verrou: 'paul:verrou',
  /** Valeur : une écriture sur GitHub est en cours pour cette proposition (un double clic n'écrit qu'une fois). */
  ecriture: (id: string) => `paul:ecriture:${id}`,
};

export const JOUR = 86_400_000;
/** Une proposition non traitée expire après 8 jours (ou plus tôt, remplacée au passage suivant). */
export const EXPIRE_APRES = 8 * JOUR;
const VERROU_S = 280;
const CHAMP = 'json';

/** Ce que le serveur garde d'un projet remis à la routine : de quoi valider les propositions, rien de plus. */
export type ReserveProjet = {
  depot: string; branche: string; tete: string;
  /** Les sha entiers des commits du lot (une raison doit en citer un, ou un fichier de `chemins`). */
  shas: string[];
  /** Les fichiers réels du lot (arborescence montrée, fichiers des commits, fichiers lus). */
  chemins: string[];
  readme: DocLu; claude: DocLu;
  /** L'arborescence a pu être lue ; les noms à la racine (pour repérer « readme.md » quand « README.md » manque). */
  arbreLu: boolean; racine: string[];
};
export type MetaLot = { id: string; quand: number; depots: string[]; illisibles: string[] };

const pl = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/**
 * Le résumé du journal : des nombres, et les noms courts des projets non relus. Un passage où des projets n'ont pas
 * été relus le dit (« en partie ») et ne dit jamais « rien à proposer ».
 */
export function resumePassage(relus: number, propositions: number, refusees: number, nonRelus: string[]): string {
  const partiel = nonRelus.length > 0;
  const quoi = propositions ? `${pl(propositions, 'proposition')} (${pl(relus, 'projet')})` : partiel ? 'aucune proposition' : 'rien à proposer';
  const morceaux = [`a relu la semaine${partiel ? ' en partie' : ''} : ${quoi}`];
  if (refusees) morceaux.push(`${refusees} ${refusees > 1 ? 'refusées' : 'refusée'} par le QG`);
  if (partiel) morceaux.push(`non relus : ${listeCourte(nonRelus)}`);
  const t = morceaux.join(' ; ');
  return t.length > 140 ? t.slice(0, 139) + '…' : t;
}

export function lire<T>(brut: string | undefined | null): T | null {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
}

export async function lireMarque(kv: KV, depot: string): Promise<string | null> {
  return (await kv.hmget(CLES_PAUL.vu(depot), ['sha'])).sha ?? null;
}
export const poserMarque = (kv: KV, depot: string, sha: string) => kv.hset(CLES_PAUL.vu(depot), 'sha', sha);

export async function lireMeta(kv: KV): Promise<{ meta: MetaLot | null; fait: string | null }> {
  const h = await kv.hmget(CLES_PAUL.lot, ['meta', 'fait']);
  return { meta: lire<MetaLot>(h.meta), fait: h.fait ?? null };
}
export async function lireReserveProjet(kv: KV, depot: string): Promise<ReserveProjet | null> {
  const champ = `p:${depot}`;
  return lire<ReserveProjet>((await kv.hmget(CLES_PAUL.lot, [champ]))[champ]);
}
/** Oublie le lot remis (méta et projets), garde `fait`. */
export async function viderLot(kv: KV): Promise<void> {
  for (const champ of Object.keys(await kv.hgetall(CLES_PAUL.lot))) if (champ !== 'fait') await kv.hdel(CLES_PAUL.lot, champ);
}

export async function lirePropositions(kv: KV): Promise<Proposition[]> {
  return Object.values(await kv.hgetall(CLES_PAUL.propositions)).flatMap(v => lire<Proposition>(v) ?? [])
    .sort((a, b) => b.quand - a.quand || a.id.localeCompare(b.id));
}
export async function lireProposition(kv: KV, id: string): Promise<Proposition | null> {
  return lire<Proposition>((await kv.hmget(CLES_PAUL.propositions, [id]))[id]);
}
export const ecrireProposition = (kv: KV, p: Proposition) => kv.hset(CLES_PAUL.propositions, p.id, JSON.stringify(p));

/**
 * Passe une proposition encore en attente à `statut`, sous le même verrou que les clics : jamais pendant un Valider
 * en cours, jamais par-dessus une réponse déjà donnée (relue sous le verrou). Faux si rien n'a changé.
 */
export async function changerSiAttente(kv: KV, id: string, statut: 'remplacee' | 'expiree', now: number): Promise<boolean> {
  if (!(await kv.setnx(CLES_PAUL.ecriture(id), '1', 60))) return false;
  try {
    const p = await lireProposition(kv, id);
    if (!p || p.statut !== 'attente') return false;
    await ecrireProposition(kv, { ...p, statut, ...(statut === 'remplacee' ? { decide: now } : {}) });
    return true;
  } finally {
    await kv.del(CLES_PAUL.ecriture(id)).catch(() => undefined);
  }
}

export const expiree = (p: Proposition, now: number) => p.statut === 'attente' && now - p.quand > EXPIRE_APRES;

export async function lireRefus(kv: KV, n = 30): Promise<RefusQG[]> {
  return (await kv.lrange(CLES_PAUL.refus, 0, n - 1)).flatMap(v => lire<RefusQG>(v) ?? []);
}

export async function lirePassage(kv: KV): Promise<Passage | null> {
  return lire<Passage>((await kv.hmget(CLES_PAUL.passage, [CHAMP]))[CHAMP]);
}
export const noterPassage = (kv: KV, p: Passage) => kv.hset(CLES_PAUL.passage, CHAMP, JSON.stringify(p));

/** Le dernier passage raté (aucun projet lu), gardé à côté du dernier passage : la page dit lequel est le plus récent. */
export async function lireEchec(kv: KV): Promise<Echec | null> {
  return lire<Echec>((await kv.hmget(CLES_PAUL.passage, ['echec'])).echec);
}
export const noterEchec = (kv: KV, e: Echec) => kv.hset(CLES_PAUL.passage, 'echec', JSON.stringify(e));
/** « n'a pu lire aucun projet : a, b (GitHub n'a pas répondu) » — la tâche d'un passage raté. */
export const phraseEchec = (illisibles: string[]) => `n'a pu lire aucun projet : ${listeCourte(illisibles)} (GitHub n'a pas répondu)`.slice(0, 140);

/** Le verrou porte un jeton au hasard : un passage n'efface que son propre verrou. */
export async function avecVerrou<T>(kv: KV, faire: () => Promise<T>): Promise<T> {
  const jeton = crypto.randomUUID();
  if (!(await kv.setnx(CLES_PAUL.verrou, jeton, VERROU_S))) throw new Refus('Paul est déjà en plein passage : réessaie dans quelques minutes', 503);
  try {
    return await faire();
  } finally {
    await (async () => { if ((await kv.get(CLES_PAUL.verrou)) === jeton) await kv.del(CLES_PAUL.verrou); })().catch(() => undefined);
  }
}
