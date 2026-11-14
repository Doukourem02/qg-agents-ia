import type { EtatAgent } from '@/server/vues';

// Au survol d'un vrai agent, la deuxième ligne de son étiquette : ce qu'on sait vraiment de son prochain rendez-vous
// (/api/qg/vues). Heure d'Abidjan = UTC. Rien de connu : pas de deuxième ligne.

const JOUR = 86_400_000;
const jourDe = (ms: number) => Math.floor(ms / JOUR);
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** « aujourd’hui », « demain », sinon le jour court (« lun. »). */
function jourEnMots(ms: number, now: number) {
  const j = jourDe(ms) - jourDe(now);
  if (j === 0) return 'aujourd’hui';
  if (j === 1) return 'demain';
  return new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'short' });
}

export function rendezVous(e: EtatAgent | undefined, now: number | undefined): string | null {
  if (!e || now === undefined) return null;
  // mis en pause par le patron : rien d'autre à dire
  if (e.pause) return e.pause;
  if (e.prochainPassage) return `prochain : ${e.prochainPassage.titre} · ${jourEnMots(e.prochainPassage.quand, now)} ${hhmm(e.prochainPassage.quand)}`;
  if (e.rythme) return e.rythme;
  if (e.statut === 'bloque' && e.note) return e.note;
  return null;
}
