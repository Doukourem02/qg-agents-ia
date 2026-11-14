// Ye : ce que le serveur garde dans Upstash, et les lectures communes (lot, rapport, publication, page).
// Jamais un secret : les textes gardés sont ceux du lot, passés au repérage des clés et masqués.
import type { KV } from '../memoire';
import { Refus } from '../qg';
import type { ChampTexte, Competence, EchecYe, NouvelleYe, PassageYe, PropositionYe, QuestionYe, RefusQGYe } from './types';

export const CLES_YE = {
  /** Hash `sha` : dernier commit regardé de la branche par défaut. */
  vu: (depot: string) => `ye:vu:${depot}`,
  /** Hash : `meta` = le lot remis, `p:<id de fiche>` = ce que le serveur garde de chaque fiche, `fait` = id du dernier lot rendu. */
  lot: 'ye:lot',
  propositions: 'ye:propositions',
  questions: 'ye:questions',
  /** Hash clé de techno → « oui » | « non » : une techno à laquelle j'ai répondu n'est plus jamais demandée. */
  reponses: 'ye:reponses',
  refus: 'ye:refus-qg',
  /** Hash `json` = dernier passage, `echec` = dernier passage raté. */
  passage: 'ye:passage',
  verrou: 'ye:verrou',
  /** Hash id → nouvelle fiche proposée pour un projet absent du portfolio. */
  nouvelles: 'ye:nouvelles',
  /** Hash dépôt (minuscules) → `{ statut: 'plus-tard' | 'jamais', quand }` : ma réponse « Pas maintenant » ou « Jamais ». */
  absents: 'ye:absents',
  /** Hash id de fiche → dépôt « Compte/Nom » : les fiches créées par Ye (leur dépôt peut être privé, jamais écrit dans Sanity). */
  depots: 'ye:depots',
  /** Un clic à la fois par proposition ou question (et jamais pendant qu'un passage la remplace). */
  decision: (id: string) => `ye:decision:${id}`,
};

export const JOUR = 86_400_000;
export const EXPIRE_APRES = 8 * JOUR;
const VERROU_S = 280;

/** Ce que le serveur garde d'une fiche remise à la routine : de quoi valider une proposition, rien de plus. */
export type ReserveFiche = {
  ficheId: string; rev: string; titre: string; depot: string; tete: string;
  /** Les valeurs actuelles (textes masqués) ; `technologies` : les références telles qu'elles sont. */
  actuel: Record<ChampTexte, string> & { technologies: { _key: string; _ref: string }[] };
  masques: ChampTexte[];
  shas: string[]; chemins: string[]; urls: string[]; dependances: string[];
  commits: { sha: string; message: string }[];
};
/** Ce que le serveur garde d'un projet absent remis à la routine : de quoi valider une nouvelle fiche. */
export type ReserveAbsent = {
  depot: string; tete: string; shas: string[]; chemins: string[]; urls: string[]; dependances: string[];
  commits: { sha: string; message: string }[]; images: string[];
};
export type MetaLotYe = { id: string; quand: number; fiches: string[]; absents?: string[]; competences: Competence[]; illisibles: string[]; sansLien: number };

export function lire<T>(brut: string | undefined | null): T | null {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
}

export async function lireMarque(kv: KV, depot: string): Promise<string | null> {
  return (await kv.hmget(CLES_YE.vu(depot), ['sha'])).sha ?? null;
}
export const poserMarque = (kv: KV, depot: string, sha: string) => kv.hset(CLES_YE.vu(depot), 'sha', sha);

export async function lireMeta(kv: KV): Promise<{ meta: MetaLotYe | null; fait: string | null }> {
  const h = await kv.hmget(CLES_YE.lot, ['meta', 'fait']);
  return { meta: lire<MetaLotYe>(h.meta), fait: h.fait ?? null };
}
export async function lireReserve(kv: KV, ficheId: string): Promise<ReserveFiche | null> {
  const champ = `p:${ficheId}`;
  return lire<ReserveFiche>((await kv.hmget(CLES_YE.lot, [champ]))[champ]);
}
export async function lireReserveAbsent(kv: KV, depot: string): Promise<ReserveAbsent | null> {
  const champ = `a:${depot.toLowerCase()}`;
  return lire<ReserveAbsent>((await kv.hmget(CLES_YE.lot, [champ]))[champ]);
}
export async function viderLot(kv: KV): Promise<void> {
  for (const champ of Object.keys(await kv.hgetall(CLES_YE.lot))) if (champ !== 'fait') await kv.hdel(CLES_YE.lot, champ);
}

export async function lirePropositions(kv: KV): Promise<PropositionYe[]> {
  return Object.values(await kv.hgetall(CLES_YE.propositions)).flatMap(v => lire<PropositionYe>(v) ?? []).sort((a, b) => b.quand - a.quand || a.id.localeCompare(b.id));
}
export async function lireProposition(kv: KV, id: string): Promise<PropositionYe | null> {
  return lire<PropositionYe>((await kv.hmget(CLES_YE.propositions, [id]))[id]);
}
export const ecrireProposition = (kv: KV, p: PropositionYe) => kv.hset(CLES_YE.propositions, p.id, JSON.stringify(p));

