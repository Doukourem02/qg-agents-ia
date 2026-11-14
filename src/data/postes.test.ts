import { describe, expect, it } from 'vitest';
import { ASSISES, FIG_SEATS, FURNITURE, MEETING_SEATS, POI, SEATS } from './layout';

const cle = ([x, y]: [number, number]) => `${x.toFixed(2)},${y.toFixed(2)}`;

describe('les postes de travail', () => {
  it('chaque poste a sa chaise de bureau (son assise centrée sur la place)', () => {
    const assises = FURNITURE.filter(b => b.z === 0.2 && Math.abs(b.w - 0.4) < 1e-6 && Math.abs(b.d - 0.4) < 1e-6).map(b => cle([b.x + 0.2, b.y + 0.2]));
    for (const p of [...Object.values(SEATS), ...FIG_SEATS]) expect(assises, cle(p)).toContain(cle(p));
  });
  it('les écrans des postes restent bas : on voit le visage de qui est assis derrière', () => {
    for (const b of FURNITURE.filter(f => f.poste)) expect((b.z ?? 0) + b.h, JSON.stringify(b)).toBeLessThanOrEqual(0.75);
  });
  it('on s\'assoit aux postes, aux tables du déjeuner, en réunion et dans les cabines', () => {
    const toutes = new Set(ASSISES.map(cle));
    for (const p of [...Object.values(SEATS), ...FIG_SEATS, ...MEETING_SEATS, ...POI.dejeunerCafe, ...POI.cabines]) expect(toutes.has(cle(p)), cle(p)).toBe(true);
    expect(toutes.has(cle(POI.barista))).toBe(false); // le cuisinier reste debout
  });
});
