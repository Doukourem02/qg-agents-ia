import { describe, expect, it } from 'vitest';
import type { Creneau } from '@/server/vues';
import { regrouperRelances, resumePoints } from './calendrier';

const c = (routine: string, heure: string, etat: Creneau['etat'], conditionnel = false): Creneau => ({
  routine, agent: 'kuroro', nom: 'Kuroro', titre: routine, jour: 4, heure, quand: Number(heure.replace(':', '')), etat, ...(conditionnel ? { conditionnel } : {}),
});

describe('Calendrier allégé', () => {
  it('une relance conditionnelle répétée tient sur une ligne ; les autres créneaux restent un par un', () => {
    const { seuls, repetees } = regrouperRelances([
      c('point', '07:30', 'fait'),
      c('missions', '08:00', 'sans-objet', true), c('missions', '09:00', 'fait', true), c('missions', '10:00', 'rate', true),
      c('seule', '14:00', 'a-venir', true),
    ]);
    expect(seuls.map(x => x.routine)).toEqual(['point', 'seule']);
    expect(repetees).toEqual([expect.objectContaining({ routine: 'missions', de: '08:00', a: '10:00', n: 3, faits: 1, rates: 1, eteinte: false })]);
  });
  it('une relance qui n’a jamais tourné ce jour-là s’efface', () => {
    const { repetees } = regrouperRelances([c('m', '08:00', 'inactif', true), c('m', '09:00', 'inactif', true)]);
    expect(repetees[0].eteinte).toBe(true);
  });
  it('les points d’une réunion sont résumés au lieu d’être tous listés', () => {
    const h = (t: number) => `${t}`;
    expect(resumePoints([], 5, h)).toBe('aucun point encore · prochain 5');
    expect(resumePoints([1], undefined, h)).toBe('point 1');
    expect(resumePoints([1, 2, 3], 4, h)).toBe('3 points · dernier 3 · prochain 4');
  });
});
