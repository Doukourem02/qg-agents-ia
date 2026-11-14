import { describe, expect, it } from 'vitest';
import { etatCles } from './cles';

const NOW = Date.UTC(2026, 10, 11, 12, 0);
const JOUR = 86_400_000;

describe('etatCles', () => {
  it('clés : ≤ 14 jours → bientot ; passée → expiree ; GitHub sans date → sans-date ; LinkedIn absent → non-connecte', () => {
    expect(etatCles(NOW + 14 * JOUR, { expire: NOW - 1 }, NOW)).toEqual([
      { nom: 'GitHub (lecture)', expire: NOW + 14 * JOUR, etat: 'bientot' },
      { nom: 'LinkedIn', expire: NOW - 1, etat: 'expiree' },
    ]);
    expect(etatCles(null, null, NOW)).toEqual([
      { nom: 'GitHub (lecture)', expire: null, etat: 'sans-date' },
      { nom: 'LinkedIn', expire: null, etat: 'non-connecte' },
    ]);
    expect(etatCles(NOW + 15 * JOUR, { expire: NOW + 3 * JOUR }, NOW)).toEqual([
      { nom: 'GitHub (lecture)', expire: NOW + 15 * JOUR, etat: 'ok' },
      { nom: 'LinkedIn', expire: NOW + 3 * JOUR, etat: 'bientot' },
    ]);
    // pile à l'heure : déjà expirée
    expect(etatCles(NOW, null, NOW)[0].etat).toBe('expiree');
  });

  it('GitHub injoignable (expiration inconnue) : la clé GitHub n\'est pas listée (jamais « sans date » à tort)', () => {
    expect(etatCles(undefined, null, NOW)).toEqual([{ nom: 'LinkedIn', expire: null, etat: 'non-connecte' }]);
  });
});
