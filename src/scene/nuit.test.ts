import { describe, expect, it } from 'vitest';
import { FENETRE, FENETRES_E, FENETRES_N, FENETRES_S, FENETRES_W, occupee, pieceDeFenetre, piecesOccupees, posteCle, postesOccupes, volumePiece } from './nuit';
import { FIG_SEATS, FURNITURE, GRID, PORTE, ROOMS, SEATS } from '@/data/layout';
import { Engine } from '@/sim/engine';
import { allumage, astres, lumiereA } from '@/sim/lumiere';

const hm = (h: number, m = 0) => h * 60 + m;
const presence = (e: Engine) => ({ agents: e.agents, present: (id: string) => e.present(id) });

describe('les lumières de la nuit suivent l\'heure (lumiereA)', () => {
  it('éteintes en plein jour et au matin, allumées la nuit, en douceur au crépuscule', () => {
    for (const m of [hm(7, 30), hm(10), hm(12), hm(15), hm(17)]) expect(allumage(lumiereA(m)), String(m)).toBe(0);
    for (const m of [hm(20), hm(22), hm(2), hm(5)]) expect(allumage(lumiereA(m)), String(m)).toBe(1);
    let avant = 0;
    for (let m = hm(17, 30); m <= hm(19, 45); m += 5) {
      const t = allumage(lumiereA(m));
      expect(t).toBeGreaterThanOrEqual(avant);
      avant = t;
    }
    expect(allumage(lumiereA(hm(18, 30)))).toBeGreaterThan(0);
    expect(allumage(lumiereA(hm(18, 30)))).toBeLessThan(1);
  });
  it('la lune et les étoiles seulement quand le ciel est sombre', () => {
    expect(astres(lumiereA(hm(12)))).toBe(0);
    expect(astres(lumiereA(hm(17, 45)))).toBe(0);
    expect(astres(lumiereA(hm(22)))).toBe(1);
  });
});

describe('rien de faux qui semble réel : une pièce ne s\'éclaire que si quelqu\'un y est', () => {
  it('la nuit, personne : aucune pièce, aucun écran', () => {
    const e = new Engine('calme', {});
    e.setNuit(true);
    expect(piecesOccupees(presence(e)).size).toBe(0);
    expect(postesOccupes(presence(e)).size).toBe(0);
  });
  it('la nuit, Luffy qui veille : seulement le Pôle Code, seulement son écran', () => {
    const e = new Engine('calme', {});
    e.setNuit(true);
    e.setLuffyVeille(true);
    expect([...piecesOccupees(presence(e))]).toEqual(['code']);
    expect([...postesOccupes(presence(e))]).toEqual([posteCle(SEATS.luffy)]);
  });
  it('l\'agent d\'astreinte éclaire sa pièce, pas les autres', () => {
    const e = new Engine('calme', {});
    e.setNuit(true);
    e.setAstreinte('clara');
    expect([...piecesOccupees(presence(e))]).toEqual(['mac']);
  });
  it('chaque écran de bureau a sa place assise, celle d\'un agent ou d\'un figurant', () => {
    const places = new Set([...Object.values(SEATS), ...FIG_SEATS].map(posteCle));
    const ecrans = FURNITURE.filter(b => b.poste);
    expect(ecrans.length).toBeGreaterThan(40);
    for (const b of ecrans) expect(places.has(posteCle(b.poste!)), posteCle(b.poste!)).toBe(true);
  });
});

describe('les fenêtres et les volumes éclairés', () => {
  it('chaque fenêtre des murs du fond donne sur sa pièce, ou sur un couloir (sombre)', () => {
    expect(pieceDeFenetre('N', FENETRES_N[0])).toBe('code');
    expect(pieceDeFenetre('N', FENETRES_N[6])).toBeNull(); // entre la Direction et Mac & Outils
    expect(pieceDeFenetre('N', FENETRES_N[11])).toBe('toilettes');
    expect(pieceDeFenetre('W', FENETRES_W[0])).toBe('code');
    expect(pieceDeFenetre('W', FENETRES_W[4])).toBe('pause');
    expect(pieceDeFenetre('W', FENETRES_W[7])).toBe('atelier');
    // devant et à droite
    expect(pieceDeFenetre('S', FENETRES_S[0])).toBe('atelier');
    expect(pieceDeFenetre('S', FENETRES_S[7])).toBeNull(); // devant la salle de réunion, il y a le couloir
    expect(pieceDeFenetre('S', FENETRES_S.at(-1)!)).toBe('accords');
    expect(pieceDeFenetre('E', FENETRES_E[0])).toBe('toilettes');
    expect(pieceDeFenetre('E', FENETRES_E[2])).toBe('cafe'); // la salle à manger s'éclaire avec la Cuisine
    expect(pieceDeFenetre('E', FENETRES_E[5])).toBe('studio');
    expect(pieceDeFenetre('E', FENETRES_E[8])).toBe('accords');
  });
  it('aucune fenêtre du mur de devant sur la porte d\'entrée ; toutes tiennent dans leur mur', () => {
    for (const x of FENETRES_S) expect(x + FENETRE <= PORTE.x || x >= PORTE.x + PORTE.w, `${x}`).toBe(true);
    for (const x of [...FENETRES_N, ...FENETRES_S]) expect(x > 0 && x + FENETRE < GRID.w).toBe(true);
    for (const y of [...FENETRES_W, ...FENETRES_E]) expect(y > 0 && y + FENETRE < GRID.h).toBe(true);
  });
  it('le volume d\'une pièce n\'entre jamais dans les murs du bâtiment, et couvre toute la pièce', () => {
    for (const r of ROOMS) {
      const v = volumePiece(r.id)!;
      expect(v.x0).toBeGreaterThan(0);
      expect(v.y0).toBeGreaterThan(0);
      expect(v.x1).toBeLessThan(GRID.w);
      expect(v.y1).toBeLessThan(GRID.h);
      expect(v.x0).toBeLessThanOrEqual(r.r[0] || 0.01);
      expect(v.y0).toBeLessThanOrEqual(r.r[1] || 0.01);
      expect(v.x1).toBeGreaterThanOrEqual(Math.min(r.r[0] + r.r[2], GRID.w - 0.01));
      expect(v.y1).toBeGreaterThanOrEqual(Math.min(r.r[1] + r.r[3], GRID.h - 0.01));
    }
  });
});

describe('le voyant des cabines téléphoniques', () => {
  it('rouge seulement si quelqu\'un de présent est sur la place', () => {
    const place: [number, number] = [34.1, 13.35];
    expect(occupee(place, [], () => true)).toBe(false);
    expect(occupee(place, [{ id: 'a', x: 34.1, y: 13.35 }], () => true)).toBe(true);
    expect(occupee(place, [{ id: 'a', x: 34.1, y: 13.35 }], () => false)).toBe(false); // parti (la nuit, par exemple)
    expect(occupee(place, [{ id: 'a', x: 35.5, y: 13.35 }], () => true)).toBe(false); // à côté, pas dedans
  });
});
