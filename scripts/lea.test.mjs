import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { construireRequete, ecrireLisible, nomDiff } from './lea.mjs';
import { validerRapport } from '../src/server/lea/rapport';

const BASE = 'https://mon-qg.vercel.app';

describe('construireRequete', () => {
  it('a-relire : GET sans laissez-passer si QG_BYPASS absent', () => {
    const { url, init } = construireRequete('a-relire', undefined, {});
    expect(url).toBe(`${BASE}/api/agents/lea/a-relire`);
    expect(init.method).toBe('GET');
    expect(init.headers['x-vercel-protection-bypass']).toBeUndefined();
    expect(init.redirect).toBe('manual');
  });
  it('a-relire : ajoute l\'en-tête si QG_BYPASS présent, et respecte QG_URL', () => {
    const { url, init } = construireRequete('a-relire', undefined, { QG_BYPASS: 'x', QG_URL: 'http://localhost:1/' });
    expect(url).toBe('http://localhost:1/api/agents/lea/a-relire');
    expect(init.headers['x-vercel-protection-bypass']).toBe('x');
  });
  it('rapport : POST avec corps JSON', () => {
    const corps = { lot: 'abc', projets: [], constats: [] };
    const { url, init } = construireRequete('rapport', corps, {});
    expect(url).toBe(`${BASE}/api/agents/lea/rapport`);
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(corps);
  });
  it('refuse une commande inconnue', () => {
    expect(() => construireRequete('zzz', {}, {})).toThrow(/inconnue/);
    expect(() => construireRequete('releve', {}, {})).toThrow(/inconnue/);
  });
});

