import { describe, expect, it } from 'vitest';
import data from '@/data/agents.json';
import { CAP, corps, hauteur, HAUT_TETE, U, versAngle } from './voxels';

describe('les personnages en 3D', () => {
  it('chaque personnage du QG a un corps complet : tronc, deux bras, deux jambes, des cubes bien formés', () => {
    for (const a of data.agents) {
      const c = corps(a.id);
      for (const m of [c.tronc, c.brasG, c.brasD, c.jambeG, c.jambeD]) {
        expect(m.length).toBeGreaterThan(0);
        for (const k of m) {
          expect(k.x1).toBeGreaterThan(k.x0); expect(k.y1).toBeGreaterThan(k.y0); expect(k.z1).toBeGreaterThan(k.z0);
          expect(k.c).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      }
    }
  });
  it('un personnage mesure à peu près comme son ancien sprite (entre 0,7 et 0,95 case), pieds au sol', () => {
    for (const a of data.agents) {
      expect(hauteur(a.id)).toBeGreaterThanOrEqual(HAUT_TETE * U);
      expect(hauteur(a.id)).toBeLessThan(0.95);
      expect(Math.min(...corps(a.id).jambeG.map(k => k.y0))).toBeCloseTo(-5.5);
    }
  });
  it('un figurant a un corps lui aussi ; Feu, Malenia et Tom portent un couvre-chef à la place des cheveux', () => {
    expect(corps('fig3').tronc.length).toBeGreaterThan(3);
    expect(corps('luffy').tronc.some(k => k.c === '#f2d26b')).toBe(true);
    expect(corps('tom').tronc.some(k => k.c === '#d94b3b')).toBe(true);
  });
  it('assis, on regarde du côté de sa chaise ; on tourne par le plus court chemin', () => {
    expect(CAP.S).toBe(0);
    expect(CAP.E).toBeCloseTo(Math.PI / 2);
    expect(versAngle(3, -3, 1)).toBeCloseTo(-3 + 2 * Math.PI);
    expect(versAngle(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});
