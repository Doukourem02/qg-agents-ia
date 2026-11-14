import { AGENTS } from './routing';

// Quand j'écoute de la musique sur mon vrai Spotify, un personnage du bureau met le casque et danse.
// Décision du patron (9 novembre 2026) : Spotify tourne sur mon Mac, donc ce sont les agents du pôle Mac & Outils
// (Isaac, Clara, Malenia) qui écoutent, tirés au sort, jamais deux fois de suite le même.
// Le même garde le casque tout le morceau ; on tire à nouveau seulement quand le morceau change.

/** Les agents du pôle Mac & Outils. */
export const AUDITEURS: readonly string[] = AGENTS.filter(a => a.pole === 'mac').map(a => a.id);

export type Choix = { morceau: string; agentId: string };

/**
 * Garde le choix précédent pour le même morceau ; sinon un personnage au hasard (`alea` dans [0, 1[),
 * jamais celui du morceau précédent.
 */
export function choisirAuditeur(morceau: string, precedent: Choix | null, alea: () => number = Math.random, tous: readonly string[] = AUDITEURS): Choix {
  if (precedent && precedent.morceau === morceau) return precedent;
  const possibles = tous.length > 1 && precedent ? tous.filter(id => id !== precedent.agentId) : tous;
  const i = Math.min(possibles.length - 1, Math.max(0, Math.floor(alea() * possibles.length)));
  return { morceau, agentId: possibles[i] };
}
