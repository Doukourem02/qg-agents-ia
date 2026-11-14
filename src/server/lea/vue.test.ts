import { describe, expect, it } from 'vitest';
import { memoire } from '../memoire';
import { CLES_LEA } from './relecture';
import { vueLea, phraseLea } from './vue';
import { bilanPartiel, lignesPartiel, messageRienACorriger, absente, groupesConstats, ID_CONSTAT, endroit, lignesRelecture, noteTentative, phraseTentative } from './etiquette';
import type { Constat, Tentative } from './types';

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 11, 12, 0);
const constat = (o: Partial<Constat> = {}): Constat => ({
  id: 'ia|L1|00', depot: 'a', sha: 'abcdef123456', message: 'm', fichier: 'f.ts', ligne: 3, gravite: 'grave', quoi: 'q', conseil: 'c',
  source: 'lea', quand: NOW, statut: 'ouvert', ...o,
});

describe('absente', () => {
  it('jamais passée ou 3 h sans passage complet', () => {
    expect(absente(null, NOW)).toBe(true);
    expect(absente(NOW - 3 * H + 1, NOW)).toBe(false);
    expect(absente(NOW - 3 * H, NOW)).toBe(true);
  });
});

describe('vueLea', () => {
  it('rien en mémoire : pas de passage, absente', async () => {
    expect(await vueLea(memoire(), NOW)).toEqual({ passage: null, absente: true, constats: [], relectures: [], tentative: null });
  });
  it('lit le dernier passage, les constats et les relectures', async () => {
    const kv = memoire();
    await kv.hset(CLES_LEA.passage, 'quand', String(NOW - H));
    await kv.hset(CLES_LEA.constats, 'ia|L1|00', JSON.stringify(constat()));
    await kv.lpush(CLES_LEA.relectures, JSON.stringify({ depot: 'a', quand: NOW - H, commits: [], enPartie: [], clesNonVerifiees: [], rienACoder: 0 }));
    const v = await vueLea(kv, NOW);
    expect(v).toMatchObject({ passage: NOW - H, absente: false });
    expect(v.constats).toHaveLength(1);
    expect(v.relectures).toHaveLength(1);
  });
  it('passage vieux de 3 h : absente', async () => {
    const kv = memoire();
    await kv.hset(CLES_LEA.passage, 'quand', String(NOW - 3 * H));
    expect((await vueLea(kv, NOW)).absente).toBe(true);
  });
});

describe('phraseLea', () => {
  const rel = { depot: 'a', quand: NOW - H, commits: [], enPartie: [], clesNonVerifiees: [], rienACoder: 0 };
  const vue = (o: object) => ({ passage: NOW - H, absente: false, constats: [], relectures: [rel], tentative: null, ...o });
  it('pas encore de relecture', () => expect(phraseLea(null, NOW)).toBe('Pas encore de relecture.'));
  it('points graves ouverts seulement', () => {
    expect(phraseLea(vue({ constats: [constat(), constat({ id: 'ia|L1|01' }), constat({ id: 'ia|L1|02', statut: 'vu' }), constat({ id: 'x', gravite: 'mineur' })] }), NOW)).toBe('2 points graves à corriger.');
    expect(phraseLea(vue({ constats: [constat()] }), NOW)).toBe('1 point grave à corriger.');
  });
  it('rien à signaler', () => {
    expect(phraseLea(vue({}), NOW)).toBe('Rien à signaler sur les pushes relus.');
    expect(phraseLea(vue({ constats: [constat({ statut: 'vu' })] }), NOW)).toBe('Rien à signaler sur les pushes relus.');
  });
  it('absente : le dit, sans cacher les graves', () => {
    expect(phraseLea(vue({ passage: NOW - 5 * H, absente: true }), NOW)).toBe('N\'est pas passée depuis 5 h.');
    expect(phraseLea(vue({ passage: NOW - 5 * H, absente: true, constats: [constat()] }), NOW)).toBe('N\'est pas passée depuis 5 h. 1 point grave à corriger.');
  });
});

