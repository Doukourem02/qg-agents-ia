import { describe, expect, it } from 'vitest';
import { aiguilles, CLES_LUMIERE, coteDehors, HEURE_DEMO, heureDeLaDemo, instantAbidjan, instantDemo, lireHeure, lumiereA, minutesDe, ombreAuSol, soleilA, texteHorloge } from './lumiere';
import { GRID } from '@/data/layout';

const hm = (h: number, m = 0) => h * 60 + m;
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

describe('lumiereA : le ciel et la lumière suivent l\'heure d\'Abidjan (UTC)', () => {
  it('la nuit, de 00:00 à 05:15 et à partir de 19:45 : le ciel sombre d\'avant', () => {
    const nuit = { cielHaut: '#1f2a52', cielMilieu: '#2f3566', cielBas: '#463f6e', luminosite: 0.62, saturation: 0.8, sepia: 0 };
    for (const m of [0, hm(2), hm(5, 15), hm(19, 45), hm(22), hm(23, 59)]) expect(lumiereA(m), String(m)).toEqual(nuit);
  });
  it('le plein jour, de 10:00 à 15:00 : le ciel lavande de mes plans, sans filtre', () => {
    const jour = { cielHaut: '#6f8fe0', cielMilieu: '#9aa3e3', cielBas: '#c3b0e2', luminosite: 1, saturation: 1, sepia: 0 };
    for (const m of [hm(10), hm(12, 30), hm(15)]) expect(lumiereA(m), String(m)).toEqual(jour);
  });
  it('chaque moment à sa minute : aube, matin, fin d\'après-midi, coucher, crépuscule', () => {
    for (const k of CLES_LUMIERE) expect(lumiereA(k.minute), k.nom).toEqual(k.lumiere);
    const noms = CLES_LUMIERE.map(k => k.nom);
    for (const n of ['nuit', 'aube', 'matin', 'jour', 'fin d\'après-midi', 'coucher', 'crépuscule']) expect(noms).toContain(n);
    const a = (n: string) => CLES_LUMIERE.find(k => k.nom === n)!;
    expect(a('aube').minute).toBe(hm(5, 45));
    expect(a('matin').minute).toBe(hm(7));
    expect(a('fin d\'après-midi').minute).toBe(hm(16, 30));
    expect(a('coucher').minute).toBe(hm(18));
    expect(a('crépuscule').minute).toBe(hm(19));
    expect(a('matin').lumiere.luminosite).toBeCloseTo(0.95);
    expect(a('fin d\'après-midi').lumiere.sepia).toBeCloseTo(0.15);
    expect(a('fin d\'après-midi').lumiere.saturation).toBeCloseTo(1.05);
    expect(a('coucher').lumiere.luminosite).toBeCloseTo(0.85);
    expect(a('crépuscule').lumiere.luminosite).toBeCloseTo(0.72);
    // l'aube : un bas de ciel chaud (rose / orange), encore sombre en haut
    const [r, , b] = rgb(a('aube').lumiere.cielBas);
    expect(r).toBeGreaterThan(b);
    expect(a('aube').lumiere.luminosite).toBeLessThan(0.85);
  });
  it('continu : d\'une minute à l\'autre, presque rien ne change (jamais de saut)', () => {
    for (let m = 0; m < 1440; m++) {
      const x = lumiereA(m), y = lumiereA(m + 1);
      for (const c of ['cielHaut', 'cielMilieu', 'cielBas'] as const) {
        const d = rgb(x[c]).map((v, i) => Math.abs(v - rgb(y[c])[i]));
        expect(Math.max(...d), `${c} à ${m}`).toBeLessThanOrEqual(6);
      }
      for (const c of ['luminosite', 'saturation', 'sepia'] as const) expect(Math.abs(x[c] - y[c]), `${c} à ${m}`).toBeLessThan(0.02);
    }
  });
  it('tourne à minuit : 24:00 = 00:00, -1 = 23:59', () => {
    expect(lumiereA(1440)).toEqual(lumiereA(0));
    expect(lumiereA(-1)).toEqual(lumiereA(hm(23, 59)));
    expect(lumiereA(1440 + hm(12))).toEqual(lumiereA(hm(12)));
  });
});

