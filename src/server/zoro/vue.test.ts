import { describe, expect, it } from 'vitest';
import { memoire } from '../memoire';
import { CLES_ZORO } from './mac';
import { etiquetteTour, phraseZoro, prochainMardi, vueZoro } from './vue';
import { estMotNonLu, NON_LU, resumeNonLu } from './etiquette';
import type { Faille, Projet, Tour } from './types';

const u = (j: number, h = 0, m = 0) => Date.UTC(2026, 10, j, h, m);

const faille = (o: Partial<Faille> = {}): Faille => ({ id: 'G', paquet: 'next', version: '1', gravite: 'haute', corrigeeEn: null, directeProd: true, resume: 'r', ...o });
const projet = (o: Partial<Projet> = {}): Projet => ({ depot: 'a', pousse: 0, failles: [], ci: { etat: 'vert', passages: 1, echecs: 0 }, ...o });
const tour = (o: Partial<Tour> = {}): Tour => ({
  quand: u(10, 9), type: 'tour', projets: [], nonLus: [], cles: [],
  mac: { quand: u(10, 8), dossiers: [] }, macVieux: false, importants: [], ...o,
});

describe('prochainMardi', () => {
  it('mercredi 11 nov. 10:00 → mardi 17 nov. 09:00', () => expect(prochainMardi(u(11, 10))).toBe(u(17, 9)));
  it('mardi 17 à 08:59 → le même jour 09:00', () => expect(prochainMardi(u(17, 8, 59))).toBe(u(17, 9)));
  it('mardi 17 à 09:00 pile → le mardi 24', () => expect(prochainMardi(u(17, 9))).toBe(u(24, 9)));
  it('lundi → le lendemain ; dimanche → mardi', () => {
    expect(prochainMardi(u(16, 23))).toBe(u(17, 9));
    expect(prochainMardi(u(15, 12))).toBe(u(17, 9));
  });
});

describe('vueZoro', () => {
  it('rien encore : pas de tour, prochain mardi, historique vide', async () => {
    expect(await vueZoro(memoire(), u(11, 10))).toEqual({ dernier: null, prochain: u(17, 9), historique: [] });
  });
  it('le dernier tour et l\'historique, tels que stockés', async () => {
    const kv = memoire();
    const t = tour();
    await kv.hset(CLES_ZORO.tour, 'json', JSON.stringify(t));
    await kv.lpush(CLES_ZORO.historique, JSON.stringify({ quand: u(10, 9), importants: 2 }));
    expect(await vueZoro(kv, u(11, 10))).toEqual({ dernier: t, prochain: u(17, 9), historique: [{ quand: u(10, 9), importants: 2 }] });
  });
});

describe('phraseZoro', () => {
  it('pas de tour', () => expect(phraseZoro(null)).toBe('Pas encore de tour.'));
  it('failles critiques ou hautes (directes de production) et projets rouges', () => {
    const t = tour({ projets: [
      projet({ failles: [faille(), faille({ gravite: 'critique' }), faille({ gravite: 'moyenne' }), faille({ directeProd: false })] }),
      projet({ ci: { etat: 'rouge', depuis: 1, passages: 1, echecs: 2 } }),
    ] });
    expect(phraseZoro(t)).toBe('2 failles critiques ou hautes, 1 projet en rouge.');
  });
  it('rien d\'important quand tout est lu', () => expect(phraseZoro(tour({ projets: [projet()] }))).toBe('Rien d\'important au dernier tour.'));
  it('jamais « Rien d\'important » quand une partie n\'a pas été lue', () => {
    for (const t of [tour({ nonLus: ['GitHub'] }), tour({ projets: [projet({ failles: null })] }), tour({ macVieux: true, mac: null })]) {
      expect(phraseZoro(t)).not.toContain('Rien d\'important');
      expect(phraseZoro(t)).toContain('Une partie n\'a pas été lue.');
    }
  });
  it('tests illisibles ou dossier du Mac non lu : jamais « Rien d\'important »', () => {
    const ciIllisible = tour({ projets: [projet({ ci: { etat: 'illisible', raison: 'droit Actions manquant' } })] });
    const macIllisible = tour({ mac: { quand: u(10, 8), dossiers: [{ nom: 'qg', git: true, compte: 'o', distant: true, nonEnregistres: 0, plusAncienNonEnregistre: null, nonPousses: 0, plusAncienNonPousse: null, stashes: 0, dernierCommit: 1, modifie: 1, illisible: true }] } });
    for (const t of [ciIllisible, macIllisible]) expect(phraseZoro(t)).toBe('Rien trouvé dans ce qui a été lu. Une partie n\'a pas été lue.');
  });
  it('des alertes ET une partie non lue : les deux', () => {
    expect(phraseZoro(tour({ nonLus: ['x'], projets: [projet({ failles: [faille()] })] }))).toBe('1 faille critique ou haute. Une partie n\'a pas été lue.');
  });
});

