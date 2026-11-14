import { describe, expect, it } from 'vitest';
import { memoire } from '../memoire';
import { vuePaul, phrasePaul } from './vue';
import { ACTIVATION_PAUL, creneauManque, lignePassage, phraseCerveau, type VuePaul } from './etiquette';
import { CLES_PAUL, noterPassage } from './stockage';
import type { Proposition } from './types';

const H = 3_600_000, JOUR = 24 * H;
const JEUDI = Date.UTC(2026, 10, 19, 18, 0); // jeudi 19 novembre 2026, 18:00 UTC
const p = (o: Partial<Proposition>): Proposition => ({
  id: 'a', lot: 'L', depot: 'mon-compte/qg', branche: 'main', fichier: 'README.md', base: 'b', contenu: 'secretement long', raisons: [],
  diff: [], ajoutees: 1, retirees: 0, quand: JEUDI, statut: 'attente', ...o,
});

describe('le passage du jeudi', () => {
  it('raté seulement 2 h après 18:00, sans passage complet depuis ; jamais avant la mise en service', () => {
    expect(creneauManque(null, JEUDI + H)).toBe(Date.UTC(2026, 10, 12, 18, 0)); // le jeudi d'avant n'a rien eu non plus
    expect(creneauManque({ quand: JEUDI - 7 * JOUR + H }, JEUDI + H)).toBeNull();
    expect(creneauManque({ quand: JEUDI - 7 * JOUR + H }, JEUDI + 2 * H)).toBe(JEUDI);
    expect(creneauManque({ quand: JEUDI + 5 * 60_000 }, JEUDI + 2 * H)).toBeNull();
    expect(creneauManque({ quand: JEUDI + 5 * 60_000 }, JEUDI + 6 * JOUR)).toBeNull();
    expect(creneauManque(null, ACTIVATION_PAUL - JOUR)).toBeNull();
  });
  it('la ligne du dernier passage', () => {
    expect(lignePassage({ quand: Date.UTC(2026, 10, 12, 18, 2), relus: 4, propositions: 3, refusees: 1, illisibles: [] }))
      .toBe('dernier passage jeu. 12 nov. 18:02 · 4 projets relus · 3 propositions · 1 refusée par le QG');
  });
});

describe('vuePaul', () => {
  it('attente sans le fichier complet ; plus de 8 jours : montrée expirée ; réponses récentes', async () => {
    const kv = memoire();
    await kv.hset(CLES_PAUL.propositions, 'a', JSON.stringify(p({ id: 'a' })));
    await kv.hset(CLES_PAUL.propositions, 'b', JSON.stringify(p({ id: 'b', quand: JEUDI - 9 * JOUR })));
    await kv.hset(CLES_PAUL.propositions, 'c', JSON.stringify(p({ id: 'c', statut: 'appliquee', decide: JEUDI - JOUR, commit: { sha: 's', url: 'https://github.com/x' } })));
    await noterPassage(kv, { quand: JEUDI + 60_000, relus: 1, propositions: 1, refusees: 0, illisibles: [] });
    const v = await vuePaul(kv, JEUDI + H);
    expect(v.attente.map(x => x.id)).toEqual(['a']);
    expect(JSON.stringify(v)).not.toContain('secretement long');
    expect(v.recentes.map(x => [x.id, x.statut])).toEqual([['c', 'appliquee'], ['b', 'expiree']]);
    expect(v.rate).toBeNull();
    expect(phrasePaul(v)).toBe('1 proposition attend ton Valider.');
  });
});

describe('ce que la page montre d\'un bloc CLAUDE.md', () => {
  it('le bloc lui-même (court, sans secret) ; le README complet jamais', async () => {
    const kv = memoire();
    await kv.hset(CLES_PAUL.propositions, 'c', JSON.stringify(p({ id: 'c', fichier: 'CLAUDE.md', contenu: undefined, bloc: '- Fait : tout.' })));
    const v = await vuePaul(kv, JEUDI + H);
    expect(v.attente[0]).toMatchObject({ id: 'c', bloc: '- Fait : tout.' });
  });
});

describe('la phrase du Cerveau : jamais « à jour » sans raison', () => {
  const vide: VuePaul = { passage: null, rate: null, attente: [], refusQG: [], recentes: [] };
  it('pas encore de passage, raté, rien à proposer, rien à valider', () => {
    expect(phraseCerveau(null)).toBe('Pas encore de passage.');
    expect(phraseCerveau(vide)).toBe('Pas encore de passage.');
    expect(phraseCerveau({ ...vide, rate: JEUDI })).toBe('Le passage du jeu. 19 nov. n\'a pas eu lieu.');
    const passage = { quand: JEUDI, relus: 2, propositions: 0, refusees: 0, illisibles: [] };
    expect(phraseCerveau({ ...vide, passage })).toBe('Rien à proposer au dernier passage.');
    expect(phraseCerveau({ ...vide, passage: { ...passage, propositions: 2 } })).toBe('Rien à valider pour l\'instant.');
    // un passage incomplet le dit, et ne dit jamais « rien à proposer »
    expect(phraseCerveau({ ...vide, passage: { ...passage, illisibles: ['boutique-shop', 'qg'] } })).toBe('Dernier passage incomplet : 2 projets pas relus (boutique-shop, qg).');
    expect(phraseCerveau({ ...vide, attente: [{} as never], passage: { ...passage, illisibles: ['qg'] } })).toBe('1 proposition attend ton Valider. Dernier passage incomplet : 1 projet pas relu (qg).');
  });
});
