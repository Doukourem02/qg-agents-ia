import type { KV } from '../memoire';
import { journaliser, Refus } from '../qg';
import { compteRendu, type EtatMatin } from './message';
import { lireEtatMatin } from './lecture';

// L'envoi du compte rendu du matin (QStash, chaque jour 08:15 UTC) : au plus un message par jour.
// La marque `matin:envoi:<jour>` n'est posée qu'après un envoi réussi ; Telegram en échec → rien n'est marqué,
// Refus 503 pour que QStash réessaie (comme le tour de Zoro). Lecture et envoi injectés : testable sans réseau.

export type DepsMatin = {
  envoyer: (texte: string) => Promise<unknown>;
  /** La lecture de l'état (Upstash) ; remplaçable dans les tests. */
  lire?: (kv: KV, now: number) => Promise<EtatMatin>;
};

const JOUR = 86_400_000;
const HEURE_MATIN = 8 * 3_600_000 + 15 * 60_000;
const MARGE_MS = 10 * 60_000; // un réveil QStash quelques secondes avant 08:15 (horloges) reste dans son jour
const VERROU_S = 120;
const MARQUE_S = 3 * 86_400; // plus longtemps que son créneau

export const CLES_MATIN = {
  envoi: (jour: string) => `matin:envoi:${jour}`,
  verrou: 'matin:verrou',
} as const;

/** Le texte que le journal note quand le message est parti (le motif de la routine « kuroro-matin »). */
export const TEXTE_JOURNAL = 'a envoyé le compte rendu du matin';

/**
 * Le créneau (et son jour) : le dernier 08:15 UTC atteint (à 10 minutes près). Un essai lancé avant 08:05 appartient
 * à la veille : il ne bloque jamais le message du matin même.
 */
export function creneauDuMatin(now: number): number {
  const t = now + MARGE_MS;
  const minuit = t - (((t % JOUR) + JOUR) % JOUR);
  return minuit + HEURE_MATIN <= t ? minuit + HEURE_MATIN : minuit - JOUR + HEURE_MATIN;
}
export const jourDuCreneau = (now: number) => new Date(creneauDuMatin(now)).toISOString().slice(0, 10);

export type ResultatMatin = { envoye: true; jour: string } | { envoye: false; deja: true; jour: string };

export async function envoyerCompteRendu(kv: KV, deps: DepsMatin, now: number = Date.now()): Promise<ResultatMatin> {
  const jour = jourDuCreneau(now);
  const marque = CLES_MATIN.envoi(jour);
  if ((await kv.get(marque)) !== null) return { envoye: false, deja: true, jour };
  if (!(await kv.setnx(CLES_MATIN.verrou, String(now), VERROU_S))) throw new Refus('un envoi du compte rendu est déjà en cours', 503);
  try {
    // relu sous le verrou : un envoi parallèle a pu finir entre-temps
    if ((await kv.get(marque)) !== null) return { envoye: false, deja: true, jour };
    const etat = await (deps.lire ?? lireEtatMatin)(kv, now);
    const texte = compteRendu(etat, now);
    try {
      await deps.envoyer(texte);
    } catch {
      console.error('matin : envoi Telegram échoué');
      throw new Refus('le compte rendu n\'est pas parti sur Telegram, nouvel essai attendu', 503);
    }
    await kv.setnx(marque, String(now), MARQUE_S);
    // un réveil quelques secondes avant 08:15 est noté à 08:15 : le Calendrier ne compte que les entrées après l'heure
    await journaliser(kv, { quand: Math.max(now, creneauDuMatin(now)), agent: 'kuroro', type: 'etat', statut: 'termine', texte: TEXTE_JOURNAL, origine: 'agent' });
    return { envoye: true, jour };
  } finally {
    await kv.del(CLES_MATIN.verrou).catch(() => undefined);
  }
}