describe('etiquetteTour', () => {
  const imp = { cle: 'k', partie: 'ci' as const, projet: 'a', texte: 't' };
  it('des points importants : le nombre, en rouge', () => {
    expect(etiquetteTour(tour({ importants: [imp] }))).toEqual({ texte: '1 point important', ton: 'rouge' });
    expect(etiquetteTour(tour({ importants: [imp, imp] }))).toEqual({ texte: '2 points importants', ton: 'rouge' });
  });
  it('rien d\'important mais une partie non lue : orange, jamais vert', () => {
    for (const t of [tour({ nonLus: ['GitHub'] }), tour({ projets: [projet({ failles: null })] }), tour({ macVieux: true, mac: null })]) {
      expect(etiquetteTour(t)).toEqual({ texte: 'rien trouvé, une partie n\'a pas été lue', ton: 'orange' });
    }
  });
  it('tests illisibles ou dossier du Mac non lu : orange, jamais vert', () => {
    const ciIllisible = tour({ projets: [projet({ ci: { etat: 'illisible', raison: 'aucun passage terminé' } })] });
    const macIllisible = tour({ mac: { quand: u(10, 8), dossiers: [{ nom: 'notes', git: false, compte: null, distant: false, nonEnregistres: 0, plusAncienNonEnregistre: null, nonPousses: 0, plusAncienNonPousse: null, stashes: 0, dernierCommit: null, modifie: 1, illisible: true }] } });
    for (const t of [ciIllisible, macIllisible]) expect(etiquetteTour(t)).toEqual({ texte: 'rien trouvé, une partie n\'a pas été lue', ton: 'orange' });
  });
  it('tout lu et rien : vert', () => expect(etiquetteTour(tour({ projets: [projet()] }))).toEqual({ texte: 'rien d\'important', ton: 'vert' }));
});

describe('estMotNonLu', () => {
  it('les mots d\'une partie entière, comparés exactement ; un dépôt dont le nom commence par « GitHub » reste un dépôt', () => {
    for (const m of Object.values(NON_LU)) expect(estMotNonLu(m)).toBe(true);
    for (const m of ['GitHub-actions-demo', 'GitHubPages', 'clé GitHub 2', 'app_livraison']) expect(estMotNonLu(m)).toBe(false);
  });
});

describe('resumeNonLu', () => {
  const d = { nom: 'x', git: true, compte: null, distant: true, nonEnregistres: 0, plusAncienNonEnregistre: null, nonPousses: 0, plusAncienNonPousse: null, stashes: 0, dernierCommit: 1, modifie: 1 };
  it('tout lu → null', () => expect(resumeNonLu(tour({ projets: [projet()] }))).toBeNull());
  it('une liste courte, des nombres seulement', () => {
    const t = tour({
      nonLus: [NON_LU.github, 'secret-depot', NON_LU.cleGithub],
      projets: [projet({ failles: null }), projet({ ci: { etat: 'illisible', raison: 'droit Actions manquant' } }), projet({ failles: null, ci: { etat: 'illisible', raison: 'x' } })],
      mac: { quand: u(10, 8), dossiers: [{ ...d, illisible: true }, { ...d, nom: 'y', illisible: true }] },
    });
    expect(resumeNonLu(t)).toBe('Pas lu cette fois : GitHub, 1 projet, date de la clé GitHub, failles de 2 projets, tests de 2 projets, 2 dossiers du Mac');
    expect(resumeNonLu(tour({ macVieux: true, mac: null }))).toBe('Pas lu cette fois : Mac');
  });
  it('toujours d\'accord avec partieNonLue', () => {
    for (const t of [tour(), tour({ nonLus: ['a'] }), tour({ macVieux: true }), tour({ projets: [projet({ failles: null })] })]) {
      expect(resumeNonLu(t) !== null).toBe(etiquetteTour(t).ton !== 'vert');
    }
  });
});