describe('groupesConstats et helpers', () => {
  it('à corriger : graves puis moyens, ouverts seulement ; mineurs à part', () => {
    const g = groupesConstats([
      constat({ id: 'a', gravite: 'moyen', quand: NOW }), constat({ id: 'b', gravite: 'grave', quand: NOW - 1 }),
      constat({ id: 'c', gravite: 'mineur' }), constat({ id: 'd', statut: 'vu' }),
    ]);
    expect(g.aCorriger.map(c => c.id)).toEqual(['b', 'a']);
    expect(g.remarques.map(c => c.id)).toEqual(['c']);
  });
  it('ID_CONSTAT et endroit', () => {
    expect(ID_CONSTAT.test('cle|a|sha|f|3|clé GitHub')).toBe(true);
    expect(ID_CONSTAT.test('ia|L1|00')).toBe(true);
    expect(ID_CONSTAT.test('autre')).toBe(false);
    expect(endroit({ fichier: 'f.ts', ligne: 3 })).toBe('f.ts:3');
    expect(endroit({ fichier: 'f.ts', ligne: null })).toBe('f.ts');
  });
});

describe('lignesRelecture', () => {
  const r = { depot: 'a', quand: NOW, commits: [{ sha: 's1', message: 'm' }], enPartie: [], clesNonVerifiees: [], rienACoder: 0 };
  it('une relecture entière', () => expect(lignesRelecture(r)).toEqual(['1 enregistrement relu']));
  it('dit tout ce qui n\'a pas été lu', () => {
    expect(lignesRelecture({ ...r, commits: [r.commits[0], r.commits[0]], enPartie: ['big.ts : trop gros'], clesNonVerifiees: ['logo.png'], rienACoder: 1, reecrit: true })).toEqual([
      '2 enregistrements relus', 'historique réécrit : relu sur les dernières 24 h seulement', 'relu en partie : big.ts : trop gros',
      'clés non vérifiées : logo.png', 'rien de code à relire',
    ]);
  });
});

describe('jamais « rien à signaler » à tort', () => {
  const rel = (o: object = {}) => ({ depot: 'a', quand: NOW - H, commits: [], enPartie: [], clesNonVerifiees: [], rienACoder: 0, ...o });
  const vue = (o: object) => ({ passage: NOW - H, absente: false, constats: [], relectures: [rel()], tentative: null, ...o });
  it('points moyens ouverts', () => {
    expect(phraseLea(vue({ constats: [constat({ gravite: 'moyen' }), constat({ id: 'x', gravite: 'moyen' })] }), NOW)).toBe('2 points moyens à regarder.');
    expect(phraseLea(vue({ constats: [constat(), constat({ id: 'x', gravite: 'moyen' })] }), NOW)).toBe('1 point grave à corriger. 1 point moyen à regarder.');
    expect(phraseLea(vue({ constats: [constat({ gravite: 'moyen', statut: 'vu' })] }), NOW)).toBe('Rien à signaler sur les pushes relus.');
  });
  it('relecture partielle, clés non vérifiées, historique réécrit', () => {
    for (const o of [{ enPartie: ['big.ts'] }, { clesNonVerifiees: ['a.png'] }, { reecrit: true }]) {
      const p = phraseLea(vue({ relectures: [rel(o)] }), NOW);
      expect(p).toBe('Une partie n\'a été relue qu\'en partie.');
    }
    expect(phraseLea(vue({ relectures: [rel({ enPartie: ['x'] })], constats: [constat()] }), NOW)).toBe('1 point grave à corriger. Une partie n\'a été relue qu\'en partie.');
  });
  it('relectures de plus de 24 h avant le passage : ignorées ; tout propre : rien à signaler', () => {
    expect(phraseLea(vue({ relectures: [rel({ quand: NOW - 30 * H, enPartie: ['x'] })] }), NOW)).toBe('Rien à signaler sur les pushes relus.');
  });
  it('bilan et lignes visibles de l\'en-tête', () => {
    const b = bilanPartiel([rel({ enPartie: ['a', 'b'], clesNonVerifiees: ['c'], reecrit: true })], NOW - H);
    expect(lignesPartiel(b)).toEqual(['Relu en partie : 2 fichiers', 'Clés non vérifiées : 1 fichier', 'Historique réécrit']);
    expect(lignesPartiel(bilanPartiel([rel()], NOW - H))).toEqual([]);
    expect(lignesPartiel(bilanPartiel([rel({ enPartie: ['a'] })], null))).toEqual([]);
  });
  it('rien à corriger, honnête quand absente', () => {
    expect(messageRienACorriger(null)).toBe('Rien à corriger pour l’instant.');
    expect(messageRienACorriger('5 h')).toBe('Rien à corriger dans les relectures reçues (Léa n\'est pas passée depuis 5 h).');
  });
});

