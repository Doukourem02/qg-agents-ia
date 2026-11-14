import { describe, it, expect } from 'vitest';
import { etatDossiers, passageZoro, cheminsStatus, ownerGithub } from './zoro.mjs';

const RACINE = '/h/Code';
const JOUR = 86_400_000;
const NOW = Date.UTC(2026, 10, 11, 12, 0);

/**
 * Faux disque et faux git. `arbre` : chemin de dossier → entrées ; `git` : chemin du dossier git → réponses par sous-commande ;
 * `dates` : chemin → mtimeMs (absent = ENOENT).
 */
function monde({ arbre, git = {}, dates = {} }) {
  const appels = [];
  const exec = async (cmd, args) => {
    appels.push([cmd, ...args]);
    expect(cmd).toBe('git');
    expect(args[0]).toBe('-C');
    const rep = git[args[1]] ?? {};
    const cle = args.slice(2).join(' ');
    const r = rep[cle];
    if (r === undefined) throw new Error('git: pas de réponse');
    if (r instanceof Error) throw r;
    return { stdout: r, stderr: '' };
  };
  const fs = {
    lister: async d => { if (!(d in arbre)) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return arbre[d]; },
    stat: async p => { if (!(p in dates)) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return { mtimeMs: dates[p] }; },
  };
  return { appels, exec, fs };
}
const dos = nom => ({ nom, dossier: true, lien: false });
const fic = nom => ({ nom, dossier: false, lien: false });

const STATUS = 'status --porcelain';
const NONPOUSSES = 'rev-list --branches --not --remotes --count';
const DATES_NP = 'rev-list --branches --not --remotes --format=%ct';
const LOG = 'log -1 --format=%ct';
const REMOTE = 'remote get-url origin';
const LISTE = 'remote';
const URL_UPSTREAM = 'remote get-url upstream';
const STASH = 'stash list';
const SAINB = { [STATUS]: ' M f\n', [NONPOUSSES]: '0\n', [LOG]: '5\n', [LISTE]: 'origin\n', [REMOTE]: 'https://github.com/o/ok\n', [STASH]: '' };

