// Ce qui arrive vraiment à une mission donnée au QG (barre de mission ou Telegram), partagé par le serveur et la page.
// Trois chemins (décision du 12 novembre 2026, « je dois pouvoir donner les consignes sur Telegram et elles s'exécutent ») :
//   - les actions immédiates, faites par le code (src/sim/actions-immediates.ts) : vérifier les sites (Luffy), refaire le
//     tour de sécurité (Zoro), mettre un agent en pause ou le reprendre ;
//   - Isaac lit ses missions lui-même (le relais du Mac) ;
//   - les missions qui demandent de réfléchir (L, Light, Clara, Mafe, Léa, Paul, Ye, Feu) : la routine « QG · missions »
//     (agents/Missions/CONSIGNES.md) passe toutes les heures de 08:00 à 20:00 et rend son rapport, dit sur Telegram.
// Heure d'Abidjan = UTC. Fonctions pures.

const MIN = 60_000, H = 60 * MIN, JOUR = 24 * H;

/** Les agents dont la routine « QG · missions » fait les missions. */
export const AGENTS_MISSIONS = ['L', 'light', 'clara', 'mafe', 'lea', 'paul', 'ye', 'feu'] as const;
export const faitLesMissions = (id: string) => (AGENTS_MISSIONS as readonly string[]).includes(id);

/** Les passages de la routine : toutes les heures pile, de 08:00 à 20:00. */
export const PREMIERE_HEURE = 8, DERNIERE_HEURE = 20;
export const HEURES_MISSIONS = Array.from({ length: DERNIERE_HEURE - PREMIERE_HEURE + 1 }, (_, i) => `${String(PREMIERE_HEURE + i).padStart(2, '0')}:00`);

/**
 * Mise en service de la routine « QG · missions » (activée après un essai réel, « rien à faire »). Avant, ses créneaux
 * sont « pas encore actif ».
 */
export const ACTIVATION_MISSIONS = Date.UTC(2026, 10, 12, 21, 15); // mise en service le 12 novembre 2026 à 21:15

export const missionsEnService = (now: number) => now >= ACTIVATION_MISSIONS;

/** Le prochain passage de la routine après `now` (le premier au plus tôt à la mise en service). */
export function prochainPassageMissions(now: number): number {
  const depart = Math.max(now, ACTIVATION_MISSIONS - 1);
  const minuit = depart - (((depart % JOUR) + JOUR) % JOUR);
  for (let j = 0; j < 2; j++) for (let h = PREMIERE_HEURE; h <= DERNIERE_HEURE; h++) {
    const t = minuit + j * JOUR + h * H;
    if (t > depart) return t;
  }
  return minuit + 2 * JOUR + PREMIERE_HEURE * H;
}

/** Le délai réel d'une mission confiée maintenant à la routine. */
export type Delai = 'pas-en-service' | 'dans-l-heure' | 'ce-matin' | 'demain-matin';
export function delaiMission(now: number): Delai {
  if (!missionsEnService(now)) return 'pas-en-service';
  const h = new Date(now).getUTCHours();
  if (h < PREMIERE_HEURE) return 'ce-matin';
  return h < DERNIERE_HEURE ? 'dans-l-heure' : 'demain-matin';
}

/** « Elle s'en occupe dans l'heure… » : la vraie suite, dite par le code. */
export function phraseDelai(pronom: 'Il' | 'Elle', now: number): string {
  const p = pronom.toLowerCase();
  switch (delaiMission(now)) {
    case 'pas-en-service': return `Le passage des missions n’est pas encore en service : ${p} la verra sur sa fiche, et elle sera faite dès sa mise en service.`;
    case 'dans-l-heure': return `${pronom} s’en occupe dans l’heure (passage des missions toutes les heures, entre 8 h et 20 h) ; le résultat arrive sur Telegram.`;
    case 'ce-matin': return `${pronom} s’en occupe ce matin, au passage de 8 h (les missions passent entre 8 h et 20 h) ; le résultat arrive sur Telegram.`;
    case 'demain-matin': return `${pronom} s’en occupe demain matin, au passage de 8 h (les missions passent entre 8 h et 20 h) ; le résultat arrive sur Telegram.`;
  }
}

/** Les statuts d'un rapport de la routine. */
export const STATUTS_RAPPORT = ['fait', 'a-valider', 'impossible'] as const;
export type StatutRapport = (typeof STATUTS_RAPPORT)[number];
