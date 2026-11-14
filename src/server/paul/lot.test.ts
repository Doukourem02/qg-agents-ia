import { describe, expect, it } from 'vitest';
import { CLES } from '../qg';
import { DEBUT, FIN } from './bloc';
import { arbreCourt, derniereSeance, nomsVariables, plafonner, preparerLot, scriptsDe, MAX_PROJET, PREFIXE_COMMIT_PAUL } from './lot';
import { messageCommit } from './ecriture';
import { ecrireRapport } from './rapport';
import { CLES_PAUL, lireMarque, lirePassage } from './stockage';
import { phrasePaul, vuePaul } from './vue';
import type { LotPaul, ProjetLotPaul } from './types';
import { banc, blob, D, depot, ENV_SECRET, GHP, HEURE, JOUR, NOW } from './faux-github-test';

const lotDe = async (b: ReturnType<typeof banc>, t = NOW): Promise<LotPaul> => {
  const r = await preparerLot(b.kv, b.deps, t);
  if (!r.lot) throw new Error('lot attendu');
  return r.lot;
};
const etatPaul = async (b: ReturnType<typeof banc>) => JSON.parse((await b.kv.hgetall(CLES.etats)).paul ?? 'null');

describe('a-documenter : quels projets', () => {
  it('premier passage : seulement les projets avec des commits des 7 derniers jours ; les autres prennent un marque-page, sans message', async () => {
    const calme = depot('calme', 0);
    const b = banc([depot('actif', 3), calme]);
    const lot = await lotDe(b);
    expect(lot.projets.map(p => p.depot)).toEqual([D('actif')]);
    const p = lot.projets[0];
    expect(p.depuis).toBeNull();
    // le vieux commit (10 jours) n'y est pas ; du plus récent au plus ancien
    expect(p.commits.map(c => c.message)).toEqual(['Ajoute la partie 2', 'Ajoute la partie 1', 'Ajoute la partie 0']);
    expect(p.commits[0]).toMatchObject({ court: p.commits[0].sha.slice(0, 7), fichiers: ['src/partie2.ts'] });
    expect(p.readme).toMatchObject({ present: true, sha: blob(b.depots[0].fichiers['README.md']) });
    expect(p.claude).toMatchObject({ present: true, sha: blob(b.depots[0].fichiers['CLAUDE.md']) });
    expect(p.blocActuel).toBeNull();
    expect(p.scripts).toEqual({ source: 'package.json', lignes: ['dev : next dev', 'test : vitest run'] });
    expect(await lireMarque(b.kv, D('calme'))).toBe(calme.chaine[0].sha);
    expect(b.messages).toEqual([]);
    expect(await etatPaul(b)).toMatchObject({ statut: 'au travail', outil: 'GH' });
  });

  it('après un passage : seulement les projets qui ont de nouveaux commits depuis leur marque-page', async () => {
    const b = banc([depot('a', 2), depot('b', 1)]);
    const lot = await lotDe(b);
    await ecrireRapport(b.kv, { lot: lot.id, projets: lot.projets.map(p => ({ depot: p.depot, rien: true })) }, b.deps, NOW + HEURE);
    expect(await lireMarque(b.kv, D('a'))).toBe(b.depots[0].chaine.at(-1)!.sha);
    // une semaine plus tard : un seul nouveau commit, sur « b »
    b.depots[1].chaine.push({ sha: blob('b-neuf'), date: NOW + 6 * JOUR, message: 'Nouveau', fichiers: ['src/neuf.ts'] });
    const suivant = await lotDe(b, NOW + 7 * JOUR);
    expect(suivant.projets.map(p => p.depot)).toEqual([D('b')]);
    expect(suivant.projets[0].depuis).toBe(b.depots[1].chaine.at(-2)!.sha);
    expect(suivant.projets[0].commits.map(c => c.message)).toEqual(['Nouveau']);
  });

  it('rien de nouveau nulle part : pas de lot, pas de message, passage complet noté', async () => {
    const b = banc([depot('a', 0)]);
    expect(await preparerLot(b.kv, b.deps, NOW)).toEqual({ lot: null });
    expect(b.messages).toEqual([]);
    expect(await lirePassage(b.kv)).toMatchObject({ quand: NOW, relus: 0, propositions: 0 });
    expect(await etatPaul(b)).toMatchObject({ statut: 'termine', tache: 'a relu la semaine : rien à proposer' });
  });

  it('marque-page introuvable (historique réécrit) : les 7 derniers jours, dit « reecrit »', async () => {
    const b = banc([depot('a', 2)]);
    await b.kv.hset(CLES_PAUL.vu(D('a')), 'sha', blob('disparu'));
    const lot = await lotDe(b);
    expect(lot.projets[0]).toMatchObject({ reecrit: true, depuis: null });
    expect(lot.projets[0].commits).toHaveLength(2);
  });

  it('un projet illisible attend le passage suivant ; les autres partent ; un lot remis il y a moins de 50 min attend', async () => {
    const b = banc([{ ...depot('panne', 1), panne: true }, depot('ok', 1)]);
    const lot = await lotDe(b);
    expect(lot.projets.map(p => p.depot)).toEqual([D('ok')]);
    expect(await lireMarque(b.kv, D('panne'))).toBeNull();
    expect(lot.projets).toHaveLength(1);
    expect(await preparerLot(b.kv, b.deps, NOW + 10 * 60_000)).toEqual({ lot: null, attente: true });
    // passé 50 min : un nouveau lot, mêmes commits
    const encore = await lotDe(b, NOW + HEURE);
    expect(encore.id).not.toBe(lot.id);
    expect(encore.projets[0].commits.map(c => c.sha)).toEqual(lot.projets[0].commits.map(c => c.sha));
  });

  it('les commits de Paul lui-même (après un Valider) ne relancent pas un passage', async () => {
    const b = banc([depot('a', 1)]);
    const lot = await lotDe(b);
    await ecrireRapport(b.kv, { lot: lot.id, projets: [{ depot: D('a'), rien: true }] }, b.deps, NOW + HEURE);
    b.depots[0].chaine.push({ sha: blob('a-paul'), date: NOW + 2 * HEURE, message: 'Paul (Archiviste) : README.md à jour — validé par le patron' });
    expect(await preparerLot(b.kv, b.deps, NOW + 7 * JOUR)).toEqual({ lot: null });
    expect(await lireMarque(b.kv, D('a'))).toBe(blob('a-paul'));
    expect(messageCommit('CLAUDE.md').startsWith(PREFIXE_COMMIT_PAUL)).toBe(true);
    // un vrai commit du patron ensuite : seul lui figure dans le lot
    b.depots[0].chaine.push({ sha: blob('a-moi'), date: NOW + 7 * JOUR, message: 'Mon travail' });
    b.depots[0].chaine.push({ sha: blob('a-paul2'), date: NOW + 7 * JOUR, message: 'Paul (Archiviste) : CLAUDE.md à jour — validé par le patron' });
    expect((await lotDe(b, NOW + 14 * JOUR)).projets[0].commits.map(c => c.message)).toEqual(['Mon travail']);
  });

  it('plus de 100 commits depuis le marque-page : les 100 plus récents, le reste compté et dit', async () => {
    const b = banc([depot('a', 1)]);
    const lot = await lotDe(b);
    await ecrireRapport(b.kv, { lot: lot.id, projets: [{ depot: D('a'), rien: true }] }, b.deps, NOW + HEURE);
    for (let i = 0; i < 150; i++) b.depots[0].chaine.push({ sha: blob(`a-n${i}`), date: NOW + 2 * HEURE + i * 60_000, message: `n${i}` });
    const p = (await lotDe(b, NOW + 7 * JOUR)).projets[0];
    expect(p.commits).toHaveLength(100);
    expect(p.commits[0].message).toBe('n149');
    expect(p.commits.at(-1)!.message).toBe('n50');
    expect(p.commitsCoupes).toBe(50);
    expect(p.enPartie).toContain('commits');
  });

  it('comparaison « behind » ou « identical » : rien à documenter, le marque-page suit la tête', async () => {
    for (const compare of ['behind', 'identical'] as const) {
      const b = banc([{ ...depot('a', 1), compare }]);
      await b.kv.hset(CLES_PAUL.vu(D('a')), 'sha', b.depots[0].chaine[0].sha);
      expect(await preparerLot(b.kv, b.deps, NOW)).toEqual({ lot: null });
      expect(await lireMarque(b.kv, D('a'))).toBe(b.depots[0].chaine.at(-1)!.sha);
    }
  });

  it('rien de nouveau mais un projet illisible : passage incomplet, jamais « rien à proposer »', async () => {
    const b = banc([depot('calme', 0), { ...depot('panne', 1), panne: true }]);
    expect(await preparerLot(b.kv, b.deps, NOW)).toEqual({ lot: null });
    expect(await lirePassage(b.kv)).toMatchObject({ quand: NOW, relus: 0, illisibles: ['panne'] });
    const e = await etatPaul(b);
    expect(e.tache).toBe('a relu la semaine en partie : aucune proposition ; non relus : panne');
    expect(e.statut).toBe('erreur');
  });

  it('aucun projet lisible : passage raté (pas « en partie »), dit avec la raison', async () => {
    const b = banc([{ ...depot('panne', 1), panne: true }]);
    expect(await preparerLot(b.kv, b.deps, NOW)).toEqual({ lot: null });
    expect(await lirePassage(b.kv)).toBeNull();
    expect(await etatPaul(b)).toMatchObject({ statut: 'erreur', tache: 'n\'a pu lire aucun projet : panne (GitHub n\'a pas répondu)' });
    const v = await vuePaul(b.kv, NOW + HEURE);
    expect(v.echec).toEqual({ quand: NOW, illisibles: ['panne'] });
    expect(phrasePaul(v)).toBe('Dernier passage raté : aucun projet lu (GitHub n\'a pas répondu pour panne).');
    // le jeudi suivant 20:00 sans autre passage : le créneau est dit raté
    expect((await vuePaul(b.kv, NOW + 2 * HEURE + 60_000)).rate).toBe(NOW);
  });

  it('sans la clé de lecture : refusé (503)', async () => {
    const b = banc([depot('a')], { jeton: null });
    await expect(preparerLot(b.kv, b.deps, NOW)).rejects.toMatchObject({ code: 503 });
  });
});

