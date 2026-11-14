import { describe, expect, it } from 'vitest';
import { FIG_SEATS, POI, SEATS, roomAt } from '@/data/layout';
import { agentById } from './routing';
import { AGENTS_REELS } from '@/data/reels';
import { bullesProches, Engine, PLACES_DEJEUNER } from './engine';
import { findPath } from './path';
import {
  ARRIVEE_MAX, ARRIVEE_MIN, BORNES, DEPART_MAX, DEPART_MIN, ECHANGES, echangesA, ENERGIES, energieA, heureArrivee, heureDepart,
  jourDe, momentA, pauseCafe, relanceA, TITRES, type MomentJour,
} from './journee';

const hm = (h: number, m = 0) => h * 60 + m;
const JOUR = jourDe(Date.UTC(2026, 10, 11));
const a = (h: number, m = 0, s = 0) => Date.UTC(2026, 10, 11, h, m, s);
const MIN = 60_000;

describe('momentA : le moment de la journée (heure d’Abidjan)', () => {
  it('les bornes : 07:00, 08:30, 12:00, 13:30, 15:00, 17:30, 20:00', () => {
    const cas: [number, MomentJour][] = [
      [hm(6, 59), 'nuit'], [hm(7), 'arrivees'], [hm(8, 29), 'arrivees'], [hm(8, 30), 'matinee'], [hm(11, 59), 'matinee'],
      [hm(12), 'dejeuner'], [hm(13, 29), 'dejeuner'], [hm(13, 30), 'creux'], [hm(14, 59), 'creux'], [hm(15), 'reprise'],
      [hm(17, 29), 'reprise'], [hm(17, 30), 'departs'], [hm(19, 59), 'departs'], [hm(20), 'nuit'], [0, 'nuit'], [hm(24 + 10), 'matinee'],
    ];
    for (const [m, attendu] of cas) expect(momentA(m), String(m)).toBe(attendu);
  });
  it('chaque moment a son titre et sa petite ligne pour le panneau Réglages', () => {
    expect(TITRES.arrivees.titre).toBe('Matin · les arrivées');
    expect(TITRES.creux.titre).toBe("Début d'après-midi · le coup de mou");
    expect(TITRES.nuit.titre).toBe('Nuit · bureau fermé');
    for (const t of Object.values(TITRES)) expect(t.detail.length).toBeGreaterThan(5);
  });
});

describe('energieA : l’énergie du moment', () => {
  it('le coup de mou : moins de marcheurs, marche plus lente, longues attentes, bulles rares', () => {
    const matin = energieA(hm(10)), mou = energieA(hm(14));
    expect(matin).toEqual(ENERGIES.matinee);
    expect(mou.marcheurs).toBeLessThan(matin.marcheurs);
    expect(mou.vitesse).toBeLessThan(matin.vitesse);
    expect(mou.attente[0]).toBeGreaterThan(matin.attente[0]);
    expect(mou.bulle).toBeLessThan(matin.bulle);
    expect(mou.bavardage).toBeGreaterThan(matin.bavardage);
    // ça repart un peu l'après-midi, moins que le matin
    expect(energieA(hm(16)).marcheurs).toBeGreaterThan(mou.marcheurs);
    expect(energieA(hm(16)).marcheurs).toBeLessThan(matin.marcheurs);
  });
  it('sans à-coup : d’une minute à l’autre, l’énergie change peu (sauf à l’ouverture et à la fermeture)', () => {
    for (let m = hm(7); m < hm(20) - 1; m++) {
      const x = energieA(m), y = energieA(m + 1);
      expect(Math.abs(x.marcheurs - y.marcheurs), String(m)).toBeLessThan(0.2);
      expect(Math.abs(x.vitesse - y.vitesse), String(m)).toBeLessThan(0.03);
    }
    // à la borne, la moitié du chemin
    const b = BORNES.find(x => x.moment === 'creux')!.debut;
    expect(energieA(b).marcheurs).toBeCloseTo((ENERGIES.dejeuner.marcheurs + ENERGIES.creux.marcheurs) / 2);
  });
});

