import type { KV } from '../memoire';
import { lireHistorique, lireTour } from './tour';
import type { Tour } from './types';
import { partieNonLue } from './etiquette';

export { partieNonLue, etiquetteTour } from './etiquette';

// Ce que la page affiche pour Zoro : son dernier tour, le prochain mardi et l'historique court. Rien de plus que le tour lui-même
// (déjà sans chemin ni nom de fichier).

export type VueZoro = { dernier: Tour | null; prochain: number; historique: { quand: number; importants: number }[] };

const JOUR = 86_400_000;
const HEURE_TOUR = 9 * 3_600_000;

/** Le prochain mardi 09:00 UTC (= Abidjan), strictement après `now`. */
export function prochainMardi(now: number): number {
  const minuit = now - (((now % JOUR) + JOUR) % JOUR);
  const mardi = 2; // getUTCDay : dimanche = 0
  const decalage = (mardi - new Date(minuit).getUTCDay() + 7) % 7;
  let t = minuit + decalage * JOUR + HEURE_TOUR;
  if (t <= now) t += 7 * JOUR;
  return t;
}

export async function vueZoro(kv: KV, now: number = Date.now()): Promise<VueZoro> {
  const [dernier, historique] = await Promise.all([lireTour(kv), lireHistorique(kv)]);
  return { dernier, prochain: prochainMardi(now), historique };
}

const pluriel = (n: number, mot: string, motPluriel = `${mot}s`) => `${n} ${n > 1 ? motPluriel : mot}`;

/** La phrase de Zoro dans le Cerveau, calculée sur le dernier tour lui-même. Jamais « Rien d'important » si quelque chose n'a pas été lu. */
export function phraseZoro(t: Tour | null): string {
  if (!t) return 'Pas encore de tour.';
  const failles = t.projets.reduce((n, p) => n + (p.failles ?? []).filter(f => f.directeProd && (f.gravite === 'critique' || f.gravite === 'haute')).length, 0);
  const rouges = t.projets.filter(p => p.ci.etat === 'rouge').length;
  const nonLu = partieNonLue(t);
  const morceaux = [
    ...(failles ? [`${failles} ${failles > 1 ? 'failles critiques ou hautes' : 'faille critique ou haute'}`] : []),
    ...(rouges ? [pluriel(rouges, 'projet') + ' en rouge'] : []),
  ];
  const base = morceaux.length ? `${morceaux.join(', ')}.`
    : nonLu ? 'Rien trouvé dans ce qui a été lu.' : 'Rien d\'important au dernier tour.';
  return nonLu ? `${base} Une partie n'a pas été lue.` : base;
}
