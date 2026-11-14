import { describe, it, expect } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { construireRequete } from './mafe.mjs';

const BASE = 'https://mon-qg.vercel.app';

describe('construireRequete', () => {
  for (const c of ['releve', 'a-copier']) {
    it(`${c} : GET sans laissez-passer si QG_BYPASS absent`, () => {
      const { url, init } = construireRequete(c, undefined, {});
      expect(url).toBe(`${BASE}/api/agents/mafe/${c}`);
      expect(init.method).toBe('GET');
      expect(init.headers['x-vercel-protection-bypass']).toBeUndefined();
      expect(init.redirect).toBe('manual');
    });
  }
  it('ajoute l\'en-tête si QG_BYPASS présent, et respecte QG_URL', () => {
    const { url, init } = construireRequete('releve', undefined, { QG_BYPASS: 'x', QG_URL: 'http://localhost:1/' });
    expect(url).toBe('http://localhost:1/api/agents/mafe/releve');
    expect(init.headers['x-vercel-protection-bypass']).toBe('x');
  });
  for (const c of ['point', 'envoyer', 'note', 'notion', 'rafraichir', 'copie']) {
    it(`${c} : POST avec corps JSON`, () => {
      const corps = { a: 1 };
      const { url, init } = construireRequete(c, corps, { QG_BYPASS: 'y' });
      expect(url).toBe(`${BASE}/api/agents/mafe/${c}`);
      expect(init.method).toBe('POST');
      expect(init.headers['content-type']).toBe('application/json');
      expect(init.headers['x-vercel-protection-bypass']).toBe('y');
      expect(JSON.parse(init.body)).toEqual(corps);
    });
  }
  it('refuse une commande inconnue', () => {
    expect(() => construireRequete('zzz', {}, {})).toThrow(/inconnue/);
  });
});

/** Un port local où personne n'écoute : on l'ouvre sur 0 puis on le referme. */
const portFerme = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });

describe('CLI contre un faux serveur', { timeout: 20_000 }, () => {
  const lancer = (args, port) => new Promise(res => execFile('node', [fileURLToPath(new URL('./mafe.mjs', import.meta.url)), ...args],
    { env: { ...process.env, QG_URL: `http://localhost:${port}` } }, (err, out, errTxt) => res({ code: err ? err.code : 0, out, errTxt })));
  const serveur = (statut, corps) => new Promise(res => {
    const recus = [];
    const s = http.createServer((q, r) => {
      let b = ''; q.on('data', d => { b += d; });
      q.on('end', () => { recus.push({ method: q.method, url: q.url, body: b }); r.writeHead(statut, { 'content-type': 'application/json' }); r.end(JSON.stringify(corps)); });
    });
    s.listen(0, () => res(Object.assign(s, { recus })));
  });
  const fichier = (contenu) => { const f = join(mkdtempSync(join(tmpdir(), 'mafe-')), 'c.json'); writeFileSync(f, contenu); return f; };
  it('releve : affiche le JSON et sort 0', async () => {
    const s = await serveur(200, { ok: true });
    const r = await lancer(['releve'], s.address().port); s.close();
    expect(r.code).toBe(0); expect(JSON.parse(r.out)).toEqual({ ok: true });
  });
  it('point : envoie le fichier en POST', async () => {
    const s = await serveur(200, { ok: true });
    const r = await lancer(['point', fichier('{"phrase":"x"}')], s.address().port); s.close();
    expect(r.code).toBe(0);
    expect(s.recus[0]).toMatchObject({ method: 'POST', url: '/api/agents/mafe/point', body: '{"phrase":"x"}' });
  });
  it('envoyer : sort 1 avec le texte de l\'erreur sur un 409', async () => {
    const s = await serveur(409, { erreur: 'pas aujourd\'hui' });
    const r = await lancer(['envoyer', fichier('{}')], s.address().port); s.close();
    expect(r.code).toBe(1); expect(r.errTxt).toContain('pas aujourd\'hui');
  });
  it('note sans fichier : sort 1', async () => {
    const r = await lancer(['note'], await portFerme());
    expect(r.code).toBe(1); expect(r.errTxt).toMatch(/fichier JSON/);
  });
  it('sort 1 avec un message clair sur un 302', async () => {
    const s = http.createServer((_, r) => { r.writeHead(302, { location: '/x' }); r.end(); });
    await new Promise(r => s.listen(0, r));
    const r = await lancer(['releve'], s.address().port); s.close();
    expect(r.code).toBe(1); expect(r.errTxt).toMatch(/protection Vercel/);
  });
});
