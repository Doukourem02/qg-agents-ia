import { describe, expect, it } from 'vitest';
import { bords, derriere, dessous, DESSUS_DU_DESSOUS, devant, droite, gauche, hamac, SOLS, terrainDeFoot, FOOT } from './paysage';
import { chant, lireChoixSons, ecrireChoixSons, attenteChant } from './sons';
import { GRID, ILE } from '@/data/layout';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

describe('le paysage autour du bureau', () => {
  const r = rng(1);
  const tout = [...derriere(), ...gauche(r), ...droite(r), ...devant(), ...hamac(42.4, 13.85, 18.55, 1.05), ...terrainDeFoot()];
  it('rien ne traverse le bâtiment ni ses murs du fond (la cour, la terrasse, le terrain, le potager, le parking sont dehors)', () => {
    for (const b of tout) {
      const dedans = b.x < GRID.w && b.x + b.w > -0.36 && b.y < GRID.h && b.y + b.d > -0.36;
      expect(dedans, JSON.stringify(b)).toBe(false);
    }
  });
  it('tout est posé sur l\'île', () => {
    for (const b of tout) {
      expect(b.x >= ILE.x - 1e-6 && b.x + b.w <= ILE.x + ILE.w + 1e-6 && b.y >= ILE.y - 1e-6 && b.y + b.d <= ILE.y + ILE.d + 1e-6, JSON.stringify(b)).toBe(true);
    }
    for (const [x, y, w, d] of SOLS) expect(x >= ILE.x && x + w <= ILE.x + ILE.w && y >= ILE.y && y + d <= ILE.y + ILE.d).toBe(true);
  });
  it('le terrain de foot : à côté du terrain de basket, de la même taille, sans le toucher ni toucher l\'allée', () => {
    const foot = terrainDeFoot(), y1 = Math.max(...foot.map(b => b.y + b.d)), x1 = Math.max(...foot.map(b => b.x + b.w));
    expect([FOOT.w, FOOT.d]).toEqual([5.8, 8.0]); // la taille du terrain de basket
    expect(y1).toBeLessThan(16.0); // le terrain de basket (et sa bordure) commence en y 16
    expect(x1).toBeLessThan(-1.25); // l'allée de gauche commence en x −1,25
    expect(Math.min(...foot.map(b => b.x))).toBeGreaterThan(ILE.x); // sur l'île
  });
  it('le dessous de l\'île : une montagne renversée, sous le contour, plus profonde au milieu, frugale', () => {
    const d = dessous(rng(4));
    expect(d.length).toBeLessThan(2500);
    for (const b of d) {
      expect(b.z + b.h).toBeLessThanOrEqual(DESSUS_DU_DESSOUS + 1e-6);
      expect(b.x >= ILE.x - 1e-6 && b.x + b.w <= ILE.x + ILE.w + 1e-6 && b.y >= ILE.y - 1e-6 && b.y + b.d <= ILE.y + ILE.d + 1e-6).toBe(true);
    }
    const plusBas = Math.min(...d.map(b => b.z));
    expect(plusBas).toBeLessThan(DESSUS_DU_DESSOUS - 6);
    // près des bords, le dessous reste mince (la cascade tombe le long du bord sans rien traverser)
    const bord = d.filter(b => b.y + b.d > ILE.y + ILE.d - 0.01 && b.x < 22 && b.x + b.w > 20);
    for (const b of bord) expect(b.z).toBeGreaterThan(DESSUS_DU_DESSOUS - 3);
  });
  it('le bord de l\'île a du relief des quatre côtés (on peut tourner autour)', () => {
    const b = bords(rng(2));
    const X1 = ILE.x + ILE.w, Y1 = ILE.y + ILE.d;
    expect(b.some(x => x.y + x.d > Y1 + 0.01)).toBe(true); // devant
    expect(b.some(x => x.y < ILE.y - 0.01)).toBe(true); // derrière
    expect(b.some(x => x.x + x.w > X1 + 0.01)).toBe(true); // à droite
    expect(b.some(x => x.x < ILE.x - 0.01)).toBe(true); // à gauche
  });
});

describe('les sons du jardin', () => {
  it('coupés par défaut ; le choix retenu ; un stockage refusé ne casse rien', () => {
    expect(lireChoixSons(null)).toBe(false);
    expect(lireChoixSons({ getItem: () => null })).toBe(false);
    expect(lireChoixSons({ getItem: () => 'oui' })).toBe(true);
    expect(lireChoixSons({ getItem: () => { throw new Error('refusé'); } })).toBe(false);
    const m = new Map<string, string>();
    ecrireChoixSons({ setItem: (k, v) => m.set(k, v) }, true);
    expect(lireChoixSons({ getItem: k => m.get(k) ?? null })).toBe(true);
    expect(() => ecrireChoixSons({ setItem: () => { throw new Error('refusé'); } }, true)).not.toThrow();
  });
  it('des chants courts, aigus, au hasard ; pas trop souvent', () => {
    const r = rng(3);
    for (let k = 0; k < 50; k++) {
      const c = chant(r);
      expect(c.length).toBeGreaterThan(0);
      expect(c.length).toBeLessThanOrEqual(7);
      for (const p of c) { expect(p.de).toBeGreaterThan(1500); expect(p.de).toBeLessThan(7000); expect(p.duree).toBeLessThan(0.2); }
      const a = attenteChant(r);
      expect(a).toBeGreaterThanOrEqual(3);
      expect(a).toBeLessThanOrEqual(14);
    }
  });
});
