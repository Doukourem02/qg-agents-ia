import { describe, expect, it } from 'vitest';
import { FIG_SEATS, POI, SEATS, type Pt } from '@/data/layout';
import { AGENTS_REELS } from '@/data/reels';
import { LAMPADAIRES } from '@/scene/Nature';
import { Engine } from './engine';
import { jourDe } from './journee';
import { allumage, instantDemo, lireJour, lumiereA, versLeJour } from './lumiere';
import {
  CABINES_WC, chemin, HAMAC, PART_DU_WEEK_END, planDuJour, ROUTE, TERRAINS, TOUR_DU_POTAGER, typeDeJour, VEHICULES, type PlanJour, type Terrain,
} from './vie';

const hm = (h: number, m = 0) => h * 60 + m;
const MIN = 60_000;
// mercredi 11, samedi 14 et dimanche 15 novembre 2026
const MERCREDI = jourDe(Date.UTC(2026, 10, 11)), SAMEDI = jourDe(Date.UTC(2026, 10, 14)), DIMANCHE = jourDe(Date.UTC(2026, 10, 15));
const quand = (jour: number, h: number, m = 0) => jour * 86_400_000 + hm(h, m) * MIN;
const prive = (jour: number, h: number, m = 0) => new Engine('calme', { muets: [...AGENTS_REELS, 'stalker'], prive: true, heure: quand(jour, h, m) });
const demo = (jour: number, h: number, m = 0) => new Engine('calme', { vif: true, heure: quand(jour, h, m) });
const marche = (e: Engine, secondes: number, dt = 1 / 10) => { for (let i = 0; i < secondes / dt; i++) e.tick(dt); };
const plan = (e: Engine) => e.plan!;
const dans = (t: Terrain, x: number, y: number, m = 0.05) => x >= t.x - m && x <= t.x + t.w + m && y >= t.y - m && y <= t.y + t.d + m;
const gensDe = (e: Engine) => e.agents.map(a => ({ id: a.id, still: a.still, scripted: a.scripted }));
const toilettes = (p: PlanJour) => p.creneaux.filter(c => c.act.type === 'toilettes');

describe('le jour de la semaine (heure d’Abidjan)', () => {
  it('mercredi 11 novembre 2026 : semaine ; samedi 14 et dimanche 15 : le week-end', () => {
    expect(typeDeJour(MERCREDI)).toBe('semaine');
    expect(typeDeJour(SAMEDI)).toBe('samedi');
    expect(typeDeJour(DIMANCHE)).toBe('dimanche');
  });
  it('/demo ?jour=samedi : le prochain samedi, à la même heure ; sans jour, rien ne change', () => {
    expect(lireJour('samedi')).toBe(6);
    expect(lireJour('Dimanche')).toBe(0);
    expect(lireJour('n’importe quoi')).toBeNull();
    const mer = quand(MERCREDI, 10, 30);
    expect(versLeJour(mer, 6)).toBe(quand(SAMEDI, 10, 30));
    expect(versLeJour(quand(SAMEDI, 10, 30), 6)).toBe(quand(SAMEDI, 10, 30));
    expect(versLeJour(mer, null)).toBe(mer);
    expect(instantDemo(mer + 5 * MIN, hm(16, 30), mer, 6)).toBe(quand(SAMEDI, 16, 35));
  });
});