const serveur = (statut, corps) => new Promise(res => {
  const s = http.createServer((_, r) => { r.writeHead(statut, { 'content-type': 'application/json' }); r.end(JSON.stringify(corps)); });
  s.listen(0, () => res(s));
});
// Un dossier « lea » dans un dossier temporaire : les tests n'écrivent jamais dans le vrai /tmp/lea.
const dossierLea = () => join(mkdtempSync(join(tmpdir(), 'lea-test-')), 'lea');
const MASQUE = '[clé GitHub masquée]';
const lotExemple = () => ({
  lot: {
    id: 'lot-42', quand: 0,
    projets: [
      {
        depot: 'mon-compte/qg', depuis: 'f'.repeat(40),
        commits: [
          {
            sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', message: 'ajoute la route', date: Date.UTC(2026, 10, 11, 9, 5),
            fichiers: [
              { chemin: 'src/app/api/agents/lea/[action]/route.ts', statut: 'modified', patch: `@@ -1,2 +1,3 @@\n import x;\n-const a = 1;\n+const a = 2;\n+const k = '${MASQUE}';` },
              { chemin: '.env', statut: 'added', enPartie: 'non fourni', note: 'fichier .env : jamais envoyé (le serveur y a cherché les clés)' },
              { chemin: 'src/long.ts', statut: 'added', patch: '@@ -0,0 +1,1 @@\n+' + 'x'.repeat(2500) },
            ],
          },
          { sha: 'b'.repeat(40), message: 'images', date: Date.UTC(2026, 10, 11, 9, 30), fichiers: [], rienACoder: true },
        ],
      },
      {
        depot: 'mon-compte/app_livraison', depuis: 'e'.repeat(40), reecrit: true,
        commits: [{ sha: 'c'.repeat(40), message: 'corrige', date: Date.UTC(2026, 10, 11, 9, 40), fichiers: [
          { chemin: 'src/a.ts', statut: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' },
          { chemin: '…', enPartie: 'non fourni', note: 'liste des fichiers coupée par GitHub (plus de 300)' },
        ] }],
      },
    ],
  },
});

describe('la forme lisible du lot (/tmp/lea)', () => {
  it('index.md : le lot, chaque projet, chaque commit dans l\'ordre, chaque fichier avec sa différence ou sa note', () => {
    const base = dossierLea();
    const r = ecrireLisible(lotExemple(), base);
    const index = readFileSync(join(base, 'index.md'), 'utf8');
    expect(r).toEqual({ index: join(base, 'index.md'), projets: 2, diffs: 3 });
    expect(index).toContain('lot-42');
    expect(index.indexOf('mon-compte/qg')).toBeLessThan(index.indexOf('mon-compte/app_livraison'));
    expect(index.indexOf('a1b2c3d ')).toBeLessThan(index.indexOf('bbbbbbb '));
    expect(index).toContain('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'); // le sha entier, pour « jusqua »
    expect(index).toContain('ajoute la route');
    expect(index).toContain('2026-11-11 09:05 UTC');
    expect(index).toContain('rien de code à relire');
    expect(index).toContain('historique réécrit');
    const diff = join(base, 'mon-compte', 'qg', 'a1b2c3d', 'src__app__api__agents__lea__[action]__route.ts.diff');
    expect(index).toContain(`\`src/app/api/agents/lea/[action]/route.ts\` (modified, 6 lignes dans le fichier) → ${diff}`);
    expect(index).toMatch(/`\.env` \(added\) : pas envoyé, ne dis rien dessus — fichier \.env : jamais envoyé/);
    expect(index).toContain('liste coupée par GitHub');
  });

  it('un fichier .diff par différence, avec de vrais retours à la ligne et une ligne d\'en-tête', () => {
    const base = dossierLea();
    ecrireLisible(lotExemple(), base);
    const diff = readFileSync(join(base, 'mon-compte', 'qg', 'a1b2c3d', 'src__app__api__agents__lea__[action]__route.ts.diff'), 'utf8');
    expect(diff.split('\n')).toEqual([
      '### mon-compte/qg · a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 · src/app/api/agents/lea/[action]/route.ts',
      '       @@ -1,2 +1,3 @@', '     1  import x;', '       -const a = 1;', '     2 +const a = 2;', `     3 +const k = '${MASQUE}';`,
    ]);
    expect(readdirSync(join(base, 'mon-compte', 'app_livraison', 'ccccccc'))).toEqual(['src__a.ts.diff']);
    expect(readdirSync(join(base, 'mon-compte', 'qg', 'a1b2c3d')).sort()).toEqual(['src__app__api__agents__lea__[action]__route.ts.diff', 'src__long.ts.diff']);
  });

  it('une ligne trop longue est coupée pour la lecture, la suite marquée « »» »', () => {
    const base = dossierLea();
    ecrireLisible(lotExemple(), base);
    const lignes = readFileSync(join(base, 'mon-compte', 'qg', 'a1b2c3d', 'src__long.ts.diff'), 'utf8').split('\n');
    expect(lignes.every(l => l.length <= 1010)).toBe(true);
    expect(lignes[1]).toBe('       @@ -0,0 +1,1 @@');
    expect(lignes).toHaveLength(5); // en-tête, bloc, puis 2 501 caractères en 3 morceaux
    expect(lignes[2].startsWith('     1 +x')).toBe(true);
    expect(lignes.slice(3).every(l => l.startsWith('       »» '))).toBe(true); // une suite n'a pas de numéro
    expect(lignes.slice(2).map(l => l.slice(7).replace(/^»» /, '')).join('')).toBe('+' + 'x'.repeat(2500));
  });

  it('chaque ligne ajoutée ou de contexte porte son vrai numéro dans le nouveau fichier', () => {
    const base = dossierLea();
    const patch = ['@@ -1,3 +40,5 @@', ' avant', '-retiree', '+ajoutee', '+' + 'y'.repeat(1500), ' apres', '\\ No newline at end of file', '@@ -90,1 +100,1 @@', '+loin'].join('\n');
    ecrireLisible({ lot: { id: 'l', quand: 0, projets: [{ depot: 'mon-compte/qg', depuis: 'x', commits: [{ sha: 'd'.repeat(40), message: 'm', date: 0, fichiers: [{ chemin: 'src/n.ts', patch }] }] }] } }, base);
    const lignes = readFileSync(join(base, 'mon-compte', 'qg', 'ddddddd', 'src__n.ts.diff'), 'utf8').split('\n');
    expect(lignes.slice(1)).toEqual([
      '       @@ -1,3 +40,5 @@', '    40  avant', '       -retiree', '    41 +ajoutee', '    42 +' + 'y'.repeat(999), '       »» ' + 'y'.repeat(501),
      '    43  apres', '       \\ No newline at end of file', '       @@ -90,1 +100,1 @@', '   100 +loin',
    ]);
    const index = readFileSync(join(base, 'index.md'), 'utf8');
    expect(index).toContain('- `src/n.ts` (11 lignes dans le fichier) → '); // sans statut : pas de « (, »
    expect(index).toMatch(/Lis ce fichier en entier \(par morceaux avec offset\/limit s'il est long\)/);
  });

  it('un secret masqué reste masqué ; rien d\'autre n\'est écrit', () => {
    const base = dossierLea();
    ecrireLisible(lotExemple(), base);
    const tout = readdirSync(base, { recursive: true }).filter(f => String(f).endsWith('.diff') || String(f).endsWith('.md'))
      .map(f => readFileSync(join(base, String(f)), 'utf8')).join('\n');
    expect(tout).toContain(MASQUE);
    expect(tout).not.toMatch(/ghp_/);
  });

  it('le dossier est vidé avant d\'écrire ; sans lot, l\'index le dit', () => {
    const base = dossierLea();
    mkdirSync(join(base, 'vieux'), { recursive: true });
    writeFileSync(join(base, 'vieux', 'reste.diff'), 'ancien');
    ecrireLisible({ lot: null, attente: true }, base);
    expect(existsSync(join(base, 'vieux'))).toBe(false);
    expect(readdirSync(base)).toEqual(['index.md']);
    expect(readFileSync(join(base, 'index.md'), 'utf8')).toMatch(/Aucun lot/);
  });

  it('refuse un dossier qui ne s\'appelle pas « lea » (jamais vider autre chose)', () => {
    expect(() => ecrireLisible({ lot: null }, mkdtempSync(join(tmpdir(), 'pas-lea-')))).toThrow(/lea/);
  });

  it('nomDiff : « / » devient « __ », jamais de chemin qui remonte', () => {
    expect(nomDiff('src/a/b.ts')).toBe('src__a__b.ts.diff');
    expect(nomDiff('../../etc/passwd')).toBe('..__..__etc__passwd.diff');
    expect(nomDiff('a\u0000b')).toBe('a_b.diff');
    expect(Buffer.byteLength(nomDiff('d/'.repeat(200) + 'f.ts'))).toBeLessThanOrEqual(200);
  });
});

describe('CLI contre un faux serveur', () => {
  const lancer = (args, port, dossier = dossierLea()) => new Promise(res => execFile('node', [fileURLToPath(new URL('./lea.mjs', import.meta.url)), ...args],
    { env: { ...process.env, QG_URL: `http://localhost:${port}`, LEA_DOSSIER: dossier } }, (err, out, errTxt) => res({ code: err ? err.code : 0, out, errTxt })));
  it('a-relire avec un lot : le JSON sur la sortie, la forme lisible dans le dossier', async () => {
    const s = await serveur(200, lotExemple());
    const dossier = dossierLea();
    const r = await lancer(['a-relire'], s.address().port, dossier); s.close();
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual(lotExemple());
    expect(readFileSync(join(dossier, 'index.md'), 'utf8')).toContain('lot-42');
    expect(r.errTxt).toContain(join(dossier, 'index.md'));
  });
  it('a-relire en échec : sort 1, aucun ancien index laissé', async () => {
    const s = await serveur(503, { erreur: 'GitHub ne répond pas' });
    const dossier = dossierLea();
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, 'index.md'), 'ancien lot');
    const r = await lancer(['a-relire'], s.address().port, dossier); s.close();
    expect(r.code).toBe(1);
    expect(existsSync(join(dossier, 'index.md'))).toBe(false);
  });
  const fichier = contenu => { const f = join(mkdtempSync(join(tmpdir(), 'lea-')), 'a.json'); writeFileSync(f, contenu); return f; };
  it('a-relire : affiche le JSON et sort 0', async () => {
    const s = await serveur(200, { lot: null });
    const r = await lancer(['a-relire'], s.address().port); s.close();
    expect(r.code).toBe(0); expect(JSON.parse(r.out)).toEqual({ lot: null });
  });
  it('rapport : sort 1 avec le texte de l\'erreur sur un 422', async () => {
    const s = await serveur(422, { erreur: 'fichier absent de ce commit dans le lot' });
    const r = await lancer(['rapport', fichier('{}')], s.address().port); s.close();
    expect(r.code).toBe(1); expect(r.errTxt).toContain('fichier absent');
  });
  it('rapport sans fichier : sort 1', async () => {
    const r = await lancer(['rapport'], 1);
    expect(r.code).toBe(1); expect(r.errTxt).toMatch(/fichier JSON/);
  });
  it('rapport avec un fichier illisible ou invalide : erreur claire', async () => {
    const r1 = await lancer(['rapport', '/tmp/lea-nexiste-pas.json'], 1);
    expect(r1.code).toBe(1); expect(r1.errTxt).toMatch(/illisible ou JSON invalide/);
    const r2 = await lancer(['rapport', fichier('{pas du json')], 1);
    expect(r2.code).toBe(1); expect(r2.errTxt).toMatch(/illisible ou JSON invalide/);
  });
  it('sort 1 avec un message clair sur un 302', async () => {
    const s = http.createServer((_, r) => { r.writeHead(302, { location: '/x' }); r.end(); });
    await new Promise(r => s.listen(0, r));
    const r = await lancer(['a-relire'], s.address().port); s.close();
    expect(r.code).toBe(1); expect(r.errTxt).toMatch(/protection Vercel/);
  });
});

describe('CONSIGNES.md et le serveur', () => {
  const texte = readFileSync(fileURLToPath(new URL('../agents/Lea/CONSIGNES.md', import.meta.url)), 'utf8');
  const blocs = [...texte.matchAll(/```json\n([\s\S]*?)```/g)].map(m => JSON.parse(m[1]));
  const sha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
  const lot = { id: 'lot-exemple', quand: 0, projets: [{
    depot: 'mon-compte/exemple', depuis: 'x',
    commits: [{ sha, message: 'exemple', date: 0, fichiers: ['src/app/api/envoi/route.ts'], enPartie: [], clesNonVerifiees: [], cles: 0 }],
  }] };
  it('contient un exemple JSON complet', () => { expect(blocs.length).toBeGreaterThan(0); });
  it('reste court et dit comment lire le lot sans rien compter « relu » à tort', () => {
    expect(texte.split('\n').length).toBeLessThan(110);
    expect(texte).toContain('/tmp/lea/index.md');
    expect(texte).toContain('`offset`/`limit`');
    expect(texte).toContain('Un fichier que tu n\'as pas pu lire en entier → `jusqua` = le commit précédent pour ce projet');
    expect(texte).toContain('Si tu n\'as rien pu lire d\'un projet, ne le mets pas dans `projets`');
    expect(texte).toMatch(/Si la commande échoue/);
    expect(texte).toContain('`ligne` = le numéro écrit au début de la ligne dans le .diff (jamais celui que l\'outil de lecture affiche) ; pas sûr → ne mets pas `ligne`');
    expect(texte).toMatch(/au plus en `moyen`, jamais en `grave`/);
  });
  it('l\'exemple est accepté par la validation du serveur, avec un lot assorti', () => {
    const exemple = blocs[0];
    expect(exemple.lot).toBeTypeOf('string');
    expect(exemple.constats.length).toBeGreaterThan(0);
    const v = validerRapport(exemple, lot);
    expect(v.constats).toHaveLength(exemple.constats.length);
    expect(v.projets[0].jusqua).toBe(sha);
  });
});
