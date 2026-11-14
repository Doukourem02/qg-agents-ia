import { afterEach, describe, expect, it, vi } from 'vitest';
import { angleProche, axesEcran, COTES_MURS, decalageConversation, REMONTEE_CONVERSATION, directionCamera, ELEV_MAX, ELEV_MIN, ELEVATION, mursAbaisses, remettreLaVue, surGeste, surRoulette, tourner, vue, vueBougee, ZOOM_MAX } from './vue';

afterEach(() => { vue.azimut = 0; vue.az = 0; vue.elevation = ELEVATION; vue.el = ELEVATION; vue.zoom = 1; vue.panX = 0; vue.panZ = 0; });

describe('le pincement zoome la scène, jamais la page', () => {
  it('pincer sur le pavé tactile (molette avec ctrl) : preventDefault, et la scène grossit', () => {
    const e = { ctrlKey: true, deltaY: -40, preventDefault: vi.fn() };
    surRoulette(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(vue.zoom).toBeGreaterThan(1);
  });
  it('la molette simple aussi (sur la scène) ; le zoom reste borné', () => {
    for (let i = 0; i < 200; i++) surRoulette({ ctrlKey: false, deltaY: -500, preventDefault: () => {} });
    expect(vue.zoom).toBe(ZOOM_MAX);
  });
  it('les gestes de Safari (pincer, tourner à deux doigts) : preventDefault à chaque étape', () => {
    const ev = (scale: number, rotation: number) => ({ scale, rotation, preventDefault: vi.fn() });
    const a = ev(1, 0), b = ev(1.5, 30), c = ev(1.5, 30);
    surGeste('gesturestart', a); surGeste('gesturechange', b); surGeste('gestureend', c);
    for (const x of [a, b, c]) expect(x.preventDefault).toHaveBeenCalled();
    expect(vue.zoom).toBeCloseTo(1.5);
    expect(vue.azimut).toBeCloseTo(-Math.PI / 6);
  });
});

describe('tourner autour du bureau', () => {
  it('l\'angle de départ est exactement celui de mes plans (isométrie 2:1, vue à 30°)', () => {
    const [x, y, z] = directionCamera(0, ELEVATION);
    expect(x).toBeCloseTo(Math.cos(Math.PI / 6) / Math.SQRT2);
    expect(y).toBeCloseTo(0.5);
    expect(z).toBeCloseTo(Math.cos(Math.PI / 6) / Math.SQRT2);
    expect(axesEcran(0).droite.x).toBeCloseTo(Math.SQRT1_2);
    expect(axesEcran(0).droite.z).toBeCloseTo(-Math.SQRT1_2);
  });
  it('un tour complet à l\'horizontale ; l\'inclinaison bornée, jamais sous l\'île', () => {
    tourner(800, 0);
    expect(Math.abs(vue.azimut)).toBeGreaterThan(Math.PI * 2 - 0.01);
    tourner(0, -100000);
    expect(vue.elevation).toBe(ELEV_MIN);
    expect(ELEV_MIN).toBeGreaterThan(0.2);
    tourner(0, 100000);
    expect(vue.elevation).toBe(ELEV_MAX);
    expect(ELEV_MAX).toBeLessThan(Math.PI / 2);
  });
  it('le mur entre la caméra et l\'intérieur se baisse (règle des Sims, sur les 4 murs) ; les autres restent hauts', () => {
    // à l'angle de départ : devant (sud) et droite (est) en murets, l'intérieur entièrement visible
    expect(mursAbaisses(0)).toEqual({ N: false, W: false, S: true, E: true });
    expect(mursAbaisses(Math.PI / 2)).toEqual({ N: false, W: true, S: true, E: false });
    // vu de dos : le sud et l'est sont hauts, le nord et l'ouest se baissent
    expect(mursAbaisses(Math.PI)).toEqual({ N: true, W: true, S: false, E: false });
    expect(mursAbaisses(-Math.PI / 2)).toEqual({ N: true, W: false, S: false, E: true });
  });
  it('à tout angle, de deux murs opposés, l\'un au moins est baissé : rien ne cache jamais l\'intérieur', () => {
    for (let az = -Math.PI; az <= Math.PI; az += 0.01) {
      const m = mursAbaisses(az);
      expect(!m.N && !m.S, `${az}`).toBe(false);
      expect(!m.W && !m.E, `${az}`).toBe(false);
    }
  });
  it('au chargement, les murs ont déjà la hauteur de l\'angle de départ (rien ne bouge à l\'ouverture)', () => {
    const bas = mursAbaisses(0);
    for (const c of COTES_MURS) expect(vue.murs[c]).toBe(bas[c] ? 0 : 1);
  });
  it('« Remettre la vue » revient au cadrage exact, par le plus court chemin', () => {
    vue.az = vue.azimut = Math.PI * 2 + 0.3; vue.elevation = 1; vue.zoom = 2; vue.panX = 3;
    expect(vueBougee()).toBe(true);
    remettreLaVue();
    expect(angleProche(vue.azimut, 0)).toBeCloseTo(0);
    expect(Math.abs(vue.azimut - vue.az)).toBeCloseTo(0.3);
    expect(vue.elevation).toBe(ELEVATION);
    expect(vue.zoom).toBe(1);
    expect(vueBougee()).toBe(false);
  });
});

describe('la conversation avec Kuroro : l\'île remonte à l\'écran', () => {
  it('à tout angle, le point visé descend vers le bas de l\'écran, sans glisser de côté, de la bonne hauteur', () => {
    for (const az of [0, 0.7, Math.PI / 2, Math.PI, -2.1]) for (const el of [ELEV_MIN, ELEVATION, ELEV_MAX]) {
      const { droite, haut } = axesEcran(az), zoom = 37, H = 900;
      const o = decalageConversation(az, el, H, zoom);
      expect(o.x * droite.x + o.z * droite.z).toBeCloseTo(0);
      // un pas au sol le long de « haut » monte à l'écran de pas × sin(inclinaison) × zoom pixels
      expect(-(o.x * haut.x + o.z * haut.z) * Math.sin(el) * zoom).toBeCloseTo(REMONTEE_CONVERSATION * H);
    }
  });
});
