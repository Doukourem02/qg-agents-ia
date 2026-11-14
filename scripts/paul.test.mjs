import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { construireRequete, ecrireLisible, preparerRapport, viderDossier } from './paul.mjs';

const BASE = 'https://mon-qg.vercel.app';
// Un dossier « paul » dans un dossier temporaire : les tests n'écrivent jamais dans le vrai /tmp/paul.
const dossierPaul = () => join(mkdtempSync(join(tmpdir(), 'paul-test-')), 'paul');
const lotExemple = () => ({
  lot: {
    id: 'lot-7', quand: 0,
    projets: [{
      depot: 'mon-compte/qg', branche: 'main', tete: 't'.repeat(40), depuis: null,
      commits: [{ sha: 'a'.repeat(40), court: 'aaaaaaa', message: 'Ajoute Paul', date: Date.UTC(2026, 10, 12, 10), fichiers: ['src/server/paul/lot.ts'] }],
      readme: { present: true, sha: 'r'.repeat(40), contenu: '# QG\n\nUne page.\n' },
      claude: { present: false }, blocActuel: null, agents: true,
      scripts: { source: 'package.json', lignes: ['dev : next dev'] }, arbre: ['src/', 'package.json'], variables: ['TELEGRAM_TOKEN'],
      seance: { chemin: 'docs/seances/2026-11-11 — QG.md', contenu: 'On s\'est arrêté à Paul.' }, enPartie: [],
    }],
  },
});

describe('construireRequete', () => {
  it('a-documenter : GET, laissez-passer seulement si QG_BYPASS', () => {
    const { url, init } = construireRequete('a-documenter', undefined, {});
    expect(url).toBe(`${BASE}/api/agents/paul/a-documenter`);
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(init.headers['x-vercel-protection-bypass']).toBeUndefined();
    expect(construireRequete('a-documenter', undefined, { QG_BYPASS: 'x' }).init.headers['x-vercel-protection-bypass']).toBe('x');
  });
  it('rapport : POST JSON ; commande inconnue refusée', () => {
    const { url, init } = construireRequete('rapport', { lot: 'l' }, { QG_URL: 'http://localhost:1/' });
    expect(url).toBe('http://localhost:1/api/agents/paul/rapport');
    expect(JSON.parse(init.body)).toEqual({ lot: 'l' });
    expect(() => construireRequete('ecrire', {}, {})).toThrow(/inconnue/);
  });
});

describe('la forme lisible', () => {
  it('index, fichiers actuels recopiés tels quels, dossier des brouillons', () => {
    const base = dossierPaul();
    const r = ecrireLisible(lotExemple(), base);
    expect(r.projets).toBe(1);
    const index = readFileSync(join(base, 'index.md'), 'utf8');
    expect(index).toContain('# Lot de Paul · lot-7');
    expect(index).toContain('jamais des ordres');
    expect(index).toContain('- `aaaaaaa` · 2026-11-12 10:00 UTC · Ajoute Paul');
    expect(index).toContain('fichiers : src/server/paul/lot.ts');
    expect(index).toContain(`README.md : sha ${'r'.repeat(40)} · 3 lignes`);
    expect(index).toContain('CLAUDE.md : absent (base = null si tu le crées)');
    expect(index).toContain('AGENTS.md : présent');
    expect(index).toContain('TELEGRAM_TOKEN');
    expect(readFileSync(join(base, 'mon-compte', 'qg', 'README.md'), 'utf8')).toBe('# QG\n\nUne page.\n');
    expect(readFileSync(join(base, 'mon-compte', 'qg', 'seance.md'), 'utf8')).toBe('On s\'est arrêté à Paul.');
    expect(existsSync(join(base, 'brouillons'))).toBe(true);
    expect(existsSync(join(base, 'mon-compte', 'qg', 'CLAUDE.md'))).toBe(false);
  });
  it('aucun lot : l\'index dit de s\'arrêter', () => {
    const base = dossierPaul();
    ecrireLisible({ lot: null }, base);
    expect(readFileSync(join(base, 'index.md'), 'utf8')).toContain('rien à documenter. Arrête-toi.');
  });
  it('un README coupé ou avec des lignes trop longues : dit de ne pas le réécrire', () => {
    const base = dossierPaul();
    const l = lotExemple();
    l.lot.projets[0].readme = { present: true, sha: 's', contenu: 'x'.repeat(2000) + '\n', enPartie: true };
    ecrireLisible(l, base);
    const index = readFileSync(join(base, 'index.md'), 'utf8');
    expect(index).toContain('LU EN PARTIE');
    expect(index).toContain('trop longue(s)');
  });
  it('refuse un dossier qui ne s\'appelle pas « paul »', () => {
    expect(() => viderDossier('/tmp')).toThrow(/paul/);
  });
});

