import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { onAirAllume } from './onair';
import { Engine } from '@/sim/engine';
import { FURNITURE } from '@/data/layout';

describe('l\'enseigne ON AIR', () => {
  it('allumée seulement dans /demo et pendant un vrai tournage ; éteinte sinon, jour et nuit', () => {
    expect(onAirAllume(true, true)).toBe(true);
    expect(onAirAllume(true, false)).toBe(false);
    expect(onAirAllume(true, undefined)).toBe(false);
    expect(onAirAllume(false, true)).toBe(false); // la page privée : jamais
    const e = new Engine('calme', {});
    e.setNuit(true);
    expect(onAirAllume(true, e.snapshot().studioOn)).toBe(false); // la nuit, personne ne tourne
  });
  it('éteinte, elle est grise (pas un rouge pâli qui aurait l\'air allumé) ; une seule enseigne, dans le décor', () => {
    const motifs = readFileSync('src/scene/motifs.ts', 'utf8');
    const eteinte = motifs.slice(motifs.indexOf('  onair: g =>'), motifs.indexOf("  'onair-allume'"));
    expect(eteinte).not.toMatch(/#[a-f0-9]*(d6|e0|b5)3[0-9a-f]{3}/i);
    expect(eteinte).toContain('#2a2a36');
    expect(FURNITURE.filter(b => b.motif === 'onair')).toHaveLength(1);
    expect(readFileSync('src/ui/Overlay.tsx', 'utf8')).not.toContain('ON AIR');
  });
});