describe('heures d’arrivée et de départ : fixes pour la journée, dans les plages', () => {
  const ids = ['kuroro', 'L', 'tom', 'ye', 'fig0', 'fig12', 'barista', 'couloir'];
  it('les mêmes à chaque rechargement (même id, même jour), différentes d’un jour à l’autre', () => {
    for (const id of ids) {
      expect(heureArrivee(id, JOUR)).toBe(heureArrivee(id, JOUR));
      expect(heureDepart(id, JOUR)).toBe(heureDepart(id, JOUR));
    }
    expect(ids.some(id => heureArrivee(id, JOUR) !== heureArrivee(id, JOUR + 1))).toBe(true);
  });
  it('arrivée entre 07:00 et 08:30, départ entre 17:30 et 19:45 ; bien étalées (un par un)', () => {
    const tous = [...ids, ...FIG_SEATS.map((_, i) => `fig${i}`), ...Object.keys(SEATS)];
    for (const id of tous) {
      expect(heureArrivee(id, JOUR)).toBeGreaterThanOrEqual(ARRIVEE_MIN);
      expect(heureArrivee(id, JOUR)).toBeLessThan(ARRIVEE_MAX);
      expect(heureDepart(id, JOUR)).toBeGreaterThanOrEqual(DEPART_MIN);
      expect(heureDepart(id, JOUR)).toBeLessThan(DEPART_MAX);
    }
    const arr = tous.map(id => heureArrivee(id, JOUR));
    expect(arr.filter(m => m < hm(7, 45)).length).toBeGreaterThan(5);
    expect(arr.filter(m => m >= hm(7, 45)).length).toBeGreaterThan(5);
  });
  it('l’entrée du bâtiment mène à chaque poste', () => {
    for (const [id, p] of [...Object.entries(SEATS), ...FIG_SEATS.map((p, i) => [`fig${i}`, p] as const)]) {
      expect(findPath(POI.entree, p).length, id).toBeGreaterThan(0);
      expect(findPath(p, POI.entree).length, id).toBeGreaterThan(0);
    }
  });
});

