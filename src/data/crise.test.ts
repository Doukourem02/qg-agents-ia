import { describe, expect, it } from 'vitest';
import {
  bilan, bullesReunion, enCours, estLigneJournal, ligneJournal, niveauDe, participantsDe, phaseA, pointsDe, prochainPoint, resume, titreSalle,
  type Reunion, type ReunionScene, type Sujet,
} from './crise';

// Jeudi 12 novembre 2026, heure d'Abidjan (= UTC).
const MIN = 60_000;
const a = (h: number, m: number) => Date.UTC(2026, 10, 12, h, m);

const site = (o: Partial<Sujet> = {}): Sujet => ({
  cle: 'site:api-livreo', genre: 'site', agent: 'luffy', projet: 'Livreo', nom: 'API Livreo', detail: '503', depuis: a(14, 2) - 7 * MIN, grave: true, ...o,
});
const routine = (i: number): Sujet => ({
  cle: `routine:r${i}@0`, genre: 'routine', agent: 'light', projet: 'Light', nom: 'Light · Relevé', detail: 'aucune trace dans le journal', depuis: a(8, 0), grave: false,
});
const grave = (genre: 'lea' | 'zoro'): Sujet => ({
  cle: `${genre}:x`, genre, agent: genre, projet: 'app_livraison', nom: 'app_livraison', detail: genre === 'lea' ? 'clé GitHub poussée par erreur' : 'faille critique dans next 15.0.0', depuis: a(13, 40), grave: true,
});

describe('les seuils : incident, crise, rien', () => {
  it('aucune alerte : aucune réunion', () => {
    expect(niveauDe([])).toBeNull();
  });
  it('un site en panne depuis moins de 10 min, ou des passages ratés (moins de 5) : pas de réunion', () => {
    expect(niveauDe([site({ grave: false })])).toBeNull();
    expect(niveauDe([routine(1), routine(2), routine(3), routine(4)])).toBeNull();
  });
  it('incident : un site en panne depuis 10 min ou plus, un point grave de Léa, une faille critique de Zoro', () => {
    expect(niveauDe([site()])).toBe('incident');
    expect(niveauDe([grave('lea')])).toBe('incident');
    expect(niveauDe([grave('zoro')])).toBe('incident');
  });
  it('crise : 2 sites en panne en même temps (même récents), ou 5 alertes ouvertes ou plus', () => {
    expect(niveauDe([site({ grave: false }), site({ cle: 'site:portfolio', projet: 'Portfolio', nom: 'Portfolio', grave: false })])).toBe('crise');
    expect(niveauDe([1, 2, 3, 4, 5].map(routine))).toBe('crise');
    expect(niveauDe([site(), routine(1), routine(2), routine(3), routine(4)])).toBe('crise');
  });
});

describe('qui vient en salle', () => {
  it('incident : Kuroro, le chef du pôle concerné et l’agent qui a donné l’alerte', () => {
    expect(participantsDe('incident', ['luffy'], false, 'clara')).toEqual(['kuroro', 'stalker', 'luffy']);
  });
  it('crise : Kuroro, Stalker, Obito, les chefs de pôle et les agents concernés', () => {
    expect(participantsDe('crise', ['luffy', 'lea'], false, 'clara')).toEqual(['kuroro', 'stalker', 'obito', 'isaac', 'luffy', 'lea']);
  });
  it('la nuit : seulement Kuroro et l’agent d’astreinte', () => {
    expect(participantsDe('crise', ['luffy', 'lea'], true, 'clara')).toEqual(['kuroro', 'clara']);
    expect(participantsDe('incident', ['luffy'], true, null)).toEqual(['kuroro']);
  });
});

