import { describe, expect, it } from 'vitest';
import { pasDeSalut, pasDeDanse } from './Agents';
import { Engine } from '@/sim/engine';

describe('le salut', () => {
  it('un petit saut répété : jamais de côté, jamais plus haut que la danse', () => {
    for (let t = 0; t < 3; t += 0.05) {
      const p = pasDeSalut(t);
      expect(p.rebond).toBeGreaterThanOrEqual(0);
      expect(p.rebond).toBeLessThan(pasDeDanse(0.25).rebond);
      expect(p.balance).toBe(0);
      expect(p.decale).toBe(0);
    }
  });
  it('le moteur retient qui salue', () => {
    const e = new Engine('calme', {});
    expect(e.salue('clara')).toBe(false);
    e.saluer('clara');
    expect(e.salue('clara')).toBe(true);
    expect(e.salue('luffy')).toBe(false);
    e.saluer(null);
    expect(e.salue('clara')).toBe(false);
  });
});