describe('etatDossiers', () => {
  it('un dossier git : compte = propriétaire de l\'URL github.com (https ou ssh), nonEnregistres = lignes de status --porcelain, nonPousses = rev-list --branches --not --remotes --count, stashes = lignes de stash list', async () => {
    const { exec, fs } = monde({
      arbre: { [RACINE]: [dos('a'), dos('b')], [`${RACINE}/a`]: [dos('.git'), fic('x')], [`${RACINE}/b`]: [dos('.git')] },
      git: {
        [`${RACINE}/a`]: {
          [STATUS]: ' M un.txt\n?? deux.txt\n', [NONPOUSSES]: '3\n', [DATES_NP]: `commit abc\n${1_700_000_300}\ncommit def\n${1_700_000_100}\n`,
          [LOG]: '1700000500\n', [LISTE]: 'origin\n', [REMOTE]: 'https://github.com/mon-compte/a.git\n', [STASH]: 'stash@{0}: WIP\nstash@{1}: WIP\n',
        },
        [`${RACINE}/b`]: {
          [STATUS]: '', [NONPOUSSES]: '0\n', [LOG]: '1700000000\n', [LISTE]: 'origin\n', [REMOTE]: 'git@github.com:Autre/b.git\n', [STASH]: '',
        },
      },
      dates: { [`${RACINE}/a`]: 1_600_000_000_000, [`${RACINE}/b`]: 1_600_000_000_000, [`${RACINE}/a/un.txt`]: 1_650_000_000_000, [`${RACINE}/a/deux.txt`]: 1_640_000_000_000 },
    });
    const r = await etatDossiers({ racine: RACINE, exec, fs, now: NOW });
    expect(r).toEqual([
      {
        nom: 'a', git: true, compte: 'mon-compte', distant: true, nonEnregistres: 2, plusAncienNonEnregistre: 1_640_000_000_000,
        nonPousses: 3, plusAncienNonPousse: 1_700_000_100_000, stashes: 2, dernierCommit: 1_700_000_500_000, modifie: 1_700_000_500_000,
      },
      {
        nom: 'b', git: true, compte: 'Autre', distant: true, nonEnregistres: 0, plusAncienNonEnregistre: null,
        nonPousses: 0, plusAncienNonPousse: null, stashes: 0, dernierCommit: 1_700_000_000_000, modifie: 1_700_000_000_000,
      },
    ]);
  });

  it('plusAncienNonEnregistre = plus petite date de modification parmi les fichiers listés par status (fichiers seulement, jamais leurs noms dans le résultat)', async () => {
    const { exec, fs } = monde({
      arbre: { [RACINE]: [dos('a')], [`${RACINE}/a`]: [dos('.git')] },
      git: { [`${RACINE}/a`]: {
        [STATUS]: ' M secret.env\n D supprime.txt\nR  ancien.txt -> nouveau mot.txt\n?? "avec espace \\303\\251.txt"\n',
        [NONPOUSSES]: '0\n', [LOG]: '1\n', [LISTE]: 'origin\n', [REMOTE]: 'https://github.com/o/a\n', [STASH]: '',
      } },
      dates: {
        [`${RACINE}/a`]: 5000, [`${RACINE}/a/secret.env`]: 3_000_000, [`${RACINE}/a/nouveau mot.txt`]: 2_000_000,
        [`${RACINE}/a/avec espace é.txt`]: 4_000_000,
      },
    });
    const [d] = await etatDossiers({ racine: RACINE, exec, fs, now: NOW });
    expect(d.nonEnregistres).toBe(4);
    expect(d.plusAncienNonEnregistre).toBe(2_000_000);
    expect(JSON.stringify(d)).not.toMatch(/secret|supprime|nouveau|espace|ancien/);
  });

  it('dossier sans .git : git false, modifie = date du dossier ; sous-dossier avec .git un niveau plus bas pris aussi (nom « parent/enfant »)', async () => {
    const { exec, fs, appels } = monde({
      arbre: {
        [RACINE]: [dos('docs'), dos('.cache'), dos('node_modules'), fic('fichier'), dos('groupe')],
        [`${RACINE}/docs`]: [fic('a.md')],
        [`${RACINE}/groupe`]: [dos('enfant'), dos('autre'), dos('.cache'), dos('node_modules')],
        [`${RACINE}/groupe/enfant`]: [dos('.git')], [`${RACINE}/groupe/autre`]: [fic('x')],
      },
      git: { [`${RACINE}/groupe/enfant`]: { [STATUS]: '', [NONPOUSSES]: '0\n', [LOG]: '9\n', [LISTE]: 'origin\n', [REMOTE]: 'https://gitlab.com/o/e.git\n', [STASH]: '' } },
      dates: { [`${RACINE}/docs`]: 111, [`${RACINE}/groupe`]: 222, [`${RACINE}/groupe/enfant`]: 333 },
    });
    const r = await etatDossiers({ racine: RACINE, exec, fs, now: NOW });
    expect(r.map(d => d.nom)).toEqual(['docs', 'groupe', 'groupe/enfant']);
    expect(r[0]).toEqual({
      nom: 'docs', git: false, compte: null, distant: false, nonEnregistres: 0, plusAncienNonEnregistre: null,
      nonPousses: 0, plusAncienNonPousse: null, stashes: 0, dernierCommit: null, modifie: 111,
    });
    expect(r[1]).toMatchObject({ nom: 'groupe', git: false, modifie: 222 });
    expect(r[2]).toMatchObject({ nom: 'groupe/enfant', git: true, compte: null, distant: true, modifie: 9000 });
    expect(appels.every(a => a[1] === '-C' && a[2] === `${RACINE}/groupe/enfant`)).toBe(true);
  });

  it('git appelé uniquement avec ces argv : status --porcelain, rev-list --branches --not --remotes --count, log -1 --format=%ct, remote get-url origin, stash list, et rev-list --branches --not --remotes --format=%ct', async () => {
    const { exec, fs, appels } = monde({
      arbre: { [RACINE]: [dos('a')], [`${RACINE}/a`]: [dos('.git')] },
      git: { [`${RACINE}/a`]: { [STATUS]: '', [NONPOUSSES]: '2\n', [DATES_NP]: 'commit x\n7\n', [LOG]: '7\n', [LISTE]: 'origin\n', [REMOTE]: 'x\n', [STASH]: '' } },
      dates: { [`${RACINE}/a`]: 1 },
    });
    await etatDossiers({ racine: RACINE, exec, fs, now: NOW });
    const permis = [STATUS, NONPOUSSES, DATES_NP, LOG, LISTE, REMOTE, STASH];
    expect(appels.length).toBeGreaterThan(0);
    for (const a of appels) { expect(a.slice(0, 3)).toEqual(['git', '-C', `${RACINE}/a`]); expect(permis).toContain(a.slice(3).join(' ')); }
    expect(new Set(appels.map(a => a.slice(3).join(' ')))).toEqual(new Set(permis));
  });

  const SAIN = { [STATUS]: ' M f\n', [NONPOUSSES]: '1\n', [DATES_NP]: 'commit x\n7\n', [LOG]: '5\n', [LISTE]: 'origin\n', [REMOTE]: 'https://github.com/o/ok\n', [STASH]: 'stash@{0}: x\n' };
  const unSeul = async reponses => {
    const { exec, fs } = monde({
      arbre: { [RACINE]: [dos('a'), dos('z')], [`${RACINE}/a`]: [dos('.git')], [`${RACINE}/z`]: [dos('.git')] },
      git: { [`${RACINE}/a`]: reponses, [`${RACINE}/z`]: SAIN }, dates: { [`${RACINE}/a`]: 800, [`${RACINE}/a/f`]: 700, [`${RACINE}/z`]: 900, [`${RACINE}/z/f`]: 700 },
    });
    return etatDossiers({ racine: RACINE, exec, fs, now: NOW });
  };
  for (const cmd of [STATUS, NONPOUSSES, DATES_NP, LOG, LISTE, REMOTE, STASH]) {
    it(`« git ${cmd} » en échec : dossier illisible (jamais sain), valeurs sûres, le scan continue`, async () => {
      const r = await unSeul({ ...SAIN, [cmd]: new Error('x') });
      expect(r[0].illisible).toBe(true);
      expect(r[1].illisible).toBeUndefined();
      expect(r[1]).toMatchObject({ nom: 'z', nonEnregistres: 1, compte: 'o' });
    });
  }
  it('tout échoue (dépôt vide ou cassé) : valeurs sûres et illisible', async () => {
    const e = new Error('x');
    const r = await unSeul({ [STATUS]: e, [NONPOUSSES]: e, [LOG]: e, [LISTE]: e, [STASH]: e });
    expect(r[0]).toEqual({
      nom: 'a', git: true, compte: null, distant: false, nonEnregistres: 0, plusAncienNonEnregistre: null,
      nonPousses: 0, plusAncienNonPousse: null, stashes: 0, dernierCommit: null, modifie: 800, illisible: true,
    });
  });
  it('sans dépôt distant : distant false, compte null, pas illisible', async () => {
    const r = await unSeul({ ...SAIN, [LISTE]: '' });
    expect(r[0]).toMatchObject({ distant: false, compte: null });
    expect(r[0].illisible).toBeUndefined();
  });
  it('un seul distant nommé « upstream » : distant true, compte pris sur lui', async () => {
    const r = await unSeul({ ...SAIN, [LISTE]: 'upstream\n', [URL_UPSTREAM]: 'git@github.com:Autre/x.git\n' });
    expect(r[0]).toMatchObject({ distant: true, compte: 'Autre' });
    expect(r[0].illisible).toBeUndefined();
  });

  it('un dossier illisible ou un lien symbolique ne casse pas le scan', async () => {
    const { exec, fs } = monde({
      arbre: { [RACINE]: [dos('casse'), { nom: 'lien', dossier: true, lien: true }, dos('bon')], [`${RACINE}/bon`]: [fic('x')] },
      dates: { [`${RACINE}/bon`]: 42 },
    });
    const r = await etatDossiers({ racine: RACINE, exec, fs, now: NOW });
    expect(r.map(d => d.nom)).toEqual(['bon', 'casse']);
    expect(r.find(d => d.nom === 'casse')).toMatchObject({ git: false, modifie: 0, illisible: true });
    expect(r.find(d => d.nom === 'bon').illisible).toBeUndefined();
  });

  it('un dossier qu\'on ne peut pas lister (EACCES) est « non lu », jamais « hors git » sain ; un enfant non listable aussi', async () => {
    const refus = Object.assign(new Error('permission refusée'), { code: 'EACCES' });
    const { exec, fs } = monde({
      arbre: { [RACINE]: [dos('prive'), dos('groupe')], [`${RACINE}/groupe`]: [dos('ferme'), dos('ouvert')], [`${RACINE}/groupe/ouvert`]: [fic('x')] },
      dates: { [`${RACINE}/prive`]: 5, [`${RACINE}/groupe`]: 6, [`${RACINE}/groupe/ferme`]: 7 },
    });
    const lister = fs.lister;
    fs.lister = async d => { if (d === `${RACINE}/prive` || d === `${RACINE}/groupe/ferme`) throw refus; return lister(d); };
    const r = await etatDossiers({ racine: RACINE, exec, fs, now: NOW });
    expect(r.map(d => d.nom)).toEqual(['groupe', 'groupe/ferme', 'prive']);
    expect(r.find(d => d.nom === 'prive')).toMatchObject({ git: false, illisible: true, modifie: 5 });
    expect(r.find(d => d.nom === 'groupe/ferme')).toMatchObject({ git: false, illisible: true, modifie: 7 });
    expect(r.find(d => d.nom === 'groupe').illisible).toBeUndefined();
  });

  it('un nom avec « \\ » est écarté côté Mac, les autres partent', async () => {
    const { exec, fs } = monde({ arbre: { [RACINE]: [dos('a\\b'), dos('ok')], [`${RACINE}/ok`]: [] }, dates: { [`${RACINE}/ok`]: 1 } });
    expect((await etatDossiers({ racine: RACINE, exec, fs, now: NOW })).map(d => d.nom)).toEqual(['ok']);
  });

  it('une date négative (avant 1970) ne donne jamais un champ négatif', async () => {
    const { exec, fs } = monde({
      arbre: { [RACINE]: [dos('a'), dos('b')], [`${RACINE}/a`]: [dos('.git')], [`${RACINE}/b`]: [] },
      git: { [`${RACINE}/a`]: { ...SAINB } }, dates: { [`${RACINE}/a`]: -5000, [`${RACINE}/a/f`]: -1, [`${RACINE}/b`]: -9 },
    });
    const r = await etatDossiers({ racine: RACINE, exec, fs, now: NOW });
    expect(r[0]).toMatchObject({ plusAncienNonEnregistre: null, modifie: 5000 });
    expect(r[1].modifie).toBe(0);
    for (const d of r) for (const v of Object.values(d)) if (typeof v === 'number') expect(v).toBeGreaterThanOrEqual(0);
  });

  it('les noms que le serveur refuserait (« .. ») sont écartés', async () => {
    const { exec, fs } = monde({ arbre: { [RACINE]: [dos('a..b'), dos('ok')], [`${RACINE}/ok`]: [] }, dates: { [`${RACINE}/ok`]: 1 } });
    expect((await etatDossiers({ racine: RACINE, exec, fs, now: NOW })).map(d => d.nom)).toEqual(['ok']);
  });
});

