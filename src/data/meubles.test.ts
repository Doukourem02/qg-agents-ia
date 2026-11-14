import { describe, expect, it } from 'vitest';
import { canape, chaise, chaiseDeBureau, etagere, lampe, pot, table, tableRonde, tabouret, tasse } from './meubles';
import type { Box } from './layout';

const dedans = (bs: Box[], x0: number, y0: number, x1: number, y1: number) => bs.every(b => b.x >= x0 - 1e-6 && b.y >= y0 - 1e-6 && b.x + b.w <= x1 + 1e-6 && b.y + b.d <= y1 + 1e-6);

describe('les meubles en pièces fines', () => {
  it('chaque pièce a une taille, et aucun meuble ne déborde de sa place', () => {
    const tous = [table(1, 1, 2, 1), tableRonde(5, 5), chaise(3, 3, 'S'), chaiseDeBureau(3, 3, 'E'), tabouret(2, 2), canape(0, 0, 2.4, 0.9, 'S', '#c94a5a', '#d96a7a'), etagere(0, 0, 2, 0.45, 1.2, 'S'), lampe(1, 1), tasse(1, 1, 0.42), pot(2, 2)];
    for (const m of tous) for (const b of m) expect(b.w > 0 && b.d > 0 && b.h > 0, JSON.stringify(b)).toBe(true);
    expect(dedans(table(1, 1, 2, 1), 1, 1, 3, 2)).toBe(true);
    expect(dedans(chaise(3, 3, 'S'), 2.8, 2.8, 3.2, 3.2)).toBe(true);
    expect(dedans(etagere(0, 0, 2, 0.45, 1.2, 'S'), 0, 0, 2, 0.45)).toBe(true);
    expect(dedans(etagere(0, 0, 0.45, 2, 1.2, 'E'), 0, 0, 0.45, 2)).toBe(true);
  });
  it('le dossier d\'une chaise est à l\'opposé du côté où l\'on regarde', () => {
    const dossier = (bs: Box[]) => bs.reduce((a, b) => ((b.z ?? 0) + b.h > (a.z ?? 0) + a.h ? b : a));
    expect(dossier(chaise(3, 3, 'S')).y).toBeLessThan(3); // tourné vers le bas : le dossier en haut
    expect(dossier(chaise(3, 3, 'N')).y).toBeGreaterThan(3);
    expect(dossier(chaise(3, 3, 'E')).x).toBeLessThan(3);
    expect(dossier(chaise(3, 3, 'W')).x).toBeGreaterThan(3);
  });
  it('les objets ronds sont des cylindres ; seuls les plateaux et les fonds bloquent le passage', () => {
    expect(tableRonde(5, 5).every(b => b.forme === 'cylindre')).toBe(true);
    expect(tasse(1, 1, 0.42)[0].forme).toBe('cylindre');
    expect(table(1, 1, 2, 1).filter(b => b.bloque)).toHaveLength(1);
    expect(chaise(3, 3, 'S').some(b => b.bloque)).toBe(false);
  });
  it('deux étagères ne rangent pas leurs livres pareil', () => {
    const couleurs = (bs: Box[]) => bs.map(b => b.c).join();
    expect(couleurs(etagere(0, 0, 2, 0.45, 1.2, 'S'))).not.toBe(couleurs(etagere(5, 3, 2, 0.45, 1.2, 'S')));
  });
});
