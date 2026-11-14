import type { KV } from './memoire';
import { AGENTS, agentById, routeMission } from '@/sim/routing';

// Le cœur du branchement (phase 2) : l'état des agents, le journal, la boîte des missions et l'idempotence.
// Fonctions pures autour d'un stockage KV, pour être testées sans Upstash.

export const CLES = {
  etats: 'qg:etats',
  journal: 'qg:journal',
  missions: (agent: string) => `qg:missions:${agent}`,
  idem: (cle: string) => `qg:idem:${cle}`,
};
export const JOURNAL_MAX = 300;
const IDEM_SECONDES = 7 * 24 * 3600;

export const STATUTS = ['au travail', 'en pause', 'termine', 'erreur'] as const;
export type Statut = (typeof STATUTS)[number];
/** L'état d'un agent : jamais de contenu sensible, seulement des résumés en une phrase. */
export type Etat = { agent: string; statut: Statut; tache: string; outil?: string; resultat?: string; quand: number };
export type Entree = { quand: number; agent: string; type: 'etat' | 'mission'; texte: string; resultat?: string; origine?: 'moi' | 'agent'; statut?: Statut };
export type Mission = { id: string; quand: number; agent: string; texte: string };

export class Refus extends Error {
  constructor(message: string, readonly code = 400) { super(message); }
}

const texte = (v: unknown, nom: string, max: number, requis = true): string | undefined => {
  if (v == null || v === '') { if (requis) throw new Refus(`« ${nom} » manquant`); return undefined; }
  if (typeof v !== 'string') throw new Refus(`« ${nom} » doit être un texte`);
  const t = v.trim();
  if (t.length > max) throw new Refus(`« ${nom} » trop long (${max} caractères au plus)`);
  return t;
};
const agentValide = (v: unknown) => {
  const id = texte(v, 'agent', 40)!;
  if (!agentById(id)) throw new Refus(`agent inconnu : ${id}`);
  return id;
};

export async function journaliser(kv: KV, e: Entree) {
  await kv.lpush(CLES.journal, JSON.stringify(e));
  await kv.ltrim(CLES.journal, 0, JOURNAL_MAX - 1);
}

/**
 * Un agent écrit son état. `cle` (facultative) rend l'écriture idempotente :
 * une routine rejouée avec la même clé n'écrit pas deux fois.
 */
export async function ecrireEtat(kv: KV, corps: Record<string, unknown>, now = Date.now(), options: { journal?: boolean } = {}) {
  const agent = agentValide(corps.agent);
  const statut = texte(corps.statut, 'statut', 20)! as Statut;
  if (!STATUTS.includes(statut)) throw new Refus(`statut inconnu : ${statut} (attendu : ${STATUTS.join(', ')})`);
  const etat: Etat = {
    agent, statut,
    tache: texte(corps.tache, 'tache', 140)!,
    outil: texte(corps.outil, 'outil', 10, false),
    resultat: texte(corps.resultat, 'resultat', 200, false),
    quand: now,
  };
  const cle = texte(corps.cle, 'cle', 120, false);
  if (cle && !(await kv.setnx(CLES.idem(cle), '1', IDEM_SECONDES))) return { etat, doublon: true };
  await kv.hset(CLES.etats, agent, JSON.stringify(etat));
  // `journal: false` : seulement l'état en direct (un agent qui passe souvent ne chasse pas l'historique des autres)
  if (options.journal !== false) await journaliser(kv, { quand: now, agent, type: 'etat', statut: etat.statut, texte: etat.tache, resultat: etat.resultat, origine: 'agent' });
  return { etat, doublon: false };
}

/** La file que le Mac lit déjà (mac/kuroro.mjs) : y glisser cette marque le fait lancer Isaac tout de suite, sans attendre son passage de 5 min. */
export const FILE_DU_MAC = 'kuroro:demandes';
export const MARQUE_ISAAC = 'mission-isaac';

/** Une mission écrite dans la page : Kuroro la confie au bon agent (ou à l'agent choisi depuis sa fiche). */
export async function deposerMission(kv: KV, corps: Record<string, unknown>, now = Date.now()) {
  const t = texte(corps.texte, 'texte', 300)!;
  const choisi = corps.agent ? agentValide(corps.agent) : null;
  const agent = choisi ? agentById(choisi)! : routeMission(t).agent;
  const mission: Mission = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, quand: now, agent: agent.id, texte: t };
  await kv.lpush(CLES.missions(agent.id), JSON.stringify(mission));
  await journaliser(kv, { quand: now, agent: agent.id, type: 'mission', texte: t, origine: 'moi' });
  if (agent.id === 'isaac') await kv.lpush(FILE_DU_MAC, MARQUE_ISAAC);
  return mission;
}

/** Un agent récupère ses missions en attente (les plus anciennes d'abord), au plus `max`. */
export async function prendreMissions(kv: KV, agentBrut: unknown, max = 5) {
  const agent = agentValide(agentBrut);
  const out: Mission[] = [];
  for (let i = 0; i < max; i++) {
    const v = await kv.rpop(CLES.missions(agent));
    if (!v) break;
    out.push(JSON.parse(v));
  }
  return out;
}

/** Ce que la page lit : l'état de chaque agent et le journal récent. */
export async function lireEtat(kv: KV, nbJournal = 50) {
  const brut = await kv.hgetall(CLES.etats);
  const etats: Record<string, Etat> = {};
  for (const [id, v] of Object.entries(brut)) if (agentById(id)) etats[id] = JSON.parse(v);
  const journal = (await kv.lrange(CLES.journal, 0, nbJournal - 1)).map(v => JSON.parse(v) as Entree);
  return { etats, journal };
}

export const IDS_AGENTS = AGENTS.map(a => a.id);