describe('ownerGithub', () => {
  it('https, ssh, avec ou sans .git ; autres hôtes → null', () => {
    expect(ownerGithub('https://github.com/mon-compte/x.git')).toBe('mon-compte');
    expect(ownerGithub('https://github.com/mon-compte/x')).toBe('mon-compte');
    expect(ownerGithub('https://jeton@github.com/mon-compte/x.git\n')).toBe('mon-compte');
    expect(ownerGithub('git@github.com:mon-compte/x.git')).toBe('mon-compte');
    expect(ownerGithub('ssh://git@github.com/o/x.git')).toBe('o');
    expect(ownerGithub('https://gitlab.com/o/x.git')).toBeNull();
    expect(ownerGithub('https://github.com.evil.fr/o/x.git')).toBeNull();
    expect(ownerGithub('/chemin/local')).toBeNull();
  });
});

describe('cheminsStatus', () => {
  it('renommage, guillemets, octal UTF-8, suppressions', () => {
    expect(cheminsStatus(' M a.txt\nR  a -> b\nC  "x y" -> "z w"\n D gone\n?? "t\\"q"\n?? "\\303\\251"\n'))
      .toEqual({ total: 6, chemins: ['a.txt', 'b', 'z w', 't"q', 'é'] });
  });
});

describe('passageZoro', () => {
  const base = () => {
    const m = monde({ arbre: { [RACINE]: [dos('a')], [`${RACINE}/a`]: [fic('x')] }, dates: { [`${RACINE}/a`]: 10 } });
    const appels = [];
    let demande = false, panne = false, panneEnvoi = false;
    const appeler = async (cmd, corps) => {
      appels.push([cmd, corps]);
      if (panne) throw new Error('réseau');
      if (cmd === 'a-envoyer') return { demande };
      if (panneEnvoi) throw new Error('réseau');
      return { ok: true };
    };
    return { appels, appeler, deps: { racine: RACINE, exec: m.exec, fs: m.fs }, regler: o => { ({ demande = demande, panne = panne, panneEnvoi = panneEnvoi } = o); } };
  };

  it('envoie une fois par jour', async () => {
    const { appels, appeler, deps } = base();
    const r = await passageZoro({ now: NOW, etat: {}, appeler, ...deps });
    expect(r).toEqual({ derniereZoro: '2026-11-11' });
    expect(appels.map(a => a[0])).toEqual(['a-envoyer', 'mac']);
    expect(appels[1][1]).toMatchObject({ quand: NOW, dossiers: [{ nom: 'a', git: false }] });
    const encore = await passageZoro({ now: NOW + 5 * 60_000, etat: { derniereZoro: '2026-11-11' }, appeler, ...deps });
    expect(encore).toEqual({});
    expect(appels.map(a => a[0])).toEqual(['a-envoyer', 'mac', 'a-envoyer']);
    const lendemain = await passageZoro({ now: NOW + JOUR, etat: { derniereZoro: '2026-11-11' }, appeler, ...deps });
    expect(lendemain).toEqual({ derniereZoro: '2026-11-12' });
  });

  it('envoie tout de suite si a-envoyer répond { demande: true }', async () => {
    const t = base();
    t.regler({ demande: true });
    const r = await passageZoro({ now: NOW, etat: { derniereZoro: '2026-11-11' }, appeler: t.appeler, ...t.deps });
    expect(r).toEqual({ derniereZoro: '2026-11-11' });
    expect(t.appels.map(a => a[0])).toEqual(['a-envoyer', 'mac']);
  });

  it('échec réseau à l\'envoi : derniereZoro n\'avance pas, l\'échec est gardé ; pas de nouveau scan avant une heure (sauf demande)', async () => {
    const t = base();
    const journal = [];
    t.regler({ panneEnvoi: true });
    const r1 = await passageZoro({ now: NOW, etat: {}, appeler: t.appeler, journal: m => journal.push(m), ...t.deps });
    expect(r1).toEqual({ zoroEchec: NOW });
    expect(journal.some(m => m.startsWith('zoro : envoi en échec'))).toBe(true);
    t.regler({ panneEnvoi: false });
    t.appels.length = 0;
    // 5 minutes plus tard : ni scan ni envoi (le scan complet ne repart pas toutes les 5 minutes)
    expect(await passageZoro({ now: NOW + 5 * 60_000, etat: r1, appeler: t.appeler, ...t.deps })).toEqual({});
    expect(t.appels.map(a => a[0])).toEqual(['a-envoyer']);
    // le QG demande un rapport : on n'attend pas
    t.regler({ demande: true });
    expect(await passageZoro({ now: NOW + 10 * 60_000, etat: r1, appeler: t.appeler, ...t.deps })).toEqual({ derniereZoro: '2026-11-11', zoroEchec: undefined });
    t.regler({ demande: false });
    // une heure après l'échec : nouvel essai, réussi → l'échec est oublié
    t.appels.length = 0;
    const r2 = await passageZoro({ now: NOW + 60 * 60_000, etat: r1, appeler: t.appeler, ...t.deps });
    expect(r2).toEqual({ derniereZoro: '2026-11-11' });
    expect('zoroEchec' in r2 && r2.zoroEchec === undefined).toBe(true);
    expect(t.appels.map(a => a[0])).toEqual(['a-envoyer', 'mac']);
  });

  it('a-envoyer en échec : on envoie quand même si le rapport du jour manque, sinon rien', async () => {
    const t = base();
    const journal = [];
    t.regler({ panne: true });
    expect(await passageZoro({ now: NOW, etat: {}, appeler: t.appeler, journal: m => journal.push(m), ...t.deps })).toEqual({ zoroEchec: NOW });
    expect(journal.some(m => m.includes('a-envoyer'))).toBe(true);
    t.appels.length = 0;
    expect(await passageZoro({ now: NOW, etat: { derniereZoro: '2026-11-11' }, appeler: t.appeler, ...t.deps })).toEqual({});
    expect(t.appels.map(a => a[0])).toEqual(['a-envoyer']);
  });
});