describe('soleilA : le soleil d\'Abidjan en novembre (lever ≈ 06:00, coucher ≈ 18:10)', () => {
  it('à l\'est au lever, au sud vers 12:05, à l\'ouest au coucher', () => {
    expect(soleilA(hm(6)).azimut).toBeCloseTo(90);
    expect(soleilA(hm(12, 5)).azimut).toBeCloseTo(180);
    expect(soleilA(hm(18, 10)).azimut).toBeCloseTo(270);
  });
  it('haut à midi, bas au lever et au coucher, absent la nuit', () => {
    expect(soleilA(hm(12, 5)).elevation).toBeGreaterThan(60);
    expect(soleilA(hm(6, 30)).elevation).toBeLessThan(15);
    expect(soleilA(hm(17, 40)).elevation).toBeLessThan(15);
    for (const m of [hm(5), hm(5, 59), hm(18, 11), hm(22), 0]) expect(soleilA(m).visible, String(m)).toBe(false);
    for (const m of [hm(6, 1), hm(9), hm(12), hm(17)]) expect(soleilA(m).visible, String(m)).toBe(true);
  });
  it('tourne à minuit', () => {
    expect(soleilA(1440 + hm(9))).toEqual(soleilA(hm(9)));
  });
});

describe('ombreAuSol : l\'ombre à l\'opposé du soleil (est = +x, nord = -y du plan)', () => {
  it('le matin le soleil est à l\'est : l\'ombre part vers l\'ouest (-x)', () => {
    const o = ombreAuSol(hm(7));
    expect(o.dx).toBeLessThan(-0.9);
    expect(o.force).toBeGreaterThan(0);
  });
  it('le soir le soleil est à l\'ouest : l\'ombre part vers l\'est (+x)', () => {
    expect(ombreAuSol(hm(17, 30)).dx).toBeGreaterThan(0.9);
  });
  it('à midi le soleil est au sud : ombre courte, vers le nord (-y)', () => {
    const o = ombreAuSol(hm(12, 5));
    expect(o.dy).toBeLessThan(-0.99);
    expect(o.longueur).toBeLessThan(0.6);
  });
  it('longue au lever et au coucher, plus longue qu\'à 9 h', () => {
    expect(ombreAuSol(hm(6, 30)).longueur).toBeGreaterThan(ombreAuSol(hm(9)).longueur * 2);
    expect(ombreAuSol(hm(6, 30)).longueur).toBeLessThanOrEqual(6);
  });
  it('invisible la nuit, apparaît et s\'efface en douceur', () => {
    for (const m of [0, hm(5), hm(18, 30), hm(22)]) expect(ombreAuSol(m).force, String(m)).toBe(0);
    expect(ombreAuSol(hm(12)).force).toBe(1);
    const f = ombreAuSol(hm(6, 10)).force;
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
    for (let m = hm(5, 50); m < hm(18, 20); m++) expect(Math.abs(ombreAuSol(m + 1).force - ombreAuSol(m).force), String(m)).toBeLessThan(0.1);
  });
});

describe('l\'heure de la page', () => {
  it('minutesDe : les minutes depuis minuit UTC', () => {
    expect(minutesDe(Date.UTC(2026, 10, 11, 17, 20, 59))).toBe(hm(17, 20));
    expect(minutesDe(Date.UTC(2026, 10, 11, 0, 0))).toBe(0);
  });
  it('lireHeure : « HH:MM » valide, sinon rien', () => {
    expect(lireHeure('07:00')).toBe(hm(7));
    expect(lireHeure('17:20')).toBe(hm(17, 20));
    expect(lireHeure('7:05')).toBe(hm(7, 5));
    expect(lireHeure('23:59')).toBe(hm(23, 59));
    for (const t of [null, '', '24:00', '12:60', 'midi', '12h30', '-1:00', '12:3']) expect(lireHeure(t), String(t)).toBeNull();
  });
  it('instantAbidjan : l\'heure réelle à la minute, ou l\'heure forcée du jour (aperçu /demo)', () => {
    const now = Date.UTC(2026, 10, 11, 9, 41, 33);
    expect(instantAbidjan(now, null)).toBe(Date.UTC(2026, 10, 11, 9, 41));
    expect(instantAbidjan(now, hm(17, 20))).toBe(Date.UTC(2026, 10, 11, 17, 20));
  });
  it('texteHorloge : « 17:20 · mercredi 11 novembre »', () => {
    expect(texteHorloge(Date.UTC(2026, 10, 11, 17, 20))).toBe('17:20 · mercredi 11 novembre');
    expect(texteHorloge(Date.UTC(2026, 10, 12, 7, 5))).toBe('07:05 · jeudi 12 novembre');
  });
  it('aiguilles : angles dans le sens des aiguilles d\'une montre depuis midi', () => {
    expect(aiguilles(0)).toEqual({ heures: 0, minutes: 0 });
    const a = aiguilles(hm(3));
    expect(a.heures).toBeCloseTo(Math.PI / 2);
    expect(a.minutes).toBeCloseTo(0);
    const b = aiguilles(hm(17, 30));
    expect(b.minutes).toBeCloseTo(Math.PI);
    expect(b.heures).toBeCloseTo(((5.5) / 12) * Math.PI * 2);
  });
});