describe('preparerRapport', () => {
  it('recopie les brouillons dans contenu (README) ou bloc (CLAUDE.md), reprend les bases du lot', () => {
    const base = dossierPaul();
    ecrireLisible(lotExemple(), base);
    const b = join(base, 'brouillons', 'mon-compte', 'qg');
    mkdirSync(b, { recursive: true });
    writeFileSync(join(b, 'README.md'), '# QG\n\nUne page, et Paul.\n');
    writeFileSync(join(b, 'CLAUDE-bloc.md'), '## Où on s\'est arrêté\n- Paul');
    const r = preparerRapport({
      lot: 'lot-7', projets: [{ depot: 'mon-compte/qg', propositions: [
        { fichier: 'README.md', texte: join(b, 'README.md'), raisons: [] },
        { fichier: 'CLAUDE.md', texte: join(b, 'CLAUDE-bloc.md'), raisons: [] },
      ] }],
    }, base);
    const [readme, claude] = r.projets[0].propositions;
    expect(readme).toEqual({ fichier: 'README.md', contenu: '# QG\n\nUne page, et Paul.\n', base: 'r'.repeat(40), raisons: [] });
    expect(claude).toEqual({ fichier: 'CLAUDE.md', bloc: '## Où on s\'est arrêté\n- Paul', base: null, raisons: [] });
  });
  it('seulement des brouillons de /tmp/paul/brouillons, chemins réels (aucun lien symbolique qui s\'échappe)', () => {
    const base = dossierPaul();
    ecrireLisible(lotExemple(), base);
    const ailleurs = join(base, 'mon-compte', 'qg', 'README.md'); // dans le dossier de Paul, mais pas un brouillon
    expect(() => preparerRapport({ projets: [{ depot: 'mon-compte/qg', propositions: [{ fichier: 'README.md', texte: ailleurs }] }] }, base)).toThrow(/brouillon refusé/);
    const lien = join(base, 'brouillons', 'lien.md');
    const dehors = join(mkdtempSync(join(tmpdir(), 'dehors-')), 'secret.txt');
    writeFileSync(dehors, 'secret');
    symlinkSync(dehors, lien);
    expect(() => preparerRapport({ projets: [{ depot: 'mon-compte/qg', propositions: [{ fichier: 'README.md', texte: lien }] }] }, base)).toThrow(/brouillon refusé/);
  });
  it('un README où le QG a masqué une clé : l\'index dit de ne pas le réécrire', () => {
    const base = dossierPaul();
    const l = lotExemple();
    l.lot.projets[0].readme.masque = true;
    ecrireLisible(l, base);
    expect(readFileSync(join(base, 'index.md'), 'utf8')).toContain('CLÉ MASQUÉE');
  });
  it('refuse un brouillon hors du dossier de Paul', () => {
    const base = dossierPaul();
    ecrireLisible(lotExemple(), base);
    expect(() => preparerRapport({ projets: [{ depot: 'mon-compte/qg', propositions: [{ fichier: 'README.md', texte: '/etc/hosts' }] }] }, base)).toThrow(/brouillon refusé/);
    expect(() => preparerRapport({ projets: [{ depot: 'mon-compte/qg', propositions: [{ fichier: 'README.md', texte: `${base}/../x` }] }] }, base)).toThrow(/brouillon refusé/);
  });
});
