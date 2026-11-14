import type { Cle } from './types';

// L'état des clés que Zoro surveille : la clé GitHub (lecture) et la connexion LinkedIn de L.

const JOUR = 86_400_000;
export const JOURS_AVANT_ALERTE = 14;

function etat(expire: number, now: number): Cle['etat'] {
  if (expire <= now) return 'expiree';
  return expire - now <= JOURS_AVANT_ALERTE * JOUR ? 'bientot' : 'ok';
}

/**
 * `expirationGitHub` : ms UTC ; `null` = la clé n'a pas de date d'expiration ; `undefined` = pas lue (GitHub injoignable
 * ou clé absente) : la clé GitHub n'est alors pas listée, l'appelant la marque « non lue » (jamais « sans date » à tort).
 * `linkedin` : null = jamais connecté.
 */
export function etatCles(expirationGitHub: number | null | undefined, linkedin: { expire: number } | null, now: number): Cle[] {
  const cles: Cle[] = [];
  if (expirationGitHub === null) cles.push({ nom: 'GitHub (lecture)', expire: null, etat: 'sans-date' });
  else if (expirationGitHub !== undefined) cles.push({ nom: 'GitHub (lecture)', expire: expirationGitHub, etat: etat(expirationGitHub, now) });
  cles.push(linkedin
    ? { nom: 'LinkedIn', expire: linkedin.expire, etat: etat(linkedin.expire, now) }
    : { nom: 'LinkedIn', expire: null, etat: 'non-connecte' });
  return cles;
}