describe('/demo : toujours une lumière de jour, sauf ?heure=', () => {
  it('sans ?heure= (ou une heure invalide) : 10:30, en plein jour et en pleine énergie', () => {
    expect(HEURE_DEMO).toBe(hm(10, 30));
    expect(heureDeLaDemo(null)).toBe(hm(10, 30));
    expect(heureDeLaDemo('midi')).toBe(hm(10, 30));
    expect(lumiereA(heureDeLaDemo(null)).luminosite).toBe(1);
  });
  it('?heure= garde la main', () => {
    expect(heureDeLaDemo('22:00')).toBe(hm(22));
  });
  it('/demo avance : ?heure= est l’heure de départ, puis le temps réel s’ajoute (à la minute)', () => {
    const debut = Date.UTC(2026, 10, 11, 21, 7, 42);
    const MIN = 60_000;
    expect(minutesDe(instantDemo(debut, hm(10, 30), debut))).toBe(hm(10, 30));
    expect(minutesDe(instantDemo(debut + 59_000, hm(10, 30), debut))).toBe(hm(10, 30));
    expect(minutesDe(instantDemo(debut + MIN, hm(10, 30), debut))).toBe(hm(10, 31));
    expect(minutesDe(instantDemo(debut + 95 * MIN, hm(10, 30), debut))).toBe(hm(12, 5));
    // le jour reste celui de l'ouverture ; minuit passé, on change de jour
    expect(new Date(instantDemo(debut, hm(23, 59), debut)).getUTCDate()).toBe(11);
    expect(new Date(instantDemo(debut + 2 * MIN, hm(23, 59), debut)).getUTCDate()).toBe(12);
  });
});

describe('coteDehors : une ombre d\'arbre ne touche jamais le bâtiment', () => {
  const bat = { x: 0, y: 0, w: GRID.w, h: GRID.h };
  const coins: [number, number][] = [[0, 0], [bat.w, 0], [0, bat.h], [bat.w, bat.h]];
  const garde = (c: { nx: number; ny: number; c: number }, x: number, y: number) => c.nx * x + c.ny * y + c.c;
  it('le demi-plan gardé contient l\'arbre et aucun point du bâtiment (ses quatre coins sont dehors)', () => {
    for (const [x, y] of [[-1.6, 4], [-2.1, 29.6], [6.5, 31.7], [34.6, 31.9], [41, 2.6], [42.1, 30.2], [39.8, 30.9], [-0.9, 22.3]] as [number, number][]) {
      const c = coteDehors(x, y, bat);
      expect(garde(c, x, y), `${x},${y}`).toBeGreaterThan(0);
      for (const [cx, cy] of coins) expect(garde(c, cx, cy), `${x},${y} coin ${cx},${cy}`).toBeLessThanOrEqual(0);
    }
  });
  it('choisit le côté le plus proche : à gauche (ouest), devant (sud), à droite (est)', () => {
    expect(coteDehors(-1.6, 15, bat)).toMatchObject({ nx: -1, ny: 0 });
    expect(coteDehors(15.8, 31.8, bat)).toMatchObject({ nx: 0, ny: 1 });
    expect(coteDehors(41, 13.6, bat)).toMatchObject({ nx: 1, ny: 0 });
  });
  it('les murs du fond ont une épaisseur : à gauche, la limite passe derrière leur face extérieure', () => {
    const c = coteDehors(-1.6, 4, { ...bat, marge: 0.35 });
    expect(garde(c, -0.35, 4)).toBeLessThanOrEqual(0);
    expect(garde(c, -0.4, 4)).toBeGreaterThan(0);
  });
});