describe('les heures : début, points à xx:00 et xx:30, débrief', () => {
  const r = { debut: a(14, 5) };
  it('le prochain point est le premier xx:00 ou xx:30 après le début', () => {
    expect(prochainPoint(a(14, 5))).toBe(a(14, 30));
    expect(prochainPoint(a(14, 30))).toBe(a(15, 0));
    expect(prochainPoint(a(23, 45))).toBe(Date.UTC(2026, 10, 13, 0, 0));
  });
  it('en salle au début (10 min), à chaque point (5 min) ; à son poste entre deux', () => {
    expect(phaseA(r, a(14, 5))).toBe('debut');
    expect(phaseA(r, a(14, 14))).toBe('debut');
    expect(phaseA(r, a(14, 15))).toBeNull();
    expect(phaseA(r, a(14, 29))).toBeNull();
    expect(phaseA(r, a(14, 30))).toBe('point');
    expect(phaseA(r, a(14, 34))).toBe('point');
    expect(phaseA(r, a(14, 35))).toBeNull();
    expect(phaseA(r, a(15, 0))).toBe('point');
    expect(phaseA(r, a(15, 30) + 4 * MIN)).toBe('point');
  });
  it('une réunion ouverte à la demie pile n’a pas de « point » à son début : le premier est à l’heure suivante', () => {
    expect(pointsDe({ debut: a(14, 30) }, a(15, 30))).toEqual([a(15, 0), a(15, 30)]);
  });
  it('après la fin : le débrief (5 min), puis plus rien en salle', () => {
    const finie = { debut: a(14, 5), fin: a(14, 40) };
    expect(phaseA(finie, a(14, 40))).toBe('debrief');
    expect(phaseA(finie, a(14, 44))).toBe('debrief');
    expect(phaseA(finie, a(14, 45))).toBeNull();
    expect(enCours(finie, a(14, 44))).toBe(true);
    expect(enCours(finie, a(14, 45))).toBe(false);
    expect(pointsDe(finie, a(16, 0))).toEqual([a(14, 30)]);
  });
});

const reunion = (o: Partial<Reunion> = {}): Reunion => ({
  id: String(a(14, 5)), niveau: 'incident', debut: a(14, 5), sujets: [site()], vus: [site()], agents: ['luffy'], vu: a(14, 5), ...o,
});

describe('les mots, tirés du vrai problème', () => {
  it('la salle : « Incident · Livreo en panne depuis 14 min », « Réunion de crise · … » en crise', () => {
    expect(titreSalle(reunion(), a(14, 9))).toBe('Incident · Livreo en panne depuis 14 min');
    expect(titreSalle(reunion({ niveau: 'crise' }), a(14, 9))).toBe('Réunion de crise · Livreo en panne depuis 14 min');
  });
  it('plusieurs alertes : chaque genre, une fois', () => {
    expect(resume([site(), site({ cle: 'site:admin-livreo', nom: 'Admin Livreo' }), site({ cle: 'site:portfolio', projet: 'Portfolio', nom: 'Portfolio', depuis: a(14, 0) }), grave('lea')], a(14, 5)))
      .toBe('Livreo et Portfolio en panne depuis 10 min ; point grave de Léa dans app_livraison depuis 25 min');
    expect(resume([grave('zoro')], a(15, 40), true)).toBe('faille critique toujours ouverte dans app_livraison depuis 2 h');
    expect(resume([site()], null)).toBe('Livreo en panne');
  });
  it('la fin et le journal : seulement ce qui s’est vraiment réglé', () => {
    const fin = a(14, 40);
    const r = reunion({ fin, sujets: [], vus: [site({ depuis: a(14, 2), regle: fin })] }) as Reunion & { fin: number };
    expect(bilan(r, true)).toBe('Livreo revenu après 38 min');
    expect(ligneJournal(r)).toBe('incident 14:05–14:40 · Livreo revenu');
    expect(ligneJournal({ ...r, niveau: 'crise' })).toBe('réunion de crise 14:05–14:40 · Livreo revenu');
    expect(estLigneJournal('incident 14:05–14:40 · Livreo revenu')).toBe(true);
    expect(estLigneJournal('réunion de crise 14:05–14:40 · Livreo revenu')).toBe(true);
    expect(estLigneJournal('incident réglé par Luffy')).toBe(false);
    expect(titreSalle(r, a(14, 41))).toBe('Incident · débrief · Livreo revenu');
  });
  it('les bulles : le vrai code et l’heure, puis la vraie prochaine vérification', () => {
    const s: ReunionScene = { ...reunion({ sujets: [site({ depuis: a(14, 2) })] }), relances: { 'site:api-livreo': a(14, 10) } };
    expect(bullesReunion(s, a(14, 5), ['kuroro', 'stalker', 'luffy'])).toEqual([
      { agentId: 'luffy', texte: 'API Livreo : 503 depuis 14:02' },
      { agentId: 'kuroro', texte: 'Luffy revérifie dans 5 min' },
    ]);
  });
  it('les bulles : sans vérification prévue (Luffy endormi), rien n’est promis ; la nuit, Kuroro parle', () => {
    const s: ReunionScene = { ...reunion({ sujets: [site({ depuis: a(14, 2) })] }), relances: {} };
    expect(bullesReunion(s, a(14, 5), ['kuroro', 'clara'])).toEqual([{ agentId: 'kuroro', texte: 'API Livreo : 503 depuis 14:02' }]);
  });
  it('rien en salle sans participant', () => {
    expect(bullesReunion({ ...reunion(), relances: {} }, a(14, 5), [])).toEqual([]);
  });
});
