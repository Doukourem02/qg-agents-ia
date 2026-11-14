import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { astreinteDuJour, planningSemaine, semaineISO, ORDRE_ASTREINTE } from './astreinte';

const J = 86_400_000;
const U = (a: number, m: number, j: number, h = 0, min = 0) => Date.UTC(a, m - 1, j, h, min);

describe('semaineISO (clé de l\'annonce du lundi)', () => {
  it('lundi 00:00 UTC', () => {
    expect(semaineISO(U(2026, 11, 10, 10))).toEqual({ annee: 2026, semaine: 46 });
    expect(semaineISO(U(2026, 11, 9))).toEqual({ annee: 2026, semaine: 46 });
    expect(semaineISO(U(2026, 11, 8, 23, 59))).toEqual({ annee: 2026, semaine: 45 });
    expect(semaineISO(U(2027, 1, 1))).toEqual({ annee: 2026, semaine: 53 });
  });
});

describe('astreinteDuJour : un agent différent chaque nuit', () => {
  it('la nuit qui commence à 20:00 le jour D appartient à D ; de 00:00 à 06:59 c\'est encore la nuit de la veille', () => {
    const mardi = astreinteDuJour(U(2026, 11, 10, 20));
    expect(astreinteDuJour(U(2026, 11, 10, 23, 59))).toBe(mardi);
    expect(astreinteDuJour(U(2026, 11, 11, 0, 0))).toBe(mardi);
    expect(astreinteDuJour(U(2026, 11, 11, 6, 59))).toBe(mardi);
    expect(astreinteDuJour(U(2026, 11, 11, 7, 0))).not.toBe(mardi); // le jour suivant : la nuit du mercredi
    expect(astreinteDuJour(U(2026, 11, 11, 20))).not.toBe(mardi);
    expect(astreinteDuJour(new Date(U(2026, 11, 11, 3)))).toBe(mardi); // accepte une Date
  });
  it('limite du lundi : lundi 03:00 est encore la nuit du dimanche, lundi 20:00 celle du lundi', () => {
    const dimanche = astreinteDuJour(U(2026, 11, 8, 22));
    expect(astreinteDuJour(U(2026, 11, 9, 3))).toBe(dimanche);
    expect(astreinteDuJour(U(2026, 11, 9, 20))).not.toBe(dimanche);
  });
  it('limite de l\'année : la nuit du 31 décembre court jusqu\'au 1er janvier 06:59', () => {
    const nuit = astreinteDuJour(U(2026, 12, 31, 21));
    expect(astreinteDuJour(U(2027, 1, 1, 6, 59))).toBe(nuit);
    expect(astreinteDuJour(U(2027, 1, 1, 20))).not.toBe(nuit);
    // la nuit du 1er janvier : jamais le même qu'avant, ni qu'après
    expect(astreinteDuJour(U(2027, 1, 2, 20))).not.toBe(astreinteDuJour(U(2027, 1, 1, 20)));
  });
  it('jamais le même agent deux nuits de suite, jamais Luffy, sur 300 semaines (dimanche → lundi compris)', () => {
    let avant = '';
    for (let n = 0; n < 7 * 300; n++) {
      const a = astreinteDuJour(U(2026, 1, 5, 20) + n * J);
      expect(a).not.toBe(avant);
      expect(ORDRE_ASTREINTE).toContain(a);
      avant = a;
    }
    expect(ORDRE_ASTREINTE).not.toContain('luffy');
  });
  it('déterministe ; la rotation décale d\'une semaine à l\'autre (un même agent ne tombe pas toujours le même jour)', () => {
    expect(astreinteDuJour(U(2026, 11, 10, 20))).toBe(astreinteDuJour(U(2026, 11, 10, 20)));
    const lundis = new Set<string>();
    for (let s = 0; s < 10; s++) lundis.add(astreinteDuJour(U(2026, 11, 9, 20) + 7 * s * J));
    expect(lundis.size).toBe(ORDRE_ASTREINTE.length);
  });
});

describe('planningSemaine : le planning que Kuroro fixe le lundi', () => {
  it('7 nuits, lundi à dimanche, identiques toute la semaine, même lundi 03:00 et dimanche 23:59', () => {
    const p = planningSemaine(U(2026, 11, 10, 15));
    expect(p.map(x => x.jour)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(planningSemaine(U(2026, 11, 9, 3))).toEqual(p);
    expect(planningSemaine(U(2026, 11, 15, 23, 59))).toEqual(p);
    expect(planningSemaine(U(2026, 11, 16))).not.toEqual(p);
  });
  it('colle à astreinteDuJour, sans doublon consécutif (y compris vers la semaine suivante)', () => {
    const p = planningSemaine(U(2026, 11, 10));
    p.forEach((x, i) => expect(x.agent).toBe(astreinteDuJour(U(2026, 11, 9 + i, 20))));
    for (let i = 1; i < 7; i++) expect(p[i].agent).not.toBe(p[i - 1].agent);
    expect(planningSemaine(U(2026, 11, 16))[0].agent).not.toBe(p[6].agent);
  });
  it('année : la semaine du 28 décembre 2026 va au 3 janvier 2027', () => {
    const p = planningSemaine(U(2027, 1, 1));
    expect(p[0].jour).toBe('2026-12-28');
    expect(p[6].jour).toBe('2027-01-03');
  });
});

describe('le calendrier affiche la nuit', () => {
  const src = readFileSync(new URL('../ui/OngletsReels.tsx', import.meta.url), 'utf8');
  // la légende de l'astreinte a quitté l'en-tête (« trop chargé », 13 novembre 2026) : la carte dit « d'astreinte »
  it('une carte de nuit par jour, « d’astreinte » et « cette nuit » aujourd\'hui, sans badge d\'état', () => {
    expect(src).toContain('astreinte-nuit');
    expect(src).toContain('20:00 → 07:00');
    expect(src).toContain('d’astreinte');
    expect(src).toContain('cette nuit');
    const carte = src.slice(src.indexOf('astreinte-nuit'), src.indexOf('cette nuit'));
    expect(carte).not.toContain('ETATS');
  });
});