describe('relances du couloir et échanges entre collègues', () => {
  it('plus de « pause café dans 5 min ? » toutes les 18 s : rare l’après-midi, une pause café vers 16 h', () => {
    expect(relanceA(hm(14)).intervalle).toBeGreaterThanOrEqual(90);
    expect(relanceA(hm(10)).intervalle).toBeLessThan(relanceA(hm(14)).intervalle);
    expect(pauseCafe(hm(16))).toBe(true);
    expect(pauseCafe(hm(15, 30))).toBe(false);
    expect(relanceA(hm(16)).textes.join(' ')).toMatch(/café/);
    expect(relanceA(hm(22)).textes).toEqual([]);
  });
  it('la banque d’échanges suit le moment ; au moins 6 échanges par moment de jour, de 2 à 4 répliques ; rien la nuit', () => {
    expect(echangesA(hm(12, 40))).toBe(ECHANGES.dejeuner);
    expect(echangesA(hm(7, 20))).toBe(ECHANGES.arrivees);
    expect(echangesA(hm(14))).toBe(ECHANGES.creux);
    expect(echangesA(hm(22))).toEqual([]);
    expect(echangesA(hm(5))).toEqual([]);
    expect(ECHANGES.dejeuner.flat()).toContain('attiéké poisson ?');
    for (const [m, liste] of Object.entries(ECHANGES)) {
      expect(liste.length, m).toBeGreaterThanOrEqual(6);
      for (const l of liste) { expect(l.length).toBeGreaterThanOrEqual(2); expect(l.length).toBeLessThanOrEqual(4); }
    }
  });
  it('du bavardage d’ambiance : personne n’y affirme avoir fait ou trouvé un vrai travail', () => {
    const tout = Object.values(ECHANGES).flat(2).join('\n');
    expect(tout).not.toMatch(/j'ai (trouvé|relu|corrigé|fini|publié|envoyé|déployé|réparé|vérifié)/i);
    expect(tout).not.toMatch(/faille|commit|déploiement/i);
  });
});

// ── La simulation au fil de la journée (Moment calme)

const prive = (h: number, m = 0) => new Engine('calme', { muets: [...AGENTS_REELS, 'stalker'], prive: true, heure: a(h, m) });
const marche = (e: Engine, secondes: number, dt = 1 / 10) => { for (let i = 0; i < secondes / dt; i++) e.tick(dt); };
/** Avance l'heure minute par minute, en faisant tourner la simulation 60 s par minute. */
const avance = (e: Engine, depuis: number, jusqua: number, dt = 1 / 5) => {
  for (let t = depuis; t <= jusqua; t += MIN) { e.setHeure(t); marche(e, 60, dt); }
};

describe('Engine : la journée qui vit', () => {
  it('10:00 : tout le monde est arrivé et directement à son poste (pas de défilé)', () => {
    const e = prive(10);
    expect(e.agents.every(x => e.present(x.id))).toBe(true);
    // (sauf ceux qui sont déjà dans une activité de leur journée : aux toilettes, au potager… vie.ts)
    expect(e.agents.filter(x => !x.activite).every(x => e.atHome(x) && !x.path.length)).toBe(true);
    expect(e.agents.filter(x => x.activite).length).toBeLessThan(6);
  });
  it('avant son heure d’arrivée : absent (invisible), comme la nuit', () => {
    const e = prive(7, 30);
    const absents = e.agents.filter(x => heureArrivee(x.id, JOUR) > hm(7, 30));
    expect(absents.length).toBeGreaterThan(10);
    for (const x of absents) expect(e.present(x.id), x.id).toBe(false);
    for (const x of e.agents.filter(y => heureArrivee(y.id, JOUR) <= hm(7, 24))) expect(e.present(x.id), x.id).toBe(true);
    expect(e.snapshot().count).toBeLessThan(16);
  });
  it('à son heure : il apparaît à l’entrée, marche jusqu’à son poste ; un par un', () => {
    const e = prive(7);
    const x = e.agents.filter(y => !y.still && heureArrivee(y.id, JOUR) > hm(7, 10)).sort((p, q) => heureArrivee(p.id, JOUR) - heureArrivee(q.id, JOUR))[0];
    const k = Math.ceil(heureArrivee(x.id, JOUR)) - hm(7); // la minute (après 07:00) où il est arrivé
    avance(e, a(7, 1), a(7, k - 1), 1 / 5);
    expect(e.present(x.id)).toBe(false);
    // la minute de son arrivée : il entre par la porte (au plus quelques secondes d'attente derrière les autres)
    e.setHeure(a(7, k));
    let vuALaPorte = false;
    for (let i = 0; i < 30 * 10; i++) {
      e.tick(1 / 10);
      if (e.present(x.id) && Math.hypot(x.x - POI.entree[0], x.y - POI.entree[1]) < 1.5) vuALaPorte = true;
    }
    expect(vuALaPorte).toBe(true);
    let aSonPoste = false;
    for (let i = 0; i < 90 * 10; i++) { e.tick(1 / 10); if (e.atHome(x)) aSonPoste = true; }
    expect(e.present(x.id)).toBe(true);
    expect(aSonPoste).toBe(true);
  });
  it('un vrai agent en vraie tâche est à son poste à 07:05, même avant son arrivée simulée', () => {
    const e = prive(7, 5);
    const now = Date.now();
    e.appliquerReel({ clara: { statut: 'au travail', tache: 'trie les mails', quand: now - MIN } }, now);
    expect(heureArrivee('clara', JOUR)).toBeGreaterThan(hm(7, 5) - 6); // (elle n'est pas « déjà arrivée »)
    expect(e.present('clara')).toBe(true);
    marche(e, 30);
    const c = e.get('clara')!;
    expect(e.atHome(c)).toBe(true);
    expect(e.present('clara')).toBe(true);
  });
  it('le soir : il marche jusqu’à l’entrée puis disparaît ; à 19:50, presque personne', () => {
    const e = prive(17, 25);
    // (le départ du programme du jour : ceux qui restent pour le match du soir partent du terrain, plus tard, vie.ts)
    const dep = (id: string) => e.plan!.presence.get(id)!.depart;
    const x = e.agents.filter(y => !y.still && !y.scripted && !e.plan!.parAgent.get(y.id)?.some(c => c.debut > hm(17, 20))).sort((p, q) => dep(p.id) - dep(q.id))[0];
    const k = Math.ceil(dep(x.id)) - hm(17); // la minute (après 17:00) où il part
    avance(e, a(17, 26), a(17, k - 1), 1 / 5);
    expect(e.present(x.id)).toBe(true);
    e.setHeure(a(17, k));
    let versLaPorte = false;
    for (let i = 0; i < 90 * 10 && e.present(x.id); i++) {
      e.tick(1 / 10);
      if (x.sortie === 'part') versLaPorte = true;
    }
    expect(versLaPorte).toBe(true);
    expect(e.present(x.id)).toBe(false);
    const soir = prive(19, 50);
    expect(soir.agents.filter(y => soir.present(y.id)).length).toBeLessThanOrEqual(2);
    const nuit = prive(22);
    expect(nuit.agents.filter(y => nuit.present(y.id))).toEqual([]);
  });
  it('12:40 : la moitié déjeune à la Cuisine et en salle de pause, la moitié des bureaux sont vides', () => {
    const e = prive(12, 40);
    const table = e.agents.filter(x => ['cafe', 'pause'].includes(roomAt(x.x, x.y)?.id ?? '') && x.id !== 'barista');
    expect(table.length).toBeGreaterThan(12);
    const assis = e.agents.filter(x => !x.still).filter(x => e.atHome(x)).length;
    expect(assis).toBeLessThan(e.agents.filter(x => !x.still).length * 0.7);
    expect(Number(e.snapshot().rooms.cafe.split(' ')[0])).toBeGreaterThan(5);
    // à 14:00, tout le monde est rentré de déjeuner
    const apres = prive(14);
    expect(apres.agents.every(x => !x.dejeune)).toBe(true);
  });
  it('moins de marcheurs à 14:00 (coup de mou) qu’à 10:00', () => {
    const compte = (e: Engine) => { let n = 0; for (let i = 0; i < 3000; i++) { e.tick(1 / 10); if (i % 10 === 0) n += e.agents.filter(x => x.path.length).length; } return n; };
    const matin = compte(prive(10)), mou = compte(prive(14));
    expect(mou).toBeLessThan(matin * 0.6);
  });
  it('Pleine journée inchangée : tout le monde à son poste et immobile, à toute heure du jour', () => {
    for (const [h, m] of [[7, 5], [12, 40], [19, 50]]) {
      const e = new Engine('pleine', { heure: a(h, m) });
      expect(e.agents.every(x => e.present(x.id) && e.atHome(x))).toBe(true);
      marche(e, 20);
      expect(e.agents.every(x => e.atHome(x) && !x.path.length)).toBe(true);
    }
  });
});

/** 300 échanges lancés au hasard : qui y prend part. */
const echanges = (e: Engine) => {
  const vus: { a: string; b: string }[] = [];
  for (let i = 0; i < 300; i++) {
    e.echange = null;
    e.bubbles = [];
    if (e.lancerEchange()) vus.push({ a: e.echange!.a, b: e.echange!.b });
  }
  return vus;
};

describe('Engine : des échanges entre collègues proches', () => {
  const alea = (() => { let s = 7; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })();
  it('un échange alterne entre deux personnages présents et proches', () => {
    const e = new Engine('calme', { vif: true, heure: a(12, 40) });
    expect(e.lancerEchange(alea)).toBe(true);
    const ech = e.echange!;
    const A = e.get(ech.a)!, B = e.get(ech.b)!;
    expect(e.present(A.id) && e.present(B.id)).toBe(true);
    expect(Math.hypot(A.x - B.x, A.y - B.y)).toBeLessThanOrEqual(2.6);
    expect(roomAt(A.x, A.y)?.id).toBe(roomAt(B.x, B.y)?.id);
    expect(ECHANGES.dejeuner).toContain(ech.lignes);
    // les répliques, l'une après l'autre : A, B, A…
    const vues: [string, string][] = [];
    for (let i = 0; i < 20 * 10; i++) {
      e.tick(1 / 10);
      for (const b of e.bubbles) if ((b.agentId === A.id || b.agentId === B.id) && !vues.some(v => v[1] === b.text && v[0] === b.agentId)) vues.push([b.agentId, b.text]);
    }
    const repliques = vues.filter(([, t]) => ech.lignes.includes(t));
    expect(repliques.length).toBe(ech.lignes.length);
    repliques.forEach(([qui], i) => expect(qui).toBe(i % 2 ? B.id : A.id));
  });
  it('pas d’échange la nuit', () => {
    const e = new Engine('calme', { vif: true, heure: a(10) });
    e.setNuit(true);
    expect(e.lancerEchange()).toBe(false);
    expect(new Engine('calme', { vif: true, heure: a(22) }).lancerEchange()).toBe(false);
  });
  it('un vrai agent en vraie tâche ne bavarde pas (sa bulle reste sa vraie tâche)', () => {
    const e = new Engine('calme', { vif: true, heure: a(10) });
    const now = Date.now();
    e.appliquerReel(Object.fromEntries(AGENTS_REELS.map(id => [id, { statut: 'au travail', tache: 'vrai travail', quand: now - MIN }])), now);
    for (const ech of echanges(e)) for (const id of [ech.a, ech.b]) expect(AGENTS_REELS as readonly string[]).not.toContain(id);
  });
  it('page privée : les vrais agents (muets) ne prennent jamais part aux échanges', () => {
    const e = prive(12, 40);
    const vus = echanges(e);
    expect(vus.length).toBeGreaterThan(0);
    for (const ech of vus) for (const id of [ech.a, ech.b]) expect([...AGENTS_REELS, 'stalker']).not.toContain(id);
  });
});

describe('le déjeuner : de vraies places, une personne par place', () => {
  it('les places sont à la Cuisine (et sa salle à manger) et en salle de pause, espacées, et chacune joignable depuis chaque poste', () => {
    expect(PLACES_DEJEUNER.length).toBeGreaterThanOrEqual(20);
    for (const p of PLACES_DEJEUNER) expect(['cafe', 'pause'], String(p)).toContain(roomAt(...p)?.id);
    for (let i = 0; i < PLACES_DEJEUNER.length; i++) for (let j = i + 1; j < PLACES_DEJEUNER.length; j++) {
      const [a, b] = [PLACES_DEJEUNER[i], PLACES_DEJEUNER[j]];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `${a} / ${b}`).toBeGreaterThanOrEqual(0.8);
    }
    for (const p of PLACES_DEJEUNER) for (const s of [SEATS.paul, SEATS.clara, FIG_SEATS[20]]) expect(findPath(s, p).length, String(p)).toBeGreaterThan(0);
    // personne n'attend debout sur le comptoir ou la table : chaque place est à au moins 0,3 case d'un meuble bloquant
  });
  it('12:40 : au plus une personne par place ; quand tout est pris, les autres restent à leur poste', () => {
    const e = prive(12, 40);
    const aTable = e.agents.filter(x => x.dejeune);
    const places = aTable.map(x => `${x.x},${x.y}`);
    expect(new Set(places).size).toBe(places.length);
    for (const x of aTable) expect(PLACES_DEJEUNER.some(p => p[0] === x.x && p[1] === x.y), x.id).toBe(true);
    // personne d'autre (hors barista) n'est posé à la Cuisine ou en salle de pause
    const autres = e.agents.filter(x => !x.dejeune && !x.still && ['cafe', 'pause'].includes(roomAt(x.x, x.y)?.id ?? ''));
    expect(autres).toEqual([]);
    // après quelques minutes, toujours une personne par place
    marche(e, 120);
    const assis = e.agents.filter(x => x.dejeune && !x.path.length).map(x => `${x.x},${x.y}`);
    expect(new Set(assis).size).toBe(assis.length);
  });
});