describe('le chemin du dehors', () => {
  const lieux: Pt[] = [
    [TERRAINS.foot.x + 2, TERRAINS.foot.y + 3], [TERRAINS.basket.x + 3, TERRAINS.basket.y + 5], HAMAC, ...TOUR_DU_POTAGER.map(t => t.p), ...VEHICULES, ROUTE,
  ];
  it('de chaque poste à chaque lieu du dehors, et retour', () => {
    for (const [id, p] of [...Object.entries(SEATS), ...FIG_SEATS.map((p, i) => [`fig${i}`, p] as const)]) for (const l of lieux) {
      const aller = chemin(p, l), retour = chemin(l, p);
      expect(aller.length, id).toBeGreaterThan(0);
      expect(aller[aller.length - 1]).toEqual(l);
      expect(retour[retour.length - 1]).toEqual(p);
    }
  });
  it('dehors, on ne traverse jamais le bâtiment : on en sort par la porte', () => {
    for (const l of lieux) for (const ch of [chemin(POI.entree, l), chemin(l, POI.entree)]) {
      const pts: Pt[] = [l === ch[ch.length - 1] ? POI.entree : l, ...ch];
      for (let i = 1; i < pts.length; i++) for (let f = 0; f <= 1; f += 0.05) {
        const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
        const dedans = x > -0.2 && x < 39.1 && y > -0.2 && y < 30.0;
        const porte = Math.hypot(x - POI.entree[0], y - POI.entree[1]) < 0.9;
        expect(!dedans || porte, `${x.toFixed(2)}, ${y.toFixed(2)} vers ${l}`).toBe(true);
      }
    }
  });
});

describe('les toilettes : chacun y va, une personne par cabine', () => {
  const e = prive(MERCREDI, 10);
  const p = plan(e);
  it('tous ceux qui sont là y vont 2 à 3 fois dans la journée, 3 à 5 minutes, pendant leurs heures', () => {
    for (const [id, pr] of p.presence) {
      if (pr.terrain) continue;
      const v = toilettes(p).filter(c => c.id === id);
      expect(v.length, id).toBeGreaterThanOrEqual(2);
      expect(v.length, id).toBeLessThanOrEqual(3);
      for (const c of v) {
        expect(c.fin - c.debut).toBeGreaterThanOrEqual(3);
        expect(c.fin - c.debut).toBeLessThanOrEqual(5);
        expect(c.debut).toBeGreaterThan(pr.arrivee);
        expect(c.fin).toBeLessThan(pr.depart);
      }
    }
    // plus souvent après le déjeuner
    const apresDej = toilettes(p).filter(c => c.debut >= hm(13, 25) && c.debut < hm(14, 45)).length;
    expect(apresDej).toBeGreaterThan(toilettes(p).length / 4);
  });
  it('une personne par cabine : deux visites de la même cabine ne se chevauchent jamais', () => {
    for (let k = 0; k < 4; k++) {
      const v = toilettes(p).filter(c => c.act.type === 'toilettes' && c.act.cabine === k).sort((a, b) => a.debut - b.debut);
      for (let i = 1; i < v.length; i++) expect(v[i].debut).toBeGreaterThanOrEqual(v[i - 1].fin);
    }
  });
  it('la simulation : dans la cabine, on ne le voit pas (il est là), la porte est fermée ; une personne par cabine', () => {
    let vu = false;
    for (let m = 0; m < 120 && !vu; m += 3) {
      const x = prive(MERCREDI, 9, 30 + m);
      marche(x, 2);
      const occ = x.cabinesOccupees();
      const caches = x.agents.filter(a => x.cache(a.id));
      expect(occ.filter(Boolean).length).toBe(new Set(caches.map(a => a.activite!.c.act.type === 'toilettes' && a.activite!.c.act.cabine)).size);
      expect(caches.length).toBeLessThanOrEqual(4);
      for (const a of caches) {
        expect(x.present(a.id)).toBe(true);
        expect(x.visible(a.id)).toBe(false);
        expect(x.snapshot().rooms.toilettes).toBe('occupées');
      }
      if (caches.length) vu = true;
    }
    expect(vu).toBe(true);
  });
  it('à son heure, il marche jusqu’à la cabine, y entre, en ressort et retourne à son poste', () => {
    const c = toilettes(p).find(x => x.debut > hm(10, 5) && !e.get(x.id)!.scripted && !e.get(x.id)!.still)!;
    const x = prive(MERCREDI, 10);
    const a = x.get(c.id)!;
    x.setHeure(quand(MERCREDI, 10) + Math.ceil(c.debut - hm(10)) * MIN);
    let cache = false;
    for (let i = 0; i < 600 && !cache; i++) { x.tick(0.1); cache = x.cache(a.id); }
    expect(cache).toBe(true);
    x.setHeure(quand(MERCREDI, 10) + Math.ceil(c.fin - hm(10)) * MIN);
    // il ressort, puis rejoint son poste dans la minute (une fois revenu, il peut repartir pour une course : on
    // regarde qu'il y soit arrivé, pas qu'il y soit encore à la 60e seconde)
    let rentre = false;
    for (let i = 0; i < 600 && !rentre; i++) { x.tick(0.1); rentre = !x.cache(a.id) && x.atHome(a); }
    expect(x.cache(a.id)).toBe(false);
    expect(rentre).toBe(true);
  });
});

