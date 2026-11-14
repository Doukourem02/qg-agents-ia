import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { construireRequete } from './regles.mjs';

describe('construireRequete', () => {
  it('GET sur /api/agents/regles, sans laissez-passer si QG_BYPASS absent', () => {
    const { url, init } = construireRequete({});
    expect(url).toBe('https://mon-qg.vercel.app/api/agents/regles');
    expect(init).toEqual({ method: 'GET', headers: {}, redirect: 'manual' });
  });
  it('ajoute l\'en-tête si QG_BYPASS présent, et respecte QG_URL', () => {
    const { url, init } = construireRequete({ QG_BYPASS: 'x', QG_URL: 'http://localhost:1/' });
    expect(url).toBe('http://localhost:1/api/agents/regles');
    expect(init.headers['x-vercel-protection-bypass']).toBe('x');
    expect(init.body).toBeUndefined();
  });
});

describe('CLI contre un faux serveur', { timeout: 20_000 }, () => {
  const lancer = (args, port) => new Promise(res => execFile('node', [fileURLToPath(new URL('./regles.mjs', import.meta.url)), ...args],
    { env: { ...process.env, QG_URL: `http://localhost:${port}`, QG_BYPASS: 'essai' } }, (err, out, errTxt) => res({ code: err ? err.code : 0, out, errTxt })));
  const serveur = (statut, corps, entetes = { 'content-type': 'application/json' }) => new Promise(res => {
    const recus = [];
    const s = http.createServer((q, r) => { recus.push({ method: q.method, url: q.url, passe: q.headers['x-vercel-protection-bypass'] }); r.writeHead(statut, entetes); r.end(corps === undefined ? '' : JSON.stringify(corps)); });
    s.listen(0, () => res(Object.assign(s, { recus })));
  });
  it('affiche les règles et sort 0', async () => {
    const s = await serveur(200, { regles: ['Toujours en français.'] });
    const r = await lancer([], s.address().port); s.close();
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ regles: ['Toujours en français.'] });
    expect(s.recus[0]).toEqual({ method: 'GET', url: '/api/agents/regles', passe: 'essai' });
  });
  it('sort 1 avec un message clair sur un 401 ou un 302', async () => {
    const s = await serveur(401, { erreur: 'clé invalide' });
    const r = await lancer([], s.address().port); s.close();
    expect(r.code).toBe(1); expect(r.errTxt).toMatch(/laissez-passer/);
    const s2 = await serveur(302, undefined, { location: '/x' });
    const r2 = await lancer([], s2.address().port); s2.close();
    expect(r2.code).toBe(1); expect(r2.errTxt).toMatch(/protection Vercel/);
  });
  it('refuse une commande inconnue', async () => {
    const r = await lancer(['ecrire'], 1);
    expect(r.code).toBe(1); expect(r.errTxt).toMatch(/usage/);
  });
});

describe('les agents qui écrivent lisent mes règles en premier', () => {
  for (const nom of ['L', 'Light', 'Clara', 'Mafe']) {
    it(`${nom} : la section vient juste après le titre de ses consignes`, () => {
      const c = readFileSync(fileURLToPath(new URL(`../agents/${nom}/CONSIGNES.md`, import.meta.url)), 'utf8');
      const sections = c.split('\n## ');
      expect(sections[1]).toMatch(/^Avant tout : les règles du patron/);
      expect(sections[1]).toContain('`NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1 node scripts/regles.mjs`');
      expect(sections[1]).toContain('sauf les interdits (secrets, rien sans accord)');
    });
  }
});
