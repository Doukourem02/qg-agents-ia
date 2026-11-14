import { describe, expect, it } from 'vitest';
import { arbresDuDecor, LAMPADAIRES } from './Nature';
import { roomWalls } from './World';
import { EPAISSEUR_MUR, FURNITURE, GRID, ILE, POI, PORTE } from '@/data/layout';
import { findPath } from '@/sim/path';

/** Un pavé (x, y, largeur, profondeur) entre-t-il dans un mur du bâtiment ? (la porte d'entrée est un trou du mur sud) */
function dansUnMur(x: number, y: number, w: number, d: number) {
  const E = EPAISSEUR_MUR, e = 1e-6;
  const coupe = (a0: number, a1: number, b0: number, b1: number) => a1 > b0 + e && a0 < b1 - e;
  const murs: [number, number, number, number][] = [
    [-E, -E, GRID.w + E, 0], // nord
    [-E, 0, 0, GRID.h], // ouest
    [GRID.w, -E, GRID.w + E, GRID.h], // est
    [-E, GRID.h, PORTE.x, GRID.h + E], [PORTE.x + PORTE.w, GRID.h, GRID.w + E, GRID.h + E], // sud, de part et d'autre de la porte
  ];
  return murs.some(([x0, y0, x1, y1]) => coupe(x, x + w, x0, x1) && coupe(y, y + d, y0, y1));
}

describe('le décor autour du bâtiment', () => {
  const arbres = arbresDuDecor();
  it('des arbres de chaque côté (on tourne autour du bureau), aucun dans le bâtiment ni dans ses murs', () => {
    expect(arbres.length).toBeGreaterThan(25);
    for (const a of arbres) expect(a.x > -0.5 - a.l && a.x < GRID.w + 0.3 && a.y > -0.5 - a.l && a.y < GRID.h + 0.3, `${a.x}, ${a.y}`).toBe(false);
    expect(arbres.some(a => a.y < 0), 'derrière').toBe(true);
    expect(arbres.some(a => a.x < 0), 'à gauche').toBe(true);
    expect(arbres.some(a => a.x > GRID.w), 'à droite').toBe(true);
    expect(arbres.some(a => a.y > GRID.h), 'devant').toBe(true);
  });
  it('tous sur l\'île', () => {
    for (const a of arbres) {
      expect(a.x).toBeGreaterThan(ILE.x);
      expect(a.x).toBeLessThan(ILE.x + ILE.w);
      expect(a.y).toBeGreaterThan(ILE.y);
      expect(a.y).toBeLessThan(ILE.y + ILE.d);
    }
  });
  it('rien de haut devant l\'entrée : aucun arbre dans l\'axe de la caméra vers le paillasson', () => {
    const [ex, ey] = POI.entree;
    // devant l'entrée, vers la caméra : (x − y) proche de celui de l'entrée, et plus près de la caméra (x + y plus grand)
    for (const a of arbres) {
      const devant = a.x + a.y > ex + ey && Math.abs(a.x - a.y - (ex - ey)) < 1.6 + a.rx;
      expect(devant, `${a.x}, ${a.y}`).toBe(false);
    }
  });
  it('un lampadaire près de l\'entrée', () => {
    const [ex, ey] = POI.entree;
    expect(LAMPADAIRES.some(([x, y]) => Math.hypot(x - ex, y - ey) < 3)).toBe(true);
  });
});

describe('les quatre murs du bâtiment', () => {
  it('rien ne traverse un mur : ni meuble, ni muret, ni arbre (sauf l\'auvent, fixé au-dessus de la porte)', () => {
    for (const b of FURNITURE) {
      const auvent = (b.z ?? 0) >= PORTE.h - 1e-6 && b.x < PORTE.x + PORTE.w && b.x + b.w > PORTE.x;
      if (!auvent) expect(dansUnMur(b.x, b.y, b.w, b.d), JSON.stringify(b)).toBe(false);
    }
    for (const m of roomWalls()) expect(dansUnMur(m.x, m.y, m.w, m.d), JSON.stringify(m)).toBe(false);
    for (const a of arbresDuDecor()) expect(dansUnMur(a.x - a.l / 2, a.y - a.l / 2, a.l, a.l), `${a.x}, ${a.y}`).toBe(false);
  });
  it('la porte d\'entrée est dans le mur de devant, juste devant le paillasson : on entre et on sort par elle', () => {
    const [ex, ey] = POI.entree;
    expect(ex).toBeGreaterThan(PORTE.x + 0.3);
    expect(ex).toBeLessThan(PORTE.x + PORTE.w - 0.3);
    expect(GRID.h - ey).toBeLessThan(1);
    // de l'entrée, on rejoint l'autre bout du bâtiment
    expect(findPath(POI.entree, [2, 2]).length).toBeGreaterThan(0);
  });
});

describe('les murets et les vitres des pièces', () => {
  it('un seul bloc par pan de mur entre deux portes : aucune vitre n\'en chevauche une autre (pas de coin doublé)', () => {
    const murs = roomWalls().filter(m => m.vitre);
    const chevauche = (a: (typeof murs)[number], b: (typeof murs)[number]) =>
      Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > 1e-6;
    for (let i = 0; i < murs.length; i++) for (let j = i + 1; j < murs.length; j++) expect(chevauche(murs[i], murs[j]), `${i} ${j}`).toBe(false);
    expect(murs.length).toBeGreaterThan(0);
    expect(roomWalls().length).toBeLessThan(80);
  });
});
