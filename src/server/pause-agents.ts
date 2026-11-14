import type { KV } from './memoire';
import { journaliser } from './qg';
import { finEnMots, NOMS_REELS } from '@/sim/actions-immediates';

// La pause d'un vrai agent, décidée par le patron (« mets Ye en pause cette semaine », « reprends Paul »), rangée dans
// Upstash : `qg:pauses-agents`, table agent → JSON des périodes (les 10 dernières, la plus récente en dernier).
// Pendant une période, les passages prévus de l'agent sont sautés : sa route répond « en pause, rien à faire » à la
// routine (ou au relais) qui démarre un passage, sans rien faire, et le calendrier dit « en pause (par toi) », jamais
// « raté ». Ses missions l'attendent (la routine « QG · missions » ne les prend pas). Heure d'Abidjan = UTC.

export const CLE_PAUSES = 'qg:pauses-agents';
const GARDE = 10;

/** Une période de pause : `jusqua` null tant que le patron ne l'a pas reprise (ni donné de fin). */
export type Periode = { depuis: number; jusqua: number | null };
export type Pauses = Record<string, Periode[]>;

const lire = (brut: string | undefined): Periode[] => {
  if (!brut) return [];
  try {
    const v = JSON.parse(brut);
    return Array.isArray(v) ? v.filter((p): p is Periode => p && typeof p.depuis === 'number' && (p.jusqua === null || typeof p.jusqua === 'number')) : [];
  } catch { return []; }
};

export async function lirePauses(kv: KV): Promise<Pauses> {
  return Object.fromEntries(Object.entries(await kv.hgetall(CLE_PAUSES)).map(([a, v]) => [a, lire(v)]));
}

/** L'instant `t` tombe-t-il dans une pause de l'agent ? */
export const enPauseA = (pauses: Pauses, agent: string, t: number) =>
  (pauses[agent] ?? []).some(p => p.depuis <= t && (p.jusqua === null || t < p.jusqua));

/** La pause en cours de l'agent, ou null. */
export const pauseEnCours = (pauses: Pauses, agent: string, now: number): Periode | null =>
  (pauses[agent] ?? []).find(p => p.depuis <= now && (p.jusqua === null || now < p.jusqua)) ?? null;

/** Les agents en pause maintenant. */
export const agentsEnPause = (pauses: Pauses, now: number) => Object.keys(pauses).filter(a => pauseEnCours(pauses, a, now));

/** « en pause (par toi) jusqu’à lundi 16 à 00:00 » : la phrase de la page et de Kuroro. */
export const phrasePause = (agent: string, p: Periode, now: number) => `en pause (par toi) ${finEnMots(agent, p.jusqua, now)}`;

async function ecrire(kv: KV, agent: string, periodes: Periode[]) {
  await kv.hset(CLE_PAUSES, agent, JSON.stringify(periodes.slice(-GARDE)));
}

/** Met l'agent en pause jusqu'à `jusqua` (null : jusqu'à la reprise). Une pause en cours est prolongée ou raccourcie. */
export async function mettreEnPause(kv: KV, agent: string, jusqua: number | null, now: number): Promise<Periode> {
  const periodes = (await lirePauses(kv))[agent] ?? [];
  const enCours = periodes.find(p => p.depuis <= now && (p.jusqua === null || now < p.jusqua));
  const p: Periode = { depuis: enCours?.depuis ?? now, jusqua };
  await ecrire(kv, agent, [...periodes.filter(x => x !== enCours), p]);
  await journaliser(kv, { quand: now, agent, type: 'etat', statut: 'en pause', texte: phrasePause(agent, p, now), origine: 'moi' });
  return p;
}

/** Reprend l'agent : la pause en cours finit maintenant. false s'il n'était pas en pause. */
export async function reprendre(kv: KV, agent: string, now: number): Promise<boolean> {
  const periodes = (await lirePauses(kv))[agent] ?? [];
  const enCours = periodes.find(p => p.depuis <= now && (p.jusqua === null || now < p.jusqua));
  if (!enCours) return false;
  await ecrire(kv, agent, periodes.map(p => (p === enCours ? { ...p, jusqua: now } : p)));
  await journaliser(kv, { quand: now, agent, type: 'etat', statut: 'termine', texte: 'reprend (par toi) : fin de la pause', origine: 'moi' });
  return true;
}

/**
 * Les actions qui démarrent un passage prévu (routine Claude Code, QStash ou relais du Mac). Pendant une pause, elles
 * répondent « en pause » sans rien faire ; les autres actions (un « Valider », un rapport déjà commencé) passent.
 */
export const PASSAGES: Record<string, readonly string[]> = {
  L: ['contexte'],
  light: ['releve', 'relance'],
  clara: ['stats', 'bannis', 'relancer'],
  mafe: ['releve'],
  luffy: ['verifier'],
  zoro: ['tour'],
  lea: ['a-relire'],
  paul: ['a-documenter'],
  ye: ['a-comparer'],
  isaac: ['a-faire', 'proposer'],
  // Feu : la lecture du marché (toutes les 15 min) et l'analyse de la routine ; le Mac continue de lire le compte
  feu: ['marche', 'a-analyser'],
};

/**
 * La réponse à une routine qui démarre un passage pendant une pause, ou null (le passage a lieu). Isaac garde la forme
 * que son relais attend (rien d'accepté, aucune mission, rien de proposé) : il ne fait rien.
 */
export async function sauterSiEnPause(kv: KV, agent: string, action: string, now = Date.now()) {
  if (!PASSAGES[agent]?.includes(action)) return null;
  const p = pauseEnCours(await lirePauses(kv).catch(() => ({})), agent, now);
  if (!p) return null;
  const base = { agentEnPause: true as const, jusqua: p.jusqua, message: `${NOMS_REELS[agent] ?? agent} est en pause (par le patron) : rien à faire, arrête-toi.` };
  if (agent === 'isaac') return action === 'a-faire' ? { ...base, acceptees: [], missions: [] } : { ...base, proposees: [], enAttente: [], ecartees: [] };
  return base;
}
