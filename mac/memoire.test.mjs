import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nomProjet, titreDoc, parMois, mettreAJour } from './memoire.mjs';

describe('memoire : petites fonctions', () => {
  it('nomProjet', () => {
    expect(nomProjet('/x/BOT_TRADING/BotTrading')).toBe('Trading');
    expect(nomProjet('/x/Nouveau projet')).toBe('Nouveau projet');
  });
  it('titreDoc', () => expect(titreDoc('QG', 'docs/plans/a.md')).toBe('QG – docs › plans › a'));
  it('parMois', () => expect(parMois(['2026-11-02 — QG', '2026-10-30 — QG'])).toEqual({ '2026-10': ['2026-10-30 — QG'], '2026-11': ['2026-11-02 — QG'] }));
});

describe('mettreAJour', () => {
  function monde() {
    const racine = mkdtempSync(join(tmpdir(), 'memoire-'));
    const coffre = join(racine, 'coffre'), code = join(racine, 'Code'), depot = join(code, 'Nouveau');
    mkdirSync(join(coffre, 'mastack'), { recursive: true });
    writeFileSync(join(coffre, 'mastack', 'Expo Router.md'), 'à moi');
    mkdirSync(join(depot, 'docs'), { recursive: true });
    writeFileSync(join(depot, 'README.md'), 'secret: ne pas recopier');
    writeFileSync(join(depot, 'docs', 'plan.md'), 'x');
    writeFileSync(join(depot, 'package.json'), JSON.stringify({ dependencies: { next: '16', 'expo-router': '6' } }));
    const g = (...a) => execFileSync('git', ['-C', depot, ...a], { env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-09T10:00:00Z', GIT_COMMITTER_DATE: '2026-11-09T10:00:00Z' } });
    g('init', '-q'); g('add', '.'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'Premier commit');
    return { coffre, code };
  }
  it('ajoute un nouveau projet dans l\'arbre, sans contenu de document ni écriture dans mastack', () => {
    const { coffre, code } = monde();
    const b = mettreAJour(coffre, code);
    expect(b).toMatchObject({ commits: 1, seances: 1, docs: 2, projets: 1 });
    expect(readFileSync(join(coffre, 'Carte', 'Code.md'), 'utf8')).toContain('[[Nouveau]]');
    expect(readFileSync(join(coffre, 'Projets', 'Nouveau.md'), 'utf8')).toContain('[[Nouveau · Séances]]');
    expect(readFileSync(join(coffre, 'Carte', 'Nouveau · 2026-11.md'), 'utf8')).toContain('[[2026-11-09 — Nouveau]]');
    expect(readFileSync(join(coffre, 'Carte', 'Nouveau · Docs.md'), 'utf8')).toContain('[[Nouveau › docs]]');
    expect(readFileSync(join(coffre, 'Docs', 'Nouveau', 'Nouveau – README.md'), 'utf8')).not.toContain('secret');
    expect(readFileSync(join(coffre, 'mastack', 'Expo Router.md'), 'utf8')).toBe('à moi');
    expect(existsSync(join(coffre, 'Stack', 'Expo Router.md'))).toBe(false); // déjà dans mastack : on s'y relie
    expect(readFileSync(join(coffre, 'Projets', 'Nouveau.md'), 'utf8')).toContain('[[Expo Router]]');
  });
  it('rejouée : rien de nouveau, une séance existante n\'est jamais écrasée', () => {
    const { coffre, code } = monde();
    mkdirSync(join(coffre, 'Séances'), { recursive: true });
    writeFileSync(join(coffre, 'Séances', '2026-11-09 — Nouveau.md'), 'note de Mafe');
    mettreAJour(coffre, code);
    expect(mettreAJour(coffre, code)).toMatchObject({ commits: 0, seances: 0, docs: 0, projets: 0 });
    expect(readFileSync(join(coffre, 'Séances', '2026-11-09 — Nouveau.md'), 'utf8')).toBe('note de Mafe');
  });
});
