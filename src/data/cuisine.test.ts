import { describe, expect, it } from 'vitest';
import { FURNITURE, POI, roomAt, roomById } from './layout';
import { findPath } from '@/sim/path';

describe('la Cuisine et sa salle à manger', () => {
  it('s\'appelle Cuisine, vitrée, avec deux ouvertures ; sa salle à manger (l\'ancien espace vide) en fait partie', () => {
    const c = roomById('cafe');
    expect(c.nom).toBe('Cuisine');
    expect(c.vitre).toBe(true);
    expect(c.portes).toHaveLength(2);
    expect(roomAt(35.4, 8.5)?.id).toBe('cafe'); // la salle à manger
    expect(roomAt(28, 14)?.id).toBe('cafe');
  });
  it('de quoi faire un café, réchauffer un plat et manger : chaque place de déjeuner est sur une chaise', () => {
    // une assise de chaise : un bloc de 0,38 × 0,38 à 0,22 de haut
    const assises = FURNITURE.filter(b => (b.z ?? 0) === 0.22 && Math.abs(b.w - 0.38) < 1e-6 && Math.abs(b.d - 0.38) < 1e-6);
    for (const [x, y] of POI.dejeunerCafe) {
      expect(assises.some(b => Math.abs(b.x + b.w / 2 - x) < 1e-6 && Math.abs(b.y + b.d / 2 - y) < 1e-6), `${x}, ${y}`).toBe(true);
    }
    expect(POI.dejeunerCafe.filter(([x, y]) => roomAt(x, y) && x > 32)).toHaveLength(12); // 3 tables × 4 dans la salle à manger
  });
  it('on va de la Cuisine à sa salle à manger, et du couloir à chacune', () => {
    expect(findPath([28, 14], [35.4, 8.9]).length).toBeGreaterThan(0);
    expect(findPath([23.5, 11.5], [27, 13]).length).toBeGreaterThan(0);
    expect(findPath(POI.barista, POI.cafe[0]).length).toBeGreaterThan(0);
  });
});