describe('a-documenter : ce qui part, toujours masqué', () => {
  it('les clés sont masquées partout (README, CLAUDE.md, message de commit, note de séance, scripts) ; .env.example : les noms seulement', async () => {
    const d = depot('fuite', 1, {
      'README.md': `# Fuite\n\nMa clé : ${GHP}\n`,
      'CLAUDE.md': `# Projet\n\n${DEBUT}\nAncien bloc ${GHP}\n${FIN}\n`,
      '.env.example': `API_KEY=${ENV_SECRET}\nexport AUTRE_TOKEN="${GHP}"\n# commentaire\n`,
      'docs/seances/2026-11-01 — Fuite.md': 'vieille note',
      'docs/seances/2026-11-10 — Fuite.md': `Où on s'est arrêté. Jeton ${GHP}`,
      'package.json': JSON.stringify({ scripts: { deploy: `curl -H "x: ${GHP}"` } }),
    });
    d.chaine[1].message = `Ajoute la clé ${GHP}\n\ndeuxième ligne`;
    const b = banc([d]);
    const lot = await lotDe(b);
    const p = lot.projets[0];
    const brut = JSON.stringify(lot);
    expect(brut).not.toContain(GHP);
    expect(brut).not.toContain(ENV_SECRET);
    expect(p.readme.present && p.readme.contenu).toContain('[clé GitHub masquée]');
    expect(p.blocActuel).toBe('Ancien bloc [clé GitHub masquée]');
    expect(p.commits[0].message).toBe('Ajoute la clé [clé GitHub masquée]');
    expect(p.variables).toEqual(['API_KEY', 'AUTRE_TOKEN']);
    expect(p.seance).toEqual({ chemin: 'docs/seances/2026-11-10 — Fuite.md', contenu: 'Où on s\'est arrêté. Jeton [clé GitHub masquée]' });
    expect(p.scripts!.lignes[0]).toContain('[clé GitHub masquée]');
    // rien de secret n'entre non plus dans la mémoire du serveur
    expect(b.ecrits.join('\n')).not.toContain(GHP);
    expect(b.ecrits.join('\n')).not.toContain(ENV_SECRET);
  });

  it('AGENTS.md présent, arborescence sur 2 niveaux sans node_modules, .next, dist, build', async () => {
    const b = banc([depot('a', 1, { 'AGENTS.md': 'x', 'node_modules/x/index.js': 'x', 'src/ui/profond/a.ts': 'x', 'dist/a.js': 'x', '.next/a': 'x' })]);
    const p = (await lotDe(b)).projets[0];
    expect(p.agents).toBe(true);
    expect(p.arbre).toContain('src/');
    expect(p.arbre).toContain('src/ui/');
    expect(p.arbre).not.toContain('src/ui/profond/');
    expect(p.arbre.some(x => /node_modules|dist|\.next/.test(x))).toBe(false);
  });

  it('60 Ko au plus par projet : coupé et dit (« relu en partie »)', async () => {
    const enorme = Array.from({ length: 3000 }, (_, i) => `ligne de séance numéro ${i} avec un peu de texte`).join('\n');
    const b = banc([depot('gros', 1, { 'docs/seances/2026-11-10 — Gros.md': enorme, 'README.md': 'r'.repeat(60) + '\n' + 'x'.repeat(40_000) })]);
    const p = (await lotDe(b)).projets[0];
    expect(JSON.stringify(p).length).toBeLessThanOrEqual(MAX_PROJET);
    expect(p.enPartie).toEqual(expect.arrayContaining(['note de séance', 'README.md']));
    expect(p.readme).toMatchObject({ enPartie: true });
  });
});

