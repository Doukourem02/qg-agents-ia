import { AGENTS_REELS } from '@/data/reels';

// Chaque nuit, UN agent est d'astreinte : rotation fixe calculée par le QG (sans IA, personne ne choisit), parmi les
// vrais agents sauf Luffy (déjà le veilleur de nuit). Fonction pure : le même instant donne le même agent.

const ROTATION = ['L', 'light', 'clara', 'mafe', 'isaac'];
/** La rotation, sans les agents retirés des vrais agents. */
export const ORDRE_ASTREINTE: readonly string[] = ROTATION.filter(id => (AGENTS_REELS as readonly string[]).includes(id));

const JOUR = 86_400_000;

/** Semaine ISO 8601 de l'instant (UTC) : l'année de la semaine est celle de son jeudi. */
export function semaineISO(now: number) {
  const d = new Date(now);
  const jour = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const jeudi = jour + (3 - ((d.getUTCDay() + 6) % 7)) * JOUR;
  const annee = new Date(jeudi).getUTCFullYear();
  const semaine = Math.floor((jeudi - Date.UTC(annee, 0, 1)) / JOUR / 7) + 1;
  return { annee, semaine };
}

const HEURE = 3_600_000;
/** La nuit commence à 20:00 UTC ; jusqu'à 06:59 UTC, c'est encore la nuit de la veille. */
const FIN_DE_NUIT = 7;

/** Minuit UTC du jour auquel appartient l'instant : avant 07:00 UTC, c'est encore la nuit de la veille. */
function jourDeNuit(jour: Date | number): number {
  const t = typeof jour === 'number' ? jour : jour.getTime();
  const d = new Date(t - FIN_DE_NUIT * HEURE);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const aaaammjj = (minuit: number) => new Date(minuit).toISOString().slice(0, 10);

/**
 * L'agent d'astreinte de la nuit qui commence à 20:00 UTC le jour D (jusqu'à 07:00 le lendemain).
 * Un agent différent chaque nuit : la rotation avance d'un cran par jour, donc jamais deux fois de suite (même
 * du dimanche au lundi), et de 7 crans d'une semaine à l'autre : un même agent ne retombe pas sur le même jour.
 */
export function astreinteDuJour(jour: Date | number): string {
  const minuit = jourDeNuit(jour);
  const jours = Math.floor(minuit / JOUR);
  const lundi = jours - ((jours + 3) % 7); // le 1er janvier 1970 était un jeudi
  const semaine = (lundi - 4) / 7; // le 5 janvier 1970 était un lundi
  const rang = jours - lundi;
  return ORDRE_ASTREINTE[(semaine * 7 + rang) % ORDRE_ASTREINTE.length];
}

/** Le planning de la semaine (rotation fixe) : les 7 nuits de la semaine (lundi à dimanche) de l'instant. */
export function planningSemaine(now: number): { jour: string; agent: string }[] {
  const jours = Math.floor(now / JOUR); // la semaine du calendrier (lundi 00:00 UTC), pas celle de la nuit
  const lundi = (jours - ((jours + 3) % 7)) * JOUR;
  return Array.from({ length: 7 }, (_, i) => ({ jour: aaaammjj(lundi + i * JOUR), agent: astreinteDuJour(lundi + i * JOUR + 12 * HEURE) }));
}