describe('les étiquettes des pièces disent la vérité', () => {
  it('« … au studio » nomme seulement ceux qui y sont ; ON AIR seulement quand L tourne vraiment', () => {
    const e = new Engine('calme', { vif: true, heure: a(10) });
    let vuAuStudio = false;
    for (let i = 0; i < 30 * 120; i++) {
      e.tick(1 / 30);
      if (i % 15) continue;
      const s = e.snapshot();
      const studio = e.agents.filter(x => x.named && e.present(x.id) && roomAt(x.x, x.y)?.id === 'studio').map(x => agentById(x.id)!.nom);
      const m = /^(.*) au studio$/.exec(s.rooms.communication);
      if (m) { vuAuStudio = true; for (const nom of m[1].split(/, | et /)) expect(studio, s.rooms.communication).toContain(nom); }
      if (s.studioOn) { const L = e.get('L')!; expect(roomAt(L.x, L.y)?.id).toBe('studio'); expect(L.path.length).toBe(0); expect(s.rooms.studio).toBe('tournage en cours'); }
      if (!studio.length) expect(s.rooms.studio).toBe('libre');
    }
    expect(vuAuStudio).toBe(true);
  });
});

describe('les bulles ne se recouvrent pas', () => {
  it('une bulle inventée ne démarre jamais trop près d’une bulle déjà affichée (café bondé à 12:40)', () => {
    const e = new Engine('calme', { vif: true, heure: a(12, 40) });
    let avant = new Set<number>();
    let nouvelles = 0;
    for (let i = 0; i < 30 * 180; i++) {
      e.tick(1 / 30);
      const ids = new Set(e.bubbles.map(b => b.id));
      for (const b of e.bubbles) {
        if (avant.has(b.id)) continue;
        nouvelles++;
        const x = e.get(b.agentId)!;
        // l'autre bulle de l'échange vient de s'effacer : aucune autre bulle tout près
        for (const o of e.bubbles) if (o.id !== b.id && avant.has(o.id)) expect(bullesProches(x, e.get(o.agentId)!), `${b.text} / ${o.text}`).toBe(false);
      }
      avant = ids;
    }
    expect(nouvelles).toBeGreaterThan(20);
  });
});
