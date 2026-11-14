import { describe, it, expect } from 'vitest';
import { estArrivee, cheminSeance, cheminSur, ajouterLien, passage } from './relais.mjs';

const MIN = 60_000;
const COFFRE = '/v/Obsidian Vault';
const note = (o = {}) => ({ id: 'n1', depot: 'qg', nom: 'QG', jour: '2026-11-10', markdown: '# Séance', auteur: 'mafe', obsidian: false, quand: 1, ...o });

describe('estArrivee', () => {
  it('premier passage : vrai', () => expect(estArrivee({}, 1000 * MIN)).toBe(true));
  it('4 min après : faux', () => expect(estArrivee({ dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN }, 104 * MIN)).toBe(false));
  it('61 min de sommeil : vrai', () => expect(estArrivee({ dernierPassage: 100 * MIN, derniereOuverture: 20 * MIN }, 161 * MIN)).toBe(true));
  it('deux arrivées à 30 min : la seconde n\'ouvre pas', () => {
    expect(estArrivee({ dernierPassage: 0, derniereOuverture: 0 }, 30 * MIN)).toBe(false);
    expect(estArrivee({ dernierPassage: 100 * MIN, derniereOuverture: 70 * MIN }, 170 * MIN)).toBe(true);
    expect(estArrivee({ dernierPassage: 0, derniereOuverture: 70 * MIN }, 100 * MIN)).toBe(false);
  });
});

describe('chemins', () => {
  it('cheminSeance', () => expect(cheminSeance(COFFRE, note())).toBe(`${COFFRE}/Séances/2026-11-10 — QG.md`));
  it('nettoie le nom : pas de / \\ ni de point en tête', () => {
    expect(cheminSeance(COFFRE, note({ nom: '../mastack\\x' }))).toBe(`${COFFRE}/Séances/2026-11-10 — mastackx.md`);
  });
  it('cheminSur refuse hors Séances/Projets et mastack', () => {
    expect(() => cheminSur(COFFRE, `${COFFRE}/Séances/a.md`)).not.toThrow();
    expect(() => cheminSur(COFFRE, `${COFFRE}/Projets/a.md`)).not.toThrow();
    expect(() => cheminSur(COFFRE, `${COFFRE}/mastack/a.md`)).toThrow();
    expect(() => cheminSur(COFFRE, `${COFFRE}/Séances/../mastack/a.md`)).toThrow();
    expect(() => cheminSur(COFFRE, '/etc/passwd')).toThrow();
  });
});

describe('ajouterLien', () => {
  it('crée la note si vide', () => expect(ajouterLien('', 'QG · 2026-11', '2026-11-10 — QG')).toBe('# QG · 2026-11\n\n- [[2026-11-10 — QG]]\n'));
  it('ajoute une seule fois', () => {
    const une = ajouterLien('', 'QG · 2026-11', '2026-11-10 — QG');
    expect(ajouterLien(une, 'QG · 2026-11', '2026-11-10 — QG')).toBe(une);
  });
  it('sous une section, avant la suivante', () => {
    expect(ajouterLien('# QG\n\n## Branches\n- [[QG · Docs]]\n\n## Technos\n- [[Expo]]\n', 'QG', 'QG · Séances', 'Branches'))
      .toBe('# QG\n\n## Branches\n- [[QG · Docs]]\n- [[QG · Séances]]\n\n## Technos\n- [[Expo]]\n');
  });
  it('crée la section si absente', () => expect(ajouterLien('# QG\n\nTexte\n', 'QG', 'QG · Séances', 'Branches')).toBe('# QG\n\nTexte\n\n## Branches\n- [[QG · Séances]]\n'));
});

