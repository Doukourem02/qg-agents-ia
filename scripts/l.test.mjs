import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { construireRequete } from './l.mjs';

const BASE = 'https://mon-qg.vercel.app';

describe('construireRequete', () => {
  it('contexte : GET sans laissez-passer si QG_BYPASS absent', () => {
    const { url, init } = construireRequete('contexte', undefined, {});
    expect(url).toBe(`${BASE}/api/agents/l/contexte`);
    expect(init.method).toBe('GET');
    expect(init.headers['x-vercel-protection-bypass']).toBeUndefined();
    expect(init.redirect).toBe('manual');
  });
  it('contexte : ajoute l\'en-tête si QG_BYPASS présent, et respecte QG_URL', () => {
    const { url, init } = construireRequete('contexte', undefined, { QG_BYPASS: 'x', QG_URL: 'http://localhost:1/' });
    expect(url).toBe('http://localhost:1/api/agents/l/contexte');
    expect(init.headers['x-vercel-protection-bypass']).toBe('x');
  });
  it('brouillon : POST avec corps JSON', () => {
    const corps = { sujet: 's', texte: 't', hashtags: ['#a'] };
    const { url, init } = construireRequete('brouillon', corps, {});
    expect(url).toBe(`${BASE}/api/agents/l/brouillon`);
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(corps);
  });
  it('bilan : POST vers /bilan', () => {
    const { url, init } = construireRequete('bilan', { statsId: 'a' }, {});
    expect(url).toBe(`${BASE}/api/agents/l/bilan`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ statsId: 'a' });
  });
  it('question : POST vers /question', () => {
    const { url, init } = construireRequete('question', { texte: 'Je peux nommer ce projet ?' }, {});
    expect(url).toBe(`${BASE}/api/agents/l/question`);
    expect(init.method).toBe('POST');
  });
  it('apercu : POST du visuel vers /apercu', () => {
    const visuel = { modele: 'carte', rubrique: 'IA' };
    const { url, init } = construireRequete('apercu', visuel, {});
    expect(url).toBe(`${BASE}/api/agents/l/apercu`);
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(visuel);
  });
  it('refuse une commande inconnue', () => {
    expect(() => construireRequete('zzz', {}, {})).toThrow(/inconnue/);
  });
});

describe('CLI contre un faux serveur', () => {
  const lancer = (args, port) => new Promise(res => execFile('node', [fileURLToPath(new URL('./l.mjs', import.meta.url)), ...args],
    { env: { ...process.env, QG_URL: `http://localhost:${port}` } }, (err, out, errTxt) => res({ code: err ? err.code : 0, out, errTxt })));
  const serveur = (statut, corps) => new Promise(res => {
    const s = http.createServer((_, r) => { r.writeHead(statut, { 'content-type': 'application/json' }); r.end(JSON.stringify(corps)); });
    s.listen(0, () => res(s));
  });
  it('affiche le JSON et sort 0', async () => {
    const s = await serveur(200, { ok: true });
    const r = await lancer(['contexte'], s.address().port); s.close();
    expect(r.code).toBe(0); expect(JSON.parse(r.out)).toEqual({ ok: true });
  });
  it('sort 1 avec le texte de erreur sur un 422', async () => {
    const s = await serveur(422, { erreur: 'projet interdit' });
    const f = join(mkdtempSync(join(tmpdir(), 'l-')), 'b.json'); writeFileSync(f, '{}');
    const r = await lancer(['brouillon', f], s.address().port); s.close();
    expect(r.code).toBe(1); expect(r.errTxt).toContain('projet interdit');
  });
  it('apercu : écrit l’image reçue dans le fichier de sortie', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
    const s = http.createServer((_, r) => { r.writeHead(200, { 'content-type': 'image/png' }); r.end(png); });
    await new Promise(r => s.listen(0, r));
    const dossier = mkdtempSync(join(tmpdir(), 'l-'));
    const f = join(dossier, 'v.json'); writeFileSync(f, '{"modele":"carte"}');
    const sortie = join(dossier, 'v.png');
    const r = await lancer(['apercu', f, sortie], s.address().port); s.close();
    expect(r.code).toBe(0);
    expect(readFileSync(sortie)).toEqual(png);
  });
  it('apercu sans fichier de sortie : sort 1 avec l’usage', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'l-')), 'v.json'); writeFileSync(f, '{}');
    const r = await lancer(['apercu', f], 1);
    expect(r.code).toBe(1); expect(r.errTxt).toMatch(/sortie\.png/);
  });
  it('sort 1 avec un message clair sur un 302', async () => {
    const s = http.createServer((_, r) => { r.writeHead(302, { location: '/x' }); r.end(); });
    await new Promise(r => s.listen(0, r));
    const r = await lancer(['contexte'], s.address().port); s.close();
    expect(r.code).toBe(1); expect(r.errTxt).toMatch(/protection Vercel/);
  });
});
