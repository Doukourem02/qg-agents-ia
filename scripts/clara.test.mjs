import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { construireRequete } from './clara.mjs';

const BASE = 'https://mon-qg.vercel.app';

describe('construireRequete', () => {
  it('stats : GET sans laissez-passer si QG_BYPASS absent', () => {
    const { url, init } = construireRequete('stats', undefined, {});
    expect(url).toBe(`${BASE}/api/agents/clara/stats`);
    expect(init.method).toBe('GET');
    expect(init.headers['x-vercel-protection-bypass']).toBeUndefined();
    expect(init.redirect).toBe('manual');
  });
  it('stats : ajoute l\'en-tête si QG_BYPASS présent, et respecte QG_URL', () => {
    const { url, init } = construireRequete('stats', undefined, { QG_BYPASS: 'x', QG_URL: 'http://localhost:1/' });
    expect(url).toBe('http://localhost:1/api/agents/clara/stats');
    expect(init.headers['x-vercel-protection-bypass']).toBe('x');
  });
  it('proposer : POST avec corps JSON', () => {
    const corps = { ids: ['abc12345'] };
    const { url, init } = construireRequete('proposer', corps, {});
    expect(url).toBe(`${BASE}/api/agents/clara/proposer`);
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(corps);
  });
  it('bannis : POST d\'un corps vide', () => {
    const { url, init } = construireRequete('bannis', undefined, {});
    expect(url).toBe(`${BASE}/api/agents/clara/bannis`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({});
  });
  it('refuse une commande inconnue', () => {
    expect(() => construireRequete('zzz', {}, {})).toThrow(/inconnue/);
  });
});

describe('CLI contre un faux serveur', () => {
  const lancer = (args, port) => new Promise(res => execFile('node', [fileURLToPath(new URL('./clara.mjs', import.meta.url)), ...args],
    { env: { ...process.env, QG_URL: `http://localhost:${port}` } }, (err, out, errTxt) => res({ code: err ? err.code : 0, out, errTxt })));
  const serveur = (statut, corps) => new Promise(res => {
    const s = http.createServer((_, r) => { r.writeHead(statut, { 'content-type': 'application/json' }); r.end(JSON.stringify(corps)); });
    s.listen(0, () => res(s));
  });
  it('stats : affiche le JSON et sort 0', async () => {
    const s = await serveur(200, { ok: true });
    const r = await lancer(['stats'], s.address().port); s.close();
    expect(r.code).toBe(0); expect(JSON.parse(r.out)).toEqual({ ok: true });
  });
  it('bannis : sort 0', async () => {
    const s = await serveur(200, { deplaces: 0 });
    const r = await lancer(['bannis'], s.address().port); s.close();
    expect(r.code).toBe(0);
  });
  it('proposer : sort 1 avec le texte de l\'erreur sur un 422', async () => {
    const s = await serveur(422, { erreur: 'expéditeur refusé' });
    const f = join(mkdtempSync(join(tmpdir(), 'clara-')), 'proposer.json'); writeFileSync(f, '{}');
    const r = await lancer(['proposer', f], s.address().port); s.close();
    expect(r.code).toBe(1); expect(r.errTxt).toContain('expéditeur refusé');
  });
  it('proposer sans fichier : sort 1', async () => {
    const r = await lancer(['proposer'], 1);
    expect(r.code).toBe(1); expect(r.errTxt).toMatch(/fichier JSON/);
  });
  it('sort 1 avec un message clair sur un 302', async () => {
    const s = http.createServer((_, r) => { r.writeHead(302, { location: '/x' }); r.end(); });
    await new Promise(r => s.listen(0, r));
    const r = await lancer(['stats'], s.address().port); s.close();
    expect(r.code).toBe(1); expect(r.errTxt).toMatch(/protection Vercel/);
  });
});