export async function lireQuestions(kv: KV): Promise<QuestionYe[]> {
  return Object.values(await kv.hgetall(CLES_YE.questions)).flatMap(v => lire<QuestionYe>(v) ?? []).sort((a, b) => b.quand - a.quand || a.id.localeCompare(b.id));
}
export async function lireQuestion(kv: KV, id: string): Promise<QuestionYe | null> {
  return lire<QuestionYe>((await kv.hmget(CLES_YE.questions, [id]))[id]);
}
export const ecrireQuestion = (kv: KV, q: QuestionYe) => kv.hset(CLES_YE.questions, q.id, JSON.stringify(q));

export async function lireNouvelles(kv: KV): Promise<NouvelleYe[]> {
  return Object.values(await kv.hgetall(CLES_YE.nouvelles)).flatMap(v => lire<NouvelleYe>(v) ?? []).sort((a, b) => b.quand - a.quand || a.id.localeCompare(b.id));
}
export async function lireNouvelle(kv: KV, id: string): Promise<NouvelleYe | null> {
  return lire<NouvelleYe>((await kv.hmget(CLES_YE.nouvelles, [id]))[id]);
}
export const ecrireNouvelle = (kv: KV, n: NouvelleYe) => kv.hset(CLES_YE.nouvelles, n.id, JSON.stringify(n));

/** Ma réponse pour un dépôt absent du portfolio (« Pas maintenant » ou « Jamais »). */
export type ReponseAbsent = { statut: 'plus-tard' | 'jamais'; quand: number };
export async function lireReponsesAbsents(kv: KV): Promise<Map<string, ReponseAbsent>> {
  const h = await kv.hgetall(CLES_YE.absents);
  return new Map(Object.entries(h).flatMap(([k, v]) => { const r = lire<ReponseAbsent>(v); return r ? [[k, r] as const] : []; }));
}
export const noterReponseAbsent = (kv: KV, depot: string, r: ReponseAbsent) => kv.hset(CLES_YE.absents, depot.toLowerCase(), JSON.stringify(r));

/** Les fiches créées par Ye et leur dépôt (id de fiche → « Compte/Nom »). */
export const lireDepotsFiches = async (kv: KV): Promise<Record<string, string>> => kv.hgetall(CLES_YE.depots);
export const noterDepotFiche = (kv: KV, ficheId: string, depot: string) => kv.hset(CLES_YE.depots, ficheId, depot);

export const expiree = (p: { statut: string; quand: number }, now: number) => p.statut === 'attente' && now - p.quand > EXPIRE_APRES;

/** Fait `faire` sous le verrou de la proposition (ou question) `id` ; null si un clic est déjà en cours. */
export async function sousVerrou<T>(kv: KV, id: string, faire: () => Promise<T>): Promise<T | null> {
  if (!(await kv.setnx(CLES_YE.decision(id), '1', 120))) return null;
  try {
    return await faire();
  } finally {
    await kv.del(CLES_YE.decision(id)).catch(() => undefined);
  }
}

/** Passe une proposition encore en attente à `statut`, sous son verrou et relue : jamais pendant un clic, jamais par-dessus une réponse. */
export async function changerSiAttente(kv: KV, id: string, statut: 'remplacee' | 'expiree', now: number): Promise<boolean> {
  return (await sousVerrou(kv, id, async () => {
    const p = await lireProposition(kv, id);
    if (!p || p.statut !== 'attente') return false;
    await ecrireProposition(kv, { ...p, statut, ...(statut === 'remplacee' ? { decide: now } : {}) });
    return true;
  })) ?? false;
}

export async function lireRefus(kv: KV, n = 30): Promise<RefusQGYe[]> {
  return (await kv.lrange(CLES_YE.refus, 0, n - 1)).flatMap(v => lire<RefusQGYe>(v) ?? []);
}
export async function lirePassage(kv: KV): Promise<PassageYe | null> {
  return lire<PassageYe>((await kv.hmget(CLES_YE.passage, ['json'])).json);
}
export const noterPassage = (kv: KV, p: PassageYe) => kv.hset(CLES_YE.passage, 'json', JSON.stringify(p));
export async function lireEchec(kv: KV): Promise<EchecYe | null> {
  return lire<EchecYe>((await kv.hmget(CLES_YE.passage, ['echec'])).echec);
}
export const noterEchec = (kv: KV, e: EchecYe) => kv.hset(CLES_YE.passage, 'echec', JSON.stringify(e));

export async function avecVerrou<T>(kv: KV, faire: () => Promise<T>): Promise<T> {
  const jeton = crypto.randomUUID();
  if (!(await kv.setnx(CLES_YE.verrou, jeton, VERROU_S))) throw new Refus('Ye est déjà en plein passage : réessaie dans quelques minutes', 503);
  try {
    return await faire();
  } finally {
    await (async () => { if ((await kv.get(CLES_YE.verrou)) === jeton) await kv.del(CLES_YE.verrou); })().catch(() => undefined);
  }
}
