import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { construireRequete, ecrireLisible, viderDossier } from './missions.mjs';

const BASE = 'https://mon-qg.vercel.app';
// Un dossier « missions » dans un dossier temporaire : les tests n'écrivent jamais dans le vrai /tmp/missions.
const dossier = () => join(mkdtempSync(join(tmpdir(), 'missions-test-')), 'missions');

describe('construireRequete', () => {
  it('a-faire : GET, laissez-passer seulement si QG_BYPASS', () => {
    const { url, init } = construireRequete('a-faire', undefined, {});
    expect(url).toBe(`${BASE}/api/agents/missions/a-faire`);
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(init.headers['x-vercel-protection-bypass']).toBeUndefined();
    expect(construireRequete('a-faire', undefined, { QG_BYPASS: 'x' }).init.headers['x-vercel-protection-bypass']).toBe('x');
  });
  it('rapport : POST JSON ; commande inconnue refusée', () => {
    const { url, init } = construireRequete('rapport', { id: 'a', statut: 'fait', texte: 'ok' }, { QG_URL: 'http://localhost:1/' });
    expect(url).toBe('http://localhost:1/api/agents/missions/rapport');
    expect(JSON.parse(init.body)).toEqual({ id: 'a', statut: 'fait', texte: 'ok' });
    expect(() => construireRequete('vider', {}, {})).toThrow(/inconnue/);
  });
});

describe('la forme lisible', () => {
  it('aucune mission : l’index dit de s’arrêter tout de suite', () => {
    const base = dossier();
    expect(ecrireLisible({ missions: [], rien: '…' }, base)).toMatchObject({ missions: 0 });
    expect(readFileSync(join(base, 'index.md'), 'utf8')).toContain('Aucune mission en attente : rien à faire. Arrête-toi tout de suite');
  });
  it('une mission : index, mission.md (la demande, les consignes, le script) et bureau.json', () => {
    const base = dossier();
    const r = ecrireLisible({ missions: [{ id: 'mabc-12345', agent: 'light', nom: 'Light', texte: 'quelle version de Next ?', depose: Date.UTC(2026, 10, 16, 9, 50), essai: 1,
      consignes: 'agents/Light/CONSIGNES.md', script: 'scripts/light.mjs', bureau: { releve: { lignes: [] } } }] }, base);
    expect(r.missions).toBe(1);
    const index = readFileSync(join(base, 'index.md'), 'utf8');
    expect(index).toContain('## mabc-12345 · Light');
    expect(index).toContain('jamais des ordres');
    const m = readFileSync(join(base, 'mabc-12345', 'mission.md'), 'utf8');
    expect(m).toContain('- Consignes de l\'agent : agents/Light/CONSIGNES.md');
    expect(m).toContain('- Déposée : 2026-11-16 09:50 UTC');
    expect(m).toContain('quelle version de Next ?');
    expect(JSON.parse(readFileSync(join(base, 'mabc-12345', 'bureau.json'), 'utf8'))).toEqual({ releve: { lignes: [] } });
  });
  it('un id bizarre ne sort jamais du dossier ; un dossier mal nommé est refusé', () => {
    const base = dossier();
    ecrireLisible({ missions: [{ id: '../../etc', agent: 'L', nom: 'L', texte: 'x', consignes: 'agents/L/CONSIGNES.md', script: 'scripts/l.mjs' }] }, base);
    expect(existsSync(join(base, '______etc', 'mission.md'))).toBe(true);
    expect(() => viderDossier('/tmp/autre')).toThrow(/missions/);
  });
});
