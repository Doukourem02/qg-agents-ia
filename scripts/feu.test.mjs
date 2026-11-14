import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { construireRequete, ecrireLisible, viderDossier } from './feu.mjs';

// Un dossier « feu » dans un dossier temporaire : les tests n'écrivent jamais dans le vrai /tmp/feu.
const dossierFeu = () => join(mkdtempSync(join(tmpdir(), 'feu-test-')), 'feu');
const T = Date.UTC(2026, 10, 13, 7, 55);
const lot = () => ({
  lot: {
    id: 'feu-abc', quand: T, creneau: Date.UTC(2026, 10, 13, 8), lu: T,
    statuts: [{
      paire: 'BTCUSDT', statut: 'Hypothèse', prix: 71591, lu: T, structure4h: 'range', structure1h: 'range', rsi15: 43,
      conditions: { contexte: { ok: false, detail: 'il faut une clôture 1h au-dessus de 74 810' }, zone: { ok: true, detail: 'prix dans la zone' }, declencheur: { ok: false, detail: 'pas encore de rejet' } },
      manque: 'le contexte 4h/1h', zone: { bas: 71250, haut: 71500, nom: 'support' }, objectif: 72200, ratio: 0.9, rate: false, plan: null,
    }],
    bougies: { BTCUSDT: { '1h': [['2026-11-13T06:00', 71500, 71700, 71400, 71600, 300]] } },
    niveaux: { BTCUSDT: { supports: [{ bas: 71250, haut: 71500 }], resistances: [{ bas: 72200, haut: 72730 }], surveilles: [{ prix: 72730, sens: 'haut' }], contexte: { prix: 74810 } } },
    capital: { montant: 8.5, source: 'declare', quand: 0 }, regime: 'apprentissage', compte: { cle: 'absente', quand: T },
    journal: { operations: 0, gagnantes: 0, perdantes: 0, net: 0, frais: 0, semaine: 0 }, positions: [], pause: null,
    interdit: 'fenêtre macro : PPI américain', points: ['Les 8,50 USDT déclarés ne sont pas visibles dans le Spot'],
    annonces: [{ quand: Date.UTC(2026, 10, 13, 13, 30), nom: 'PPI américain', source: 'bloc de reprise' }],
    questions: [{ id: 'q1', texte: 'où sont mes USDT ?' }],
  },
});

describe('scripts/feu.mjs', () => {
  it('construireRequete : a-analyser en GET, rapport en POST, aucune autre commande', () => {
    expect(construireRequete('a-analyser', undefined, {}).url).toBe('https://mon-qg.vercel.app/api/agents/feu/a-analyser');
    expect(construireRequete('a-analyser', undefined, {}).init.method).toBe('GET');
    const r = construireRequete('rapport', { lot: 'l' }, { QG_URL: 'http://localhost:3000/', QG_BYPASS: 'b' });
    expect(r.url).toBe('http://localhost:3000/api/agents/feu/rapport');
    expect(r.init).toMatchObject({ method: 'POST', headers: { 'x-vercel-protection-bypass': 'b' } });
    for (const c of ['marche', 'compte', 'order']) expect(() => construireRequete(c, {}, {})).toThrow(/inconnue/);
  });
  it('la forme lisible : statuts du code, conditions, bougies, niveaux, compte, calendrier, questions', () => {
    const base = dossierFeu();
    expect(ecrireLisible(lot(), base)).toMatchObject({ lot: 'feu-abc' });
    const index = readFileSync(join(base, 'index.md'), 'utf8');
    expect(index).toContain('Recopie `feu-abc`');
    expect(index).toContain('### BTC/USDT : Hypothèse — prix lu 71591 à 2026-11-13 07:55 UTC');
    expect(index).toContain('contexte : non — il faut une clôture 1h au-dessus de 74 810');
    expect(index).toContain('2026-11-13T06:00 · 71500 · 71700 · 71400 · 71600 · 300');
    expect(index).toContain('pas encore créée');
    expect(index).toContain('Aucune entrée maintenant : fenêtre macro');
    expect(index).toContain('2026-11-13 13:30 UTC · PPI américain');
    expect(index).toContain('`q1` : où sont mes USDT ?');
    expect(existsSync(join(base, 'lot.json'))).toBe(true);
  });
  it('sans lot : « Aucun lot » ; un dossier qui ne s\'appelle pas « feu » est refusé', () => {
    const base = dossierFeu();
    expect(ecrireLisible({}, base)).toEqual({ index: join(base, 'index.md'), lot: null });
    expect(() => viderDossier('/tmp/autre')).toThrow(/refusé/);
  });
});