describe('après le travail, en semaine : le match du soir', () => {
  const e = prive(MERCREDI, 18, 45);
  const m = plan(e).matchs[0];
  it('6 à 10 joueurs, foot ou basket ; ils partent tous avant 20:00', () => {
    expect(m.cle).toBe('soir');
    expect(m.joueurs.length).toBeGreaterThanOrEqual(6);
    expect(m.joueurs.length).toBeLessThanOrEqual(10);
    for (const id of m.joueurs) expect(plan(e).presence.get(id)!.depart, id).toBeLessThan(hm(19, 45));
  });
  it('18:45 : ils sont sur le terrain, ils courent, le ballon circule ; les lampadaires sont allumés, un près de chaque terrain', () => {
    const T = TERRAINS[m.sport];
    marche(e, 20);
    for (const id of m.joueurs) { const a = e.get(id)!; expect(dans(T, a.x, a.y), id).toBe(true); expect(e.visible(id)).toBe(true); }
    expect(e.ballons().length).toBe(1);
    const avant = m.joueurs.map(id => [e.get(id)!.x, e.get(id)!.y]);
    marche(e, 5);
    expect(m.joueurs.filter((id, i) => Math.hypot(e.get(id)!.x - avant[i][0], e.get(id)!.y - avant[i][1]) > 0.2).length).toBeGreaterThan(m.joueurs.length / 2);
    expect(allumage(lumiereA(hm(18, 45)))).toBeGreaterThan(0.7);
    for (const t of Object.values(TERRAINS)) expect(LAMPADAIRES.some(([x, y]) => x > t.x - 1 && x < t.x + t.w + 1 && y > t.y && y < t.y + t.d)).toBe(true);
  });
  it('à la fin, chacun part du terrain (par la porte, ou par le parking) ; à 19:50, plus personne sur le terrain', () => {
    const x = prive(MERCREDI, 19, 20);
    for (let t = hm(19, 21); t <= hm(19, 50); t++) { x.setHeure(quand(MERCREDI, 0) + t * MIN); marche(x, 60, 1 / 5); }
    for (const id of m.joueurs) expect(x.present(id), id).toBe(false);
    expect(x.ballons()).toEqual([]);
  });
  it('un vrai agent en vraie tâche n’est jamais au match : il reste (ou retourne) à son poste', () => {
    // un jour où un vrai agent est au match du soir
    let jour = MERCREDI, id: string | undefined;
    for (let k = 0; k < 40 && !id; k++) {
      jour = MERCREDI + k;
      if (typeDeJour(jour) !== 'semaine') continue;
      id = planDuJour(jour, gensDe(e)).matchs[0].joueurs.find(j => (AGENTS_REELS as readonly string[]).includes(j));
    }
    expect(id).toBeDefined();
    const x = prive(jour, 18, 30);
    const now = Date.now();
    x.appliquerReel({ [id!]: { statut: 'au travail', tache: 'relit une page', quand: now - MIN } }, now);
    marche(x, 60);
    const a = x.get(id!)!;
    expect(x.atHome(a)).toBe(true);
    expect(a.activite ?? null).toBeNull();
    // et il ne part pas au match pendant qu'il travaille
    marche(x, 30);
    expect(x.atHome(a)).toBe(true);
  });
});

