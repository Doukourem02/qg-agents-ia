import { describe, expect, it } from 'vitest';
import { etiquettesPieces } from './pieces';
import { ANNEXES, planToGrid, ROOMS } from './layout';

const SIM = { code: '7/7 au poste', accords: '2 en attente · 5 validés', atelier: '5 projets en cours', cafe: '3 en pause', pause: 'PS5 · baby-foot · arcade', studio: 'tournage en cours' };

describe('étiquettes des pièces', () => {
  it('/demo : celles de la simulation', () => {
    expect(etiquettesPieces(SIM, true, 4)).toEqual(SIM);
  });
  it('page privée : aucun chiffre de la simulation, le vrai nombre d’attentes aux accords', () => {
    expect(etiquettesPieces(SIM, false, 2)).toEqual({ code: '', accords: '2 en attente de toi', atelier: '', cafe: '', pause: 'PS5 · baby-foot · arcade', studio: '' });
  });
  it('page privée : rien aux accords quand rien n’attend ou avant la première lecture', () => {
    expect(etiquettesPieces(SIM, false, 0).accords).toBe('');
    expect(etiquettesPieces(SIM, false, undefined).accords).toBe('');
  });
});

describe('le pictogramme de chaque pièce est dans la pièce', () => {
  it('jamais dans un couloir, dans une autre pièce ou sur l\'herbe : au moins 0,3 case à l\'intérieur', () => {
    for (const r of ROOMS) {
      const [x, y] = planToGrid(...r.etiquette), [x0, y0, w, d] = r.r;
      expect(x > x0 + 0.3 && x < x0 + w - 0.3 && y > y0 + 0.3 && y < y0 + d - 0.3, `${r.id} : ${x.toFixed(1)}, ${y.toFixed(1)}`).toBe(true);
    }
  });
});

describe('le plan : des couloirs entre les pièces, la Salle à manger nommée', () => {
  const rect = (id: string, annexe = false) => { const r = ROOMS.find(p => p.id === id)!; return annexe ? r.annexe!.r : r.r; };
  /** L'écart entre deux rectangles (le plus grand des écarts en x et en y ; négatif s'ils se chevauchent). */
  const ecart = (a: number[], b: number[]) => Math.max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]), b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]));
  it('au moins deux cases de couloir entre les pièces voisines', () => {
    for (const [a, b] of [[rect('mac'), rect('cafe', true)], [rect('mac'), rect('communication')], [rect('communication'), rect('atelier')], [rect('communication'), rect('reunion')], [rect('direction'), rect('mac')], [rect('communication'), rect('cafe')]]) {
      expect(ecart(a, b), `${a} / ${b}`).toBeGreaterThanOrEqual(2);
    }
  });
  it('la Salle à manger a son nom et son pictogramme, dans son annexe ; elle ouvre la fiche de la Cuisine', () => {
    const s = ANNEXES.find(a => a.nom === 'Salle à manger')!;
    expect(s.piece).toBe('cafe');
    const [x, y] = planToGrid(...s.etiquette), [x0, y0, w, d] = rect('cafe', true);
    expect(x > x0 + 0.3 && x < x0 + w - 0.3 && y > y0 + 0.3 && y < y0 + d - 0.3).toBe(true);
  });
});