function monde({ etat = {}, notes = [], echecs = {}, ecritureEchoue = [], fichiers = {}, lectureEchoue = [], ouvrirEchoue = false } = {}) {
  const j = { appels: [], ouvertures: [], fichiers: { ...fichiers }, etat: { ...etat }, ordre: [] };
  return {
    j,
    deps: {
      coffre: COFFRE,
      lireEtat: async () => ({ ...j.etat }),
      ecrireEtat: async e => { j.etat = { ...e }; },
      appeler: async (cmd, corps) => {
        j.appels.push([cmd, corps]); j.ordre.push(cmd);
        if (echecs[cmd]) throw new Error('boom');
        return cmd === 'a-copier' ? notes : {};
      },
      ouvrir: async url => { if (ouvrirEchoue) throw new Error('Safari'); j.ouvertures.push(url); j.ordre.push('ouvrir'); },
      lireFichier: async p => { if (lectureEchoue.some(s => p.includes(s))) throw Object.assign(new Error('permission'), { code: 'EACCES' }); return j.fichiers[p] ?? null; },
      ecrireFichier: async (p, c) => { if (ecritureEchoue.some(s => p.includes(s))) throw new Error('disque'); j.fichiers[p] = c; },
      creerFichier: async (p, c) => {
        if (ecritureEchoue.some(s => p.includes(s))) throw new Error('disque');
        if (p in j.fichiers) throw Object.assign(new Error('existe'), { code: 'EEXIST' });
        j.fichiers[p] = c;
      },
    },
  };
}