describe('à midi et l’après-midi : les paniers, la sieste, le potager, les pièces peu utilisées', () => {
  it('12:30 : deux ou trois font des paniers au basket', () => {
    const e = prive(MERCREDI, 12, 30);
    const joueurs = e.agents.filter(a => a.activite?.c.act.type === 'paniers');
    expect(joueurs.length).toBeGreaterThanOrEqual(2);
    expect(joueurs.length).toBeLessThanOrEqual(3);
    for (const a of joueurs) expect(dans(TERRAINS.basket, a.x, a.y)).toBe(true);
    marche(e, 3);
    expect(e.ballons().length).toBe(1);
  });
  it('14:00 : quelqu’un fait la sieste au hamac (une personne à la fois)', () => {
    const e = prive(MERCREDI, 14);
    const s = e.agents.filter(a => a.activite?.c.act.type === 'hamac');
    expect(s.length).toBe(1);
    expect(e.allonge(s[0])).toBe(true);
    expect([s[0].x, s[0].y]).toEqual(HAMAC);
  });
  it('quelqu’un arrose le potager, le matin ou le soir ; un café à deux et deux points avec Kuroro', () => {
    const p = planDuJour(MERCREDI, gensDe(prive(MERCREDI, 10)));
    expect(p.creneaux.filter(c => c.act.type === 'arrosage').length).toBe(1);
    const rdv = p.creneaux.filter(c => c.act.type === 'rdv');
    expect(rdv.filter(c => c.act.type === 'rdv' && c.act.lieu === 'direction' && c.id === 'kuroro').length).toBe(2);
    expect(rdv.filter(c => c.act.type === 'rdv' && c.act.lieu === 'salle').length).toBeGreaterThanOrEqual(4);
  });
  it('certains viennent en voiture, à moto, à vélo : une personne par véhicule', () => {
    const p = planDuJour(MERCREDI, gensDe(prive(MERCREDI, 10)));
    const v = [...p.presence.values()].filter(x => x.vehicule);
    expect(v.length).toBe(VEHICULES.length);
    expect(new Set(v.map(x => x.vehicule)).size).toBe(VEHICULES.length);
  });
  it('arrivé en voiture : il apparaît au parking et marche jusqu’à la porte', () => {
    const e = prive(MERCREDI, 6, 59);
    const [id, pr] = [...plan(e).presence].filter(([, x]) => x.vehicule && x.arrivee > hm(7, 5)).sort((a, b) => a[1].arrivee - b[1].arrivee)[0];
    const k = Math.ceil(pr.arrivee);
    e.setHeure(quand(MERCREDI, 0) + (k - 1) * MIN); marche(e, 30);
    e.setHeure(quand(MERCREDI, 0) + k * MIN);
    let auParking = false, aLaPorte = false;
    for (let i = 0; i < 1200 && !aLaPorte; i++) {
      e.tick(0.1);
      const a = e.get(id)!;
      if (e.present(id) && a.y > 31) auParking = true;
      if (auParking && Math.hypot(a.x - POI.entree[0], a.y - POI.entree[1]) < 0.6) aLaPorte = true;
    }
    expect(auParking).toBe(true);
    expect(aLaPorte).toBe(true);
  });
});