describe('I3 · rien relu : jamais « rien à signaler »', () => {
  it('passage posé (premier passage) mais aucune relecture ni constat ouvert : « Pas encore de relecture. »', () => {
    expect(phraseLea({ passage: NOW - H, absente: false, constats: [], relectures: [], tentative: null }, NOW)).toBe('Pas encore de relecture.');
    expect(phraseLea({ passage: null, absente: true, constats: [], relectures: [], tentative: null }, NOW)).toBe('Pas encore de relecture.');
  });
});

describe('I2 · le dernier essai raté est dit', () => {
  const t = (o: Partial<Tentative> = {}): Tentative => ({ quand: NOW - H, issue: 'projets illisibles', nonLus: 2, depots: ['app_livraison', 'qg'], ...o });
  const rel = { depot: 'a', quand: NOW - 5 * H, commits: [], enPartie: [], clesNonVerifiees: [], rienACoder: 0 };
  it('les phrases', () => {
    expect(phraseTentative(t())).toBe('N\'a pas pu lire 2 projets : app_livraison, qg.');
    expect(phraseTentative(t({ issue: 'lot remis sans rapport', nonLus: 1, depots: ['qg'] }))).toBe('Lot remis sans rapport.');
    expect(phraseTentative(t({ issue: 'relu en partie', nonLus: 1, depots: ['qg'] }))).toBe('Relu en partie : qg ; la suite au prochain passage.');
    expect(phraseTentative(t({ issue: 'rapport refusé' }))).toMatch(/refusé/);
    expect(phraseTentative(t({ issue: 'complet', nonLus: 0, depots: [] }))).toBeNull();
    expect(phraseTentative(null)).toBeNull();
    expect(phraseTentative(t({ nonLus: 5, depots: ['a', 'b', 'c', 'd', 'e'] }))).toBe('N\'a pas pu lire 5 projets : a, b, c et 2 autres.');
  });
  it('Cerveau : essai raté récent à la place de « n’est pas passée depuis … »', () => {
    const v = { passage: NOW - 5 * H, absente: true, constats: [], relectures: [rel], tentative: t() };
    expect(phraseLea(v, NOW)).toBe('N\'a pas pu lire 2 projets : app_livraison, qg.');
    expect(phraseLea({ ...v, tentative: t({ issue: 'lot remis sans rapport', nonLus: 1, depots: ['qg'] }) }, NOW)).toBe('Lot remis sans rapport.');
    // essai raté ancien : les deux sont dits
    expect(phraseLea({ ...v, tentative: t({ quand: NOW - 4 * H }) }, NOW)).toBe('N\'est pas passée depuis 5 h. N\'a pas pu lire 2 projets : app_livraison, qg.');
    // essai complet : rien de plus
    expect(phraseLea({ ...v, absente: false, passage: NOW - H, tentative: t({ issue: 'complet', nonLus: 0, depots: [] }) }, NOW)).toBe('Rien à signaler sur les pushes relus.');
  });
  it('premier passage raté : l’essai, pas « pas encore de relecture »', () => {
    expect(phraseLea({ passage: null, absente: true, constats: [], relectures: [], tentative: t() }, NOW)).toBe('N\'a pas pu lire 2 projets : app_livraison, qg.');
  });
  it('note d’agent : seulement pour un essai raté de moins de 3 h', () => {
    expect(noteTentative(t(), NOW)).toBe('n\'a pas pu lire 2 projets : app_livraison, qg');
    expect(noteTentative(t({ quand: NOW - 3 * H }), NOW)).toBeNull();
    expect(noteTentative(t({ issue: 'complet' }), NOW)).toBeNull();
  });
  it('vueLea lit lea:tentative', async () => {
    const kv = memoire();
    await kv.hset(CLES_LEA.tentative, 'json', JSON.stringify(t()));
    expect((await vueLea(kv, NOW)).tentative).toEqual(t());
  });
});

describe('M9 · le marqueur « … » se dit « liste coupée par GitHub »', () => {
  it('dans les lignes d’une relecture', () => {
    const r = { depot: 'a', quand: NOW, commits: [{ sha: 's1', message: 'm' }], enPartie: ['src/a.ts', '…'], clesNonVerifiees: ['…'], rienACoder: 0 };
    expect(lignesRelecture(r)).toEqual(['1 enregistrement relu', 'relu en partie : src/a.ts, liste coupée par GitHub', 'clés non vérifiées : liste coupée par GitHub']);
  });
});
