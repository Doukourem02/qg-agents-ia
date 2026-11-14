import { estJour } from '@/sim/horaire';
import { astreinteDuJour } from '@/sim/astreinte';
import { bilan, enMots, hhmm, nomCourt, participantsDe, prochainPoint, resume, type Reunion } from '@/data/crise';

// Les messages Telegram d'une réunion : courts, en français simple, tutoiement. Deux niveaux : 🟠 incident, 🔴 réunion de
// crise. Les vrais noms de projets sont permis (Telegram ne va qu'au patron) ; jamais un secret, jamais une adresse.
// Fonctions pures.

/** Qui est en salle à cet instant (la nuit : Kuroro et l'agent d'astreinte). */
export const participantsA = (r: Pick<Reunion, 'niveau' | 'agents'>, now: number) =>
  participantsDe(r.niveau, r.agents, !estJour(now), astreinteDuJour(now));

const qui = (r: Pick<Reunion, 'niveau' | 'agents'>, now: number) => enMots(participantsA(r, now).map(nomCourt));
const prochain = (r: Pick<Reunion, 'debut'>, now: number) => `prochain point à ${hhmm(prochainPoint(Math.max(now, r.debut)))}`;

/**
 * « 🟠 Incident à 14:05 · Livreo en panne depuis 12 min · Kuroro, Stalker et Luffy en salle de réunion · prochain point à 14:30 »
 * ou « 🔴 Réunion de crise à 14:05 · … ».
 */
export function messageDebut(r: Reunion, now: number): string {
  const titre = r.niveau === 'crise' ? '🔴 Réunion de crise' : '🟠 Incident';
  return `${titre} à ${hhmm(r.debut)} · ${resume(r.sujets, now)} · ${qui(r, now)} en salle de réunion · ${prochain(r, now)}`;
}

/**
 * Un incident devient une crise : « 🔴 L'incident devient une crise : Livreo et Portfolio en panne depuis 20 min · tous les
 * cadres en salle de réunion · prochain point à 14:30 ». La nuit, seuls Kuroro et l'agent d'astreinte y sont : on le dit.
 */
export function messageEscalade(r: Reunion, now: number): string {
  const salle = estJour(now) ? 'tous les cadres' : qui(r, now);
  return `🔴 L'incident devient une crise : ${resume(r.sujets, now)} · ${salle} en salle de réunion · ${prochain(r, now)}`;
}

/** Chaque heure, seulement pour une vraie panne : « Livreo toujours en panne depuis 1 h 05 · prochain point à 15:30 » */
export const messageHeure = (r: Reunion, now: number) => `${resume(r.sujets, now, true)} · prochain point à ${hhmm(prochainPoint(now))}`;

/** « ✅ Fin de l'incident à 14:40 · Livreo revenu après 38 min · débrief dans le journal » (ou « Fin de la réunion de crise »). */
export const messageFin = (r: Reunion & { fin: number }) =>
  `✅ Fin ${r.niveau === 'crise' ? 'de la réunion de crise' : 'de l\'incident'} à ${hhmm(r.fin)} · ${bilan(r, true)} · débrief dans le journal`;