describe('le week-end', () => {
  it('samedi : environ un tiers au bureau, arrivés entre 09:00 et 10:00, partis plus tôt', () => {
    const e = prive(SAMEDI, 11);
    const p = plan(e);
    const bureau = [...p.presence.entries()].filter(([, x]) => !x.terrain);
    expect(bureau.length).toBeGreaterThan(e.agents.length * PART_DU_WEEK_END * 0.5);
    expect(bureau.length).toBeLessThan(e.agents.length * PART_DU_WEEK_END * 1.6);
    for (const [id, x] of bureau) {
      const joue = p.matchs.some(m => m.joueurs.includes(id));
      if (!joue) { expect(x.arrivee).toBeGreaterThanOrEqual(hm(9)); expect(x.depart).toBeLessThanOrEqual(hm(17, 30)); }
      expect(x.arrivee).toBeLessThan(hm(10));
    }
    const semaine = prive(MERCREDI, 11);
    expect(e.agents.filter(a => e.present(a.id)).length).toBeLessThan(semaine.agents.filter(a => semaine.present(a.id)).length * 0.6);
  });
  it('samedi 10:30 : le match de foot, une dizaine de joueurs sur le terrain', () => {
    const e = demo(SAMEDI, 10, 30);
    const m = plan(e).matchs.find(x => x.cle === 'samedi-foot')!;
    expect(m.joueurs.length).toBe(10);
    marche(e, 20);
    expect(m.joueurs.filter(id => { const a = e.get(id)!; return e.present(id) && dans(TERRAINS.foot, a.x, a.y); }).length).toBeGreaterThanOrEqual(9);
    expect(e.ballons().map(b => b.sport)).toEqual(['foot']);
  });
  it('samedi 16:30 : le tournoi de basket ; dimanche : un seul match en fin d’après-midi', () => {
    const e = demo(SAMEDI, 16, 30);
    const m = plan(e).matchs.find(x => x.cle === 'samedi-basket')!;
    marche(e, 20);
    expect(m.joueurs.filter(id => { const a = e.get(id)!; return dans(TERRAINS.basket, a.x, a.y); }).length).toBeGreaterThanOrEqual(6);
    const d = plan(demo(DIMANCHE, 12));
    expect(d.matchs.length).toBe(1);
    expect(d.matchs[0].debut).toBeGreaterThanOrEqual(hm(16));
  });
  it('ceux qui viennent seulement pour le match arrivent du parking ou de la route, et repartent par là', () => {
    const e = demo(SAMEDI, 9, 49);
    const [id] = [...plan(e).presence].find(([, x]) => x.terrain && x.arrivee > hm(9, 50) && !x.vehicule)!;
    let vuDehors = false;
    for (let t = hm(9, 50); t <= hm(10, 2); t++) {
      e.setHeure(quand(SAMEDI, 0) + t * MIN);
      for (let i = 0; i < 300; i++) { e.tick(0.2); const a = e.get(id)!; if (e.present(id) && a.y > 31) vuDehors = true; }
    }
    expect(vuDehors).toBe(true);
    const a = e.get(id)!;
    expect(dans(TERRAINS.foot, a.x, a.y)).toBe(true);
  });
});

describe('ce qui ne change pas', () => {
  it('la nuit : personne (semaine comme week-end), aucune activité', () => {
    for (const jour of [MERCREDI, SAMEDI]) {
      const e = prive(jour, 22);
      e.setNuit(true);
      marche(e, 5);
      expect(e.agents.filter(a => e.present(a.id))).toEqual([]);
      expect(e.agents.some(a => a.activite)).toBe(false);
      expect(e.ballons()).toEqual([]);
    }
  });
  it('Pleine journée : tout le monde à son poste, aucune activité, même à 18:45', () => {
    const e = new Engine('pleine', { heure: quand(MERCREDI, 18, 45) });
    marche(e, 10);
    expect(e.agents.every(a => e.atHome(a) && !a.activite)).toBe(true);
    expect(e.ballons()).toEqual([]);
  });
  it('les toilettes et les portes : une cabine libre a sa porte ouverte', () => {
    const e = prive(MERCREDI, 22);
    e.setNuit(true);
    expect(e.cabinesOccupees()).toEqual([false, false, false, false]);
    expect(CABINES_WC.length).toBe(4);
  });
});