describe('passage', () => {
  it('à l\'arrivée : rafraichir puis ouvre Safari sur ?arrivee=1', async () => {
    const { j, deps } = monde();
    await passage({ ...deps, now: 1000 * MIN });
    expect(j.ordre.slice(0, 2)).toEqual(['rafraichir', 'ouvrir']);
    expect(j.ouvertures).toEqual(['https://mon-qg.vercel.app/?arrivee=1']);
    expect(j.etat.derniereOuverture).toBe(1000 * MIN);
  });
  it('un rafraichir en échec n\'empêche pas d\'ouvrir Safari', async () => {
    const { j, deps } = monde({ echecs: { rafraichir: true } });
    await passage({ ...deps, now: 1000 * MIN });
    expect(j.ouvertures).toHaveLength(1);
  });
  it('pas d\'arrivée : ni rafraichir ni Safari, mais dernierPassage écrit', async () => {
    const { j, deps } = monde({ etat: { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN } });
    await passage({ ...deps, now: 105 * MIN });
    expect(j.ouvertures).toEqual([]);
    expect(j.ordre).not.toContain('rafraichir');
    expect(j.etat.dernierPassage).toBe(105 * MIN);
    expect(j.etat.derniereOuverture).toBe(100 * MIN);
  });
  it('écrit les notes puis envoie leurs ids à copie, et lie le projet', async () => {
    const { j, deps } = monde({ etat: { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN }, notes: [note(), note({ id: 'n2', nom: 'Autre' })] });
    await passage({ ...deps, now: 105 * MIN });
    expect(j.fichiers[`${COFFRE}/Séances/2026-11-10 — QG.md`]).toBe('# Séance');
    expect(j.fichiers[`${COFFRE}/Carte/QG · 2026-11.md`]).toContain('[[2026-11-10 — QG]]');
    expect(j.appels.at(-1)).toEqual(['copie', { ids: ['n1', 'n2'] }]);
  });
  it('range la séance dans l\'arbre : mois → Séances → projet → Code', async () => {
    const { j, deps } = monde({ etat: { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN }, notes: [note()],
      fichiers: { [`${COFFRE}/Projets/QG.md`]: '# QG\n\n## Branches\n- [[QG · Docs]]\n' } });
    await passage({ ...deps, now: 105 * MIN });
    expect(j.fichiers[`${COFFRE}/Carte/QG · 2026-11.md`]).toContain('[[2026-11-10 — QG]]');
    expect(j.fichiers[`${COFFRE}/Carte/QG · Séances.md`]).toContain('[[QG · 2026-11]]');
    expect(j.fichiers[`${COFFRE}/Projets/QG.md`]).toBe('# QG\n\n## Branches\n- [[QG · Docs]]\n- [[QG · Séances]]\n');
    expect(j.fichiers[`${COFFRE}/Carte/Code.md`]).toContain('[[QG]]');
  });
  it('une écriture en échec : son id n\'est pas dans copie', async () => {
    const { j, deps } = monde({ etat: { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN }, notes: [note(), note({ id: 'n2', nom: 'Autre' })], ecritureEchoue: ['Autre'] });
    await passage({ ...deps, now: 105 * MIN });
    expect(j.appels.at(-1)).toEqual(['copie', { ids: ['n1'] }]);
  });
  it('un chemin hors coffre est refusé (jamais écrit, id non copié)', async () => {
    const { j, deps } = monde({ etat: { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN }, notes: [note({ jour: '../../mastack/x' })] });
    await passage({ ...deps, now: 105 * MIN });
    expect(Object.keys(j.fichiers).every(p => ['Séances', 'Projets', 'Carte'].some(d => p.startsWith(`${COFFRE}/${d}/`)))).toBe(true);
    expect(Object.keys(j.fichiers).some(p => p.includes('mastack'))).toBe(false);
    expect(j.ordre).not.toContain('copie');
  });
  it('a-copier en échec : on saute la copie, dernierPassage écrit', async () => {
    const { j, deps } = monde({ echecs: { 'a-copier': true } });
    await passage({ ...deps, now: 1000 * MIN });
    expect(j.ordre).not.toContain('copie');
    expect(j.etat.dernierPassage).toBe(1000 * MIN);
  });
  it('une séance déjà dans Obsidian n\'est jamais écrasée : « (2) », puis « (3) », et le lien suit', async () => {
    const vieux = `${COFFRE}/Séances/2026-11-10 — QG.md`;
    const { j, deps } = monde({ etat: { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN }, notes: [note({ markdown: 'neuf' })], fichiers: { [vieux]: 'à moi' } });
    await passage({ ...deps, now: 105 * MIN });
    expect(j.fichiers[vieux]).toBe('à moi');
    expect(j.fichiers[`${COFFRE}/Séances/2026-11-10 — QG (2).md`]).toBe('neuf');
    expect(j.fichiers[`${COFFRE}/Carte/QG · 2026-11.md`]).toContain('[[2026-11-10 — QG (2)]]');
    expect(j.appels.at(-1)).toEqual(['copie', { ids: ['n1'] }]);
    // une troisième note du même jour : (3)
    const m = monde({ etat: { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN }, notes: [note({ markdown: 'trois' })],
      fichiers: { [vieux]: 'a', [`${COFFRE}/Séances/2026-11-10 — QG (2).md`]: 'b' } });
    await passage({ ...m.deps, now: 105 * MIN });
    expect(m.j.fichiers[`${COFFRE}/Séances/2026-11-10 — QG (3).md`]).toBe('trois');
  });
  it('un passage rejoué après une copie interrompue ne crée pas de doublon', async () => {
    const f = `${COFFRE}/Séances/2026-11-10 — QG.md`;
    const { j, deps } = monde({ etat: { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN }, notes: [note()], fichiers: { [f]: '# Séance' } });
    await passage({ ...deps, now: 105 * MIN });
    expect(Object.keys(j.fichiers).filter(p => p.includes('(2)'))).toEqual([]);
    expect(j.fichiers[`${COFFRE}/Carte/QG · 2026-11.md`]).toContain('[[2026-11-10 — QG]]');
  });
  it('une lecture en erreur (pas « inexistant ») saute la note : id non copié', async () => {
    const { j, deps } = monde({ etat: { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN }, notes: [note(), note({ id: 'n2', nom: 'Autre' })], lectureEchoue: ['Projets/Autre'] });
    await passage({ ...deps, now: 105 * MIN });
    expect(j.appels.at(-1)).toEqual(['copie', { ids: ['n1'] }]);
    expect(j.fichiers[`${COFFRE}/Projets/Autre.md`]).toBeUndefined();
  });
  it('Safari qui ne s\'ouvre pas : dernierPassage inchangé, le passage suivant réessaie', async () => {
    const { j, deps } = monde({ etat: { dernierPassage: 10 * MIN, derniereOuverture: 10 * MIN }, ouvrirEchoue: true });
    await passage({ ...deps, now: 1000 * MIN });
    expect(j.etat.dernierPassage).toBe(10 * MIN);
    expect(j.etat.derniereOuverture).toBe(10 * MIN);
    expect(estArrivee(j.etat, 1005 * MIN)).toBe(true);
  });
});

describe('mémoire quotidienne', () => {
  const DEJA = { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN };
  it('lancée une fois par jour, puis plus jusqu\'au lendemain', async () => {
    let n = 0;
    const memoire = async () => { n++; return { commits: 1, seances: 0, docs: 0, projets: 0 }; };
    const { j, deps } = monde({ etat: DEJA });
    await passage({ ...deps, memoire, now: 105 * MIN });
    await passage({ ...deps, memoire, now: 110 * MIN });
    expect(n).toBe(1);
    expect(j.etat.derniereMemoire).toBe(new Date(105 * MIN).toISOString().slice(0, 10));
    await passage({ ...deps, memoire, now: 105 * MIN + 86_400_000 });
    expect(n).toBe(2);
  });
  it('en échec : réessayée au passage suivant', async () => {
    let n = 0;
    const memoire = async () => { n++; if (n === 1) throw new Error('git'); return { commits: 0, seances: 0, docs: 0, projets: 0 }; };
    const { j, deps } = monde({ etat: DEJA });
    await passage({ ...deps, memoire, now: 105 * MIN });
    expect(j.etat.derniereMemoire).toBeUndefined();
    await passage({ ...deps, memoire, now: 110 * MIN });
    expect(n).toBe(2);
    expect(j.etat.derniereMemoire).toBeDefined();
  });
});