describe('les morceaux purs du lot', () => {
  it('noms des variables, jamais les valeurs', () => {
    expect(nomsVariables(`A=1\n  export B = "x"\n#C=3\nD\nE_F=\n`)).toEqual(['A', 'B', 'E_F']);
  });
  it('scripts : package.json, pyproject.toml, Makefile', () => {
    expect(scriptsDe('package.json', '{pas du json')).toBeNull();
    expect(scriptsDe('pyproject.toml', '[project]\nname = "x"\n[project.scripts]\nqg = "qg.main:run"\n[tool.x]\ny = 1\n')).toEqual({ source: 'pyproject.toml', lignes: ['qg : qg.main:run'] });
    expect(scriptsDe('Makefile', '.PHONY: test\ntest:\n\tpytest\nVAR := 1\nbuild: deps\n')).toEqual({ source: 'Makefile', lignes: ['test', 'build'] });
  });
  it('arborescence et dernière note de séance', () => {
    expect(arbreCourt([{ chemin: 'b', dossier: true }, { chemin: 'a.md', dossier: false }, { chemin: 'b/c/d', dossier: false }, { chemin: 'build', dossier: true }])).toEqual(['a.md', 'b/']);
    expect(derniereSeance([
      { chemin: 'docs/seances/2026-11-01 — X.md', dossier: false }, { chemin: 'docs/seances/2026-11-09 — X.md', dossier: false },
      { chemin: 'docs/seances/vieux/2027-01-01.md', dossier: false },
    ])).toBe('docs/seances/2026-11-09 — X.md');
    expect(derniereSeance([])).toBeNull();
  });
  it('plafonner coupe dans l\'ordre : séance, arborescence, fichiers des commits, commits', () => {
    const p: ProjetLotPaul = {
      depot: 'x', branche: 'main', tete: 't', depuis: null, commits: Array.from({ length: 50 }, (_, i) => ({ sha: `s${i}`, court: `s${i}`, message: 'm'.repeat(150), date: 0, fichiers: ['a'.repeat(100)] })),
      readme: { present: false }, claude: { present: false }, blocActuel: null, agents: false, scripts: null,
      arbre: Array.from({ length: 300 }, (_, i) => `dossier-${i}/`), variables: [], seance: { chemin: 's', contenu: 'x'.repeat(2000) }, enPartie: [],
    };
    const r = plafonner(p, 8 * 1024);
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(8 * 1024);
    expect(r.seance).toBeNull();
    expect(r.enPartie.slice(0, 3)).toEqual(['note de séance', 'arborescence', 'fichiers des commits']);
  });
});
