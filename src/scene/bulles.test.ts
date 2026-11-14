import { describe, expect, it } from 'vitest';
import { boiteEcran, ecarterBulles, MARGE_BULLES, type BoiteBulle } from './bulles';

const touche = (a: BoiteBulle, b: BoiteBulle) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const monte = (x: BoiteBulle, dy: number) => ({ ...x, t: x.t - dy, b: x.b - dy });

describe('ecarterBulles : deux bulles affichées ne se recouvrent jamais', () => {
  it('des bulles éloignées ne bougent pas', () => {
    const r = ecarterBulles([{ id: 'a', l: 0, r: 100, t: 0, b: 30 }, { id: 'b', l: 200, r: 300, t: 0, b: 30 }]);
    expect([...r.values()]).toEqual([0, 0]);
  });
  it('la première (l’échange en cours) reste en place ; celle qui tombe dessus monte juste au-dessus', () => {
    const a = { id: 'a', l: 0, r: 100, t: 100, b: 130 }, b = { id: 'b', l: 40, r: 140, t: 110, b: 140 };
    const r = ecarterBulles([a, b]);
    expect(r.get('a')).toBe(0);
    const b2 = monte(b, r.get('b')!);
    expect(touche(a, b2)).toBe(false);
    expect(b2.b).toBe(a.t - MARGE_BULLES);
  });
  it('un café bondé : quel que soit le tas de départ, plus aucun recouvrement', () => {
    let s = 3;
    const alea = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let k = 0; k < 50; k++) {
      const boites = Array.from({ length: 5 }, (_, i) => { const l = alea() * 80, t = 200 + alea() * 40; return { id: String(i), l, r: l + 60 + alea() * 70, t, b: t + 28 + alea() * 10 }; });
      const r = ecarterBulles(boites);
      const finales = boites.map(x => monte(x, r.get(x.id)!));
      for (let i = 0; i < finales.length; i++) for (let j = i + 1; j < finales.length; j++) expect(touche(finales[i], finales[j]), `${k}: ${i}/${j}`).toBe(false);
      for (const x of boites) expect(r.get(x.id)!).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('boiteEcran : la boîte de chaque étiquette à l’écran', () => {
  it('une pièce est centrée sur son point, un nom posé dessus, une bulle au-dessus de sa pointe', () => {
    expect(boiteEcran('p', 'piece', 100, 100, 40, 20, 2)).toEqual({ id: 'p', l: 60, r: 140, t: 80, b: 120 });
    expect(boiteEcran('n', 'nom', 100, 100, 40, 10, 1)).toEqual({ id: 'n', l: 80, r: 120, t: 90, b: 100 });
    expect(boiteEcran('b', 'bulle', 100, 100, 40, 20, 1)).toEqual({ id: 'b', l: 80, r: 120, t: 66, b: 90.5 });
  });
  it('« toujours » : un nom sous une pièce qui le cache remonte au-dessus d’elle, sans la déplacer', () => {
    const piece = boiteEcran('room:direction', 'piece', 200, 100, 80, 16, 1);
    const nom = boiteEcran('tag:clara', 'nom', 210, 110, 24, 10, 1);
    const r = ecarterBulles([piece, nom]);
    expect(r.get('room:direction')).toBe(0);
    expect(touche(piece, monte(nom, r.get('tag:clara')!))).toBe(false);
  });
});
