import { AGENTS_REELS } from '@/data/reels';

// Le bureau suit l'heure d'Abidjan (UTC, sans heure d'été), « comme une vraie entreprise » (décision du 10 novembre 2026) :
// ouvert de 07:00 à 20:00 ; la nuit, lumières baissées et bureau vide, sauf ceux qui travaillent vraiment.

export const OUVERTURE = 7, FERMETURE = 20;
const MIN = 60_000;
/** Un vrai agent « au travail » depuis moins de 30 min (comme « En cours » dans Tâches). */
export const TRAVAIL_MAX = 30 * MIN;
/** Stalker (Claude Code avec moi) : un signe à chaque demande ; sans signe depuis 15 min, il est parti. */
export const PRESENCE_MAX = 15 * MIN;
/** Ceux qui peuvent vraiment travailler la nuit : les vrais agents et Stalker (Claude Code). */
export const TRAVAILLEURS_DE_NUIT: readonly string[] = [...AGENTS_REELS, 'stalker'];

/** Jour : 07:00 ≤ heure < 20:00 à Abidjan (UTC). */
export function estJour(now: number) {
  const h = new Date(now).getUTCHours();
  return h >= OUVERTURE && h < FERMETURE;
}

export type Veille = {
  /** agent → heure de son dernier état réel « au travail ». */
  travail: ReadonlyMap<string, number>;
  /** Luffy, le veilleur de nuit, vérifie vraiment les sites. */
  luffyVeille: boolean;
  /** L'agent d'astreinte de la semaine (désigné par Kuroro) : il reste au bureau la nuit, sans travailler. */
  astreinte?: string | null;
  now: number;
};

/**
 * La nuit, qui reste au bureau : Luffy s'il veille, un vrai agent pendant qu'il travaille vraiment, Stalker pendant
 * qu'une session de Claude Code est active. Personne d'autre (figurants, barista, guichetier, couloir, agents simulés).
 */
export function presentLaNuit(id: string, v: Veille) {
  if (id === 'luffy' && v.luffyVeille) return true;
  if (id === v.astreinte) return true;
  if (!TRAVAILLEURS_DE_NUIT.includes(id)) return false;
  const quand = v.travail.get(id);
  if (quand === undefined) return false;
  return v.now - quand < (id === 'stalker' ? PRESENCE_MAX : TRAVAIL_MAX);
}