describe('Isaac dans le passage', () => {
  const DEJA = { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN, derniereMesureIsaac: 50 * MIN };
  it('appelé à chaque passage avec l\'état ; ce qu\'il rend est rangé dans l\'état', async () => {
    const vus = [];
    const isaac = async etat => { vus.push(etat); return { derniereMesureIsaac: 105 * MIN, isaacProposees: { a: 1 } }; };
    const { j, deps } = monde({ etat: DEJA });
    await passage({ ...deps, isaac, now: 105 * MIN });
    expect(vus).toEqual([DEJA]);
    expect(j.etat).toMatchObject({ dernierPassage: 105 * MIN, derniereMesureIsaac: 105 * MIN, isaacProposees: { a: 1 } });
  });
  it('Isaac en échec : le reste du passage continue, son état est gardé', async () => {
    const isaac = async () => { throw new Error('df'); };
    const { j, deps } = monde({ etat: DEJA, notes: [note()] });
    await passage({ ...deps, isaac, now: 105 * MIN });
    expect(j.etat.derniereMesureIsaac).toBe(50 * MIN);
    expect(j.appels.at(-1)).toEqual(['copie', { ids: ['n1'] }]);
  });
});

describe('Zoro dans le passage', () => {
  const DEJA = { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN };
  it('appelé après Isaac avec l\'état ; derniereZoro est rangé dans l\'état', async () => {
    const ordre = [], vus = [];
    const isaac = async () => { ordre.push('isaac'); return { derniereMesureIsaac: 1 }; };
    const zoro = async etat => { ordre.push('zoro'); vus.push(etat); return { derniereZoro: '2026-11-11' }; };
    const { j, deps } = monde({ etat: DEJA });
    await passage({ ...deps, isaac, zoro, now: 105 * MIN });
    expect(ordre).toEqual(['isaac', 'zoro']);
    expect(vus).toEqual([DEJA]);
    expect(j.etat).toMatchObject({ derniereMesureIsaac: 1, derniereZoro: '2026-11-11' });
  });
  it('Zoro en échec : journalisé, le reste du passage continue, l\'état précédent est gardé', async () => {
    const zoro = async () => { throw new Error('réseau'); };
    const lignes = [];
    const { j, deps } = monde({ etat: { ...DEJA, derniereZoro: '2026-11-10' }, notes: [note()] });
    await passage({ ...deps, zoro, journal: m => lignes.push(m), now: 105 * MIN });
    expect(j.etat.derniereZoro).toBe('2026-11-10');
    expect(lignes.some(m => m.startsWith('zoro : échec'))).toBe(true);
    expect(j.appels.at(-1)).toEqual(['copie', { ids: ['n1'] }]);
  });
});

describe('Feu dans le passage', () => {
  const DEJA = { dernierPassage: 100 * MIN, derniereOuverture: 100 * MIN };
  it('appelé après Zoro avec l\'état ; en échec, journalisé, le reste du passage continue', async () => {
    const ordre = [];
    const zoro = async () => { ordre.push('zoro'); return {}; };
    const feu = async () => { ordre.push('feu'); return { feuAbsente: 7 }; };
    const { j, deps } = monde({ etat: DEJA });
    await passage({ ...deps, zoro, feu, now: 105 * MIN });
    expect(ordre).toEqual(['zoro', 'feu']);
    expect(j.etat.feuAbsente).toBe(7);
    const lignes = [];
    const casse = monde({ etat: DEJA, notes: [note()] });
    await passage({ ...casse.deps, feu: async () => { throw new Error('trousseau'); }, journal: m => lignes.push(m), now: 105 * MIN });
    expect(lignes.some(m => m.startsWith('feu : échec'))).toBe(true);
    expect(casse.j.appels.at(-1)).toEqual(['copie', { ids: ['n1'] }]);
  });
});
