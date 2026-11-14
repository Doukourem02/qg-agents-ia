import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES, Refus } from '../qg';
import {
  CLES_LEA, dernierPassage, ecrireRapport, lireConstats, lireMarque, lireRelectures, marquerVu, preparerLot, traiterActionLea, type DepsLea,
} from './relecture';
import type { Lot } from './types';

const NOW = Date.UTC(2026, 10, 11, 10, 0); // mercredi 11 novembre 2026, 10:00 UTC
const MIN = 60_000;
const HEURE = 60 * MIN;
const PROPRIO = 'mon-compte';
const LIEN = 'https://mon-qg.vercel.app/?bureau=lea';
const TITRE = '🔎 Léa · à corriger vite';
// Faux secrets, toujours par concaténation (jamais une vraie forme d'un seul tenant dans le code).
const GHP = 'ghp' + '_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const ENV_SECRET = 'S3cr3t' + 'ValeurQuiFuit' + '42';
const KO = 1024;

// --- Faux GitHub --------------------------------------------------------------------------

type Fichier = { filename: string; status?: string; patch?: string };
type FauxCommit = { sha: string; message?: string; files: Fichier[]; tronque?: true };
type FauxDepot = { nom: string; chaine: FauxCommit[]; panne?: true; lent?: true; commitsEnPanne?: true; shasEnPanne?: string[] };

const patch = (...lignes: string[]) => `@@ -0,0 +1,${lignes.length} @@\n` + lignes.map(l => '+' + l).join('\n');
const code = (texte = 'const x = 1;') => patch(texte);
/** `null` : GitHub ne donne pas de différence pour ce fichier. */
const fichier = (filename: string, p: string | null = code(), status = 'modified'): Fichier => ({ filename, status, ...(p === null ? {} : { patch: p }) });
const commit = (sha: string, files: Fichier[] = [fichier('src/a.ts')], message = `message ${sha}`): FauxCommit => ({ sha, message, files });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const D = (nom: string) => `${PROPRIO}/${nom}`;

function fauxGitHub(depots: FauxDepot[], listePanne: { oui: boolean }) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/user/repos')) {
      if (listePanne.oui) return new Response('', { status: 502 });
      return json(depots.map(d => ({ full_name: D(d.nom), archived: false, pushed_at: new Date(NOW - 86_400_000).toISOString() })));
    }
    const m = /\/repos\/mon-compte\/([^/?]+)(.*)$/.exec(u);
    const d = m && depots.find(x => x.nom === m[1]);
    if (!m || !d) return new Response('', { status: 404 });
    if (d.panne) return new Response('', { status: 500 });
    if (d.lent) return new Promise<Response>((_, rejeter) => init?.signal?.addEventListener('abort', () => rejeter(new DOMException('coupé', 'AbortError'))));
    const reste = m[2];
    const tete = d.chaine.at(-1)?.sha;
    if (reste === '') return json({ default_branch: 'main' });
    if (reste === '/branches/main') return tete ? json({ commit: { sha: tete } }) : new Response('', { status: 404 });
    const cmp = /^\/compare\/([^.]+)\.\.\.main(?:\?per_page=30)?$/.exec(reste);
    if (cmp) {
      const i = d.chaine.findIndex(c => c.sha === decodeURIComponent(cmp[1]));
      if (i < 0) return new Response('', { status: 404 });
      const apres = d.chaine.slice(i + 1);
      return json({ status: apres.length ? 'ahead' : 'identical', commits: apres.map(c => ({ sha: c.sha })) });
    }
    if (reste.startsWith('/commits?')) return json([...d.chaine].reverse().slice(0, 3).map(c => ({ sha: c.sha })));
    const un = /^\/commits\/([^/?]+)$/.exec(reste);
    if (un && (d.commitsEnPanne || d.shasEnPanne?.includes(decodeURIComponent(un[1])))) return new Response('', { status: 403 });
    const c = un && d.chaine.find(x => x.sha === decodeURIComponent(un[1]));
    if (!c) return new Response('', { status: 404 });
    const files = c.tronque ? [...c.files, ...Array.from({ length: 300 - c.files.length }, (_, i) => fichier(`gen/f${i}.png`, null, 'added'))] : c.files;
    return json({ sha: c.sha, commit: { message: c.message ?? '', author: { date: new Date(NOW - HEURE).toISOString() } }, files });
  }) as unknown as typeof fetch;
}

/** Une mémoire qui note tout ce qui y est écrit (pour vérifier qu'aucun secret n'y entre). */
function memoireEspionne() {
  const base = memoire();
  const ecrits: string[] = [];
  const kv: KV = {
    ...base,
    hset: async (k, f, v) => { ecrits.push(k, f, v); return base.hset(k, f, v); },
    lpush: async (k, v) => { ecrits.push(k, v); return base.lpush(k, v); },
    setnx: async (k, v, s) => { ecrits.push(k, v); return base.setnx(k, v, s); },
  };
  return { kv, ecrits };
}

function banc(depots: FauxDepot[], o: { jeton?: string | null } = {}) {
  const { kv, ecrits } = memoireEspionne();
  const envoyes: string[] = [];
  const panne = { telegram: 0 };
  const listePanne = { oui: false };
  const envoyer = vi.fn(async (t: string) => {
    if (panne.telegram > 0) { panne.telegram--; throw new Error('Telegram ne répond pas'); }
    envoyes.push(t);
  });
  const deps: DepsLea = { fetch: fauxGitHub(depots, listePanne), envoyer, jeton: o.jeton === null ? undefined : (o.jeton ?? 'jeton'), echeance: 5_000 };
  return { kv, ecrits, envoyes, envoyer, deps, depots, panne, listePanne };
}

/** Premier passage (marque-pages posés sur `x0`), puis les commits donnés arrivent. */
async function apresPremierPassage(depots: { nom: string; nouveaux: FauxCommit[] }[]) {
  const b = banc(depots.map(d => ({ nom: d.nom, chaine: [commit(`${d.nom}0`)] })));
  await preparerLot(b.kv, b.deps, NOW);
  depots.forEach((d, i) => b.depots[i].chaine.push(...d.nouveaux));
  return b;
}

const lotDe = async (b: ReturnType<typeof banc>, t = NOW + HEURE): Promise<Lot> => {
  const r = await preparerLot(b.kv, b.deps, t);
  if (!r.lot) throw new Error('lot attendu');
  return r.lot;
};
const rapportComplet = (lot: Lot, constats: unknown[] = []) => ({ lot: lot.id, projets: lot.projets.map(p => ({ depot: p.depot })), constats });
const avis = (o: Record<string, unknown> = {}) => ({ depot: D('a'), sha: 'a1', fichier: 'src/a.ts', ligne: 1, gravite: 'moyen', quoi: 'une variable jamais lue', conseil: 'la retirer', ...o });
const etatLea = async (kv: KV) => JSON.parse((await kv.hgetall(CLES.etats)).lea ?? 'null');
const journal = async (kv: KV) => (await kv.lrange(CLES.journal, 0, -1)).map(v => JSON.parse(v));
const fichiersDe = (lot: Lot, depot: string, sha: string) => lot.projets.find(p => p.depot === D(depot))!.commits.find(c => c.sha === sha)!.fichiers;

afterEach(() => vi.restoreAllMocks());

// --- Marque-pages ---------------------------------------------------------------------------

describe('premier passage et nouveaux projets', () => {
  it('pose le marque-page sur la tête de chaque projet, rien à relire, passage complet noté', async () => {
    const b = banc([{ nom: 'a', chaine: [commit('a0'), commit('a1')] }, { nom: 'b', chaine: [commit('b0')] }]);
    expect(await preparerLot(b.kv, b.deps, NOW)).toEqual({ lot: null });
    expect(await lireMarque(b.kv, D('a'))).toBe('a1');
    expect(await lireMarque(b.kv, D('b'))).toBe('b0');
    expect(await dernierPassage(b.kv)).toBe(NOW);
    expect(b.envoyer).not.toHaveBeenCalled();
  });

  it('un projet devenu actif plus tard : marque-page sur sa tête, son passé n’est pas relu', async () => {
    const b = banc([{ nom: 'a', chaine: [commit('a0')] }]);
    await preparerLot(b.kv, b.deps, NOW);
    b.depots.push({ nom: 'c', chaine: [commit('c0'), commit('c1')] });
    expect(await preparerLot(b.kv, b.deps, NOW + HEURE)).toEqual({ lot: null });
    expect(await lireMarque(b.kv, D('c'))).toBe('c1');
    expect(await dernierPassage(b.kv)).toBe(NOW + HEURE);
  });

  it('projet vide (pas de branche) : ignoré sans casser le passage', async () => {
    const b = banc([{ nom: 'vide', chaine: [] }, { nom: 'a', chaine: [commit('a0')] }]);
    expect(await preparerLot(b.kv, b.deps, NOW)).toEqual({ lot: null });
    expect(await lireMarque(b.kv, D('vide'))).toBeNull();
    expect(await lireMarque(b.kv, D('a'))).toBe('a0');
    expect(await dernierPassage(b.kv)).toBe(NOW); // un dépôt vide n'est pas une panne
  });
});

// --- Le lot -----------------------------------------------------------------------------------

describe('le lot', () => {
  it('nouveaux commits : commits entiers, du plus ancien au plus récent, patchs rendus', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1'), commit('a2', [fichier('src/b.ts', code('let y = 2;'), 'added')])] }]);
    const lot = await lotDe(b);
    expect(lot.projets).toHaveLength(1);
    const p = lot.projets[0];
    expect(p.depot).toBe(D('a'));
    expect(p.depuis).toBe('a0');
    expect(p.commits.map(c => c.sha)).toEqual(['a1', 'a2']);
    expect(p.commits[0].message).toBe('message a1');
    expect(fichiersDe(lot, 'a', 'a2')).toEqual([{ chemin: 'src/b.ts', statut: 'added', patch: code('let y = 2;') }]);
    expect(await lireMarque(b.kv, D('a'))).toBe('a0'); // le marque-page n'avance qu'au rapport
  });

  it('30 commits au plus par projet', async () => {
    const nouveaux = Array.from({ length: 40 }, (_, i) => commit(`a${i + 1}`));
    const b = await apresPremierPassage([{ nom: 'a', nouveaux }]);
    const lot = await lotDe(b);
    expect(lot.projets[0].commits).toHaveLength(30);
    expect(lot.projets[0].commits.at(-1)!.sha).toBe('a30');
  });

  it('~150 Ko au plus : au-delà, gardé pour le passage suivant (commits entiers)', async () => {
    const gros = (sha: string) => commit(sha, [fichier('src/p.ts', code('x'.repeat(30 * KO))), fichier('src/q.ts', code('y'.repeat(30 * KO)))]);
    const b = await apresPremierPassage([
      { nom: 'a', nouveaux: [gros('a1'), gros('a2'), gros('a3')] },
      { nom: 'b', nouveaux: [commit('b1')] },
    ]);
    const lot = await lotDe(b);
    expect(lot.projets.find(p => p.depot === D('a'))!.commits.map(c => c.sha)).toEqual(['a1', 'a2']);
    expect(lot.projets.find(p => p.depot === D('b'))!.commits.map(c => c.sha)).toEqual(['b1']); // un petit commit tient encore
    await ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + HEURE + MIN);
    expect(await lireMarque(b.kv, D('a'))).toBe('a2');
    const suivant = await lotDe(b, NOW + 2 * HEURE);
    expect(suivant.projets.map(p => [p.depot, p.commits.map(c => c.sha)])).toEqual([[D('a'), ['a3']]]);
  });

  it('un seul commit plus lourd que le lot : rendu quand même, les fichiers en trop marqués « trop gros »', async () => {
    const files = Array.from({ length: 5 }, (_, i) => fichier(`src/f${i}.ts`, code(String(i).repeat(39 * KO))));
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', files)] }]);
    const lot = await lotDe(b);
    const fl = fichiersDe(lot, 'a', 'a1');
    expect(fl.filter(f => f.patch)).toHaveLength(3);
    expect(fl.filter(f => f.enPartie === 'trop gros').map(f => f.chemin)).toEqual(['src/f3.ts', 'src/f4.ts']);
    expect(fl.every(f => f.patch || f.note)).toBe(true);
    await ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + HEURE + MIN);
    expect((await lireRelectures(b.kv))[0].enPartie).toEqual(['src/f3.ts', 'src/f4.ts']);
  });

  it('fichier de plus de 40 Ko : patch retiré du lot, mais la clé cachée au bout est trouvée', async () => {
    const lourd = patch('z'.repeat(41 * KO), `const k = '${GHP}';`);
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [fichier('src/lourd.ts', lourd), fichier('src/a.ts')])] }]);
    const lot = await lotDe(b);
    const f = fichiersDe(lot, 'a', 'a1').find(x => x.chemin === 'src/lourd.ts')!;
    expect(f.patch).toBeUndefined();
    expect(f.enPartie).toBe('trop gros');
    expect(f.note).toBeTruthy();
    const c = (await lireConstats(b.kv)).find(x => x.fichier === 'src/lourd.ts')!;
    expect(c).toMatchObject({ source: 'serveur', gravite: 'grave', ligne: 2, depot: D('a'), sha: 'a1' });
  });

  it('fichiers ignorés (verrou, image) : jamais envoyés à la routine, mais passés au repérage des clés', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [
      fichier('pnpm-lock.yaml', patch(`token: ${GHP}`)),
      fichier('public/logo.png', null, 'added'),
      fichier('src/a.ts'),
    ])] }]);
    const lot = await lotDe(b);
    expect(fichiersDe(lot, 'a', 'a1').map(f => f.chemin)).toEqual(['src/a.ts']);
    expect((await lireConstats(b.kv)).map(c => c.fichier)).toEqual(['pnpm-lock.yaml']);
  });

  it('commit sans code (tous ignorés) ou vide (fusion) : rien à relire, accepté par le serveur lui-même (M5)', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [fichier('pnpm-lock.yaml')]), commit('a2', [])] }]);
    expect(await preparerLot(b.kv, b.deps, NOW + HEURE)).toEqual({ lot: null });
    expect((await lireRelectures(b.kv))[0]).toMatchObject({ depot: D('a'), rienACoder: 2 });
    expect(await lireMarque(b.kv, D('a'))).toBe('a2');
  });

  it('marque-page introuvable (historique réécrit) : commits récents, le lot et la relecture le disent', async () => {
    const b = banc([{ nom: 'a', chaine: [commit('a0')] }]);
    await preparerLot(b.kv, b.deps, NOW);
    b.depots[0].chaine = [commit('n1'), commit('n2')]; // a0 a disparu
    const lot = await lotDe(b);
    expect(lot.projets[0]).toMatchObject({ depot: D('a'), depuis: 'a0', reecrit: true });
    expect(lot.projets[0].commits.map(c => c.sha)).toEqual(['n1', 'n2']);
    await ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + HEURE + MIN);
    expect((await lireRelectures(b.kv))[0].reecrit).toBe(true);
    expect(await lireMarque(b.kv, D('a'))).toBe('n2');
  });

  it('GitHub en panne pour un projet : ce projet attend (marque-page intact), les autres sont relus', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }, { nom: 'b', nouveaux: [commit('b1')] }]);
    b.depots[0].panne = true;
    const lot = await lotDe(b);
    expect(lot.projets.map(p => p.depot)).toEqual([D('b')]);
    expect(await lireMarque(b.kv, D('a'))).toBe('a0');
  });

  it('échéance atteinte avant la fin : pas compté comme passage complet', async () => {
    const b = banc([{ nom: 'a', chaine: [commit('a0')] }]);
    await preparerLot(b.kv, b.deps, NOW);
    b.depots.unshift({ nom: 'lent', chaine: [commit('l0')], lent: true });
    const r = await preparerLot(b.kv, { ...b.deps, echeance: 30 }, NOW + HEURE);
    expect(r).toEqual({ lot: null });
    expect(await dernierPassage(b.kv)).toBe(NOW);
    expect(await lireMarque(b.kv, D('lent'))).toBeNull();
    expect(await etatLea(b.kv)).toMatchObject({ statut: 'erreur', tache: 'n\'a pas pu lire 2 projets : lent, a' });
  });

  it('nouveaux commits connus mais illisibles (403) : pas un passage complet, jamais « rien de nouveau »', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    b.depots[0].commitsEnPanne = true;
    expect(await preparerLot(b.kv, b.deps, NOW + HEURE)).toEqual({ lot: null });
    expect(await dernierPassage(b.kv)).toBe(NOW);
    expect(await etatLea(b.kv)).toMatchObject({ statut: 'erreur', tache: 'n\'a pas pu lire 1 projet : a', outil: 'GH' });
    expect(await lireMarque(b.kv, D('a'))).toBe('a0');
  });

  it('un projet en panne, l’autre sans nouveauté : pas un passage complet', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }, { nom: 'b', nouveaux: [] }]);
    b.depots[0].panne = true;
    expect(await preparerLot(b.kv, b.deps, NOW + HEURE)).toEqual({ lot: null });
    expect(await dernierPassage(b.kv)).toBe(NOW);
    expect((await etatLea(b.kv)).tache).not.toMatch(/rien de nouveau/);
    // GitHub revenu : le passage redevient complet
    b.depots[0].panne = undefined;
    const lot = await lotDe(b, NOW + 2 * HEURE);
    expect(lot.projets.map(p => p.depot)).toEqual([D('a')]);
  });

  it('la liste des projets illisible → Refus 503, rien d’avancé', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    b.listePanne.oui = true;
    const e = await preparerLot(b.kv, b.deps, NOW + HEURE).catch(x => x);
    expect(e).toBeInstanceOf(Refus);
    expect((e as Refus).code).toBe(503);
    expect(await dernierPassage(b.kv)).toBe(NOW);
  });

  it('sans jeton → Refus explicite, rien d’écrit ni de lu', async () => {
    const b = banc([{ nom: 'a', chaine: [commit('a0')] }], { jeton: null });
    const lu = vi.spyOn(b.deps, 'fetch');
    const e = await preparerLot(b.kv, b.deps, NOW).catch(x => x);
    expect(e).toBeInstanceOf(Refus);
    expect((e as Refus).message).toMatch(/GITHUB_LECTURE_PERSO/);
    expect(lu).not.toHaveBeenCalled();
    expect(b.ecrits).toEqual([]);
    expect(await dernierPassage(b.kv)).toBeNull();
  });
});

// --- Fichiers .env et « clés non vérifiées » ---------------------------------------------

describe('fichiers .env et repérage incomplet', () => {
  it('.env ajouté : constat « fichier .env » + secret dedans ; sa différence n’est jamais envoyée', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [fichier('.env', patch(`API_SECRET=${ENV_SECRET}`), 'added'), fichier('src/a.ts')])] }]);
    const lot = await lotDe(b);
    const f = fichiersDe(lot, 'a', 'a1')[0];
    expect(f).toMatchObject({ chemin: '.env', enPartie: 'non fourni' });
    expect(f.patch).toBeUndefined();
    expect(f.note).toMatch(/\.env/);
    const constats = await lireConstats(b.kv);
    expect(constats.map(c => c.quoi).sort()).toEqual(['fichier .env ajouté au dépôt', 'secret poussé par erreur dans un fichier .env']);
    expect(constats.every(c => c.gravite === 'grave' && c.source === 'serveur')).toBe(true);
    expect(JSON.stringify(lot)).not.toContain(ENV_SECRET);
  });

  it('.env modifié : pas de constat « fichier .env », mais le secret est relevé', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [fichier('.env.local', patch(`STRIPE_KEY=${ENV_SECRET}`)), fichier('src/a.ts')])] }]);
    await lotDe(b);
    expect((await lireConstats(b.kv)).map(c => c.quoi)).toEqual(['secret poussé par erreur dans un fichier .env']);
  });

  it('modèles .env (.env.example…) : jamais envoyés non plus, note explicite, pas de constat « fichier .env »', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [
      fichier('.env.example', patch('API_KEY=xxx'), 'added'),
      fichier('config/.env.sample', patch('TOKEN=<ton jeton>')),
      fichier('src/a.ts'),
    ])] }]);
    const lot = await lotDe(b);
    for (const f of fichiersDe(lot, 'a', 'a1').filter(x => x.chemin !== 'src/a.ts')) {
      expect(f.patch).toBeUndefined();
      expect(f).toMatchObject({ enPartie: 'non fourni' });
      expect(f.note).toMatch(/\.env/);
    }
    expect(await lireConstats(b.kv)).toEqual([]);
  });

  it('renommé EN fichier .env : constat « fichier .env » comme un ajout', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [fichier('.env.local', null, 'renamed'), fichier('src/a.ts')])] }]);
    const lot = await lotDe(b);
    expect(fichiersDe(lot, 'a', 'a1')[0].patch).toBeUndefined();
    expect((await lireConstats(b.kv)).map(c => [c.fichier, c.quoi, c.gravite])).toEqual([['.env.local', 'fichier .env ajouté au dépôt', 'grave']]);
  });

  it('binaires de fichierIgnore (wasm, exe…) : pas « clés non vérifiées » ; sqlite/db et svg : oui', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [
      fichier('public/moteur.wasm', null, 'added'),
      fichier('outils/lanceur.exe', null, 'added'),
      fichier('data/base.db', null),
      fichier('data/locale.sqlite', null),
      fichier('public/icone.svg', null),
    ])] }]);
    expect(await preparerLot(b.kv, b.deps, NOW + HEURE)).toEqual({ lot: null }); // rien à relire : accepté par le serveur
    expect((await lireRelectures(b.kv))[0].clesNonVerifiees).toEqual(['data/base.db', 'data/locale.sqlite', 'public/icone.svg']);
  });

  it('« clés non vérifiées » : texte sans différence et liste coupée oui ; binaire, renommage pur, suppression non', async () => {
    const tronque: FauxCommit = { ...commit('a2', [fichier('src/c.ts')]), tronque: true };
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [
      fichier('src/enorme.ts', null),
      fichier('public/photo.jpg', null, 'added'),
      fichier('src/vieux.ts', null, 'renamed'),
      fichier('src/parti.ts', null, 'removed'),
      fichier('yarn.lock', null),
    ]), tronque] }]);
    const lot = await lotDe(b);
    const a1 = fichiersDe(lot, 'a', 'a1');
    expect(a1.find(f => f.chemin === 'src/enorme.ts')).toMatchObject({ enPartie: 'non fourni' });
    expect(a1.find(f => f.chemin === 'src/vieux.ts')!.enPartie).toBeUndefined();
    expect(a1.find(f => f.chemin === 'src/parti.ts')!.enPartie).toBeUndefined();
    expect(fichiersDe(lot, 'a', 'a2').find(f => f.chemin === '…')).toMatchObject({ enPartie: 'non fourni' });
    expect(JSON.stringify(lot)).not.toContain('clesNonVerifiees');
    await ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + HEURE + MIN);
    const r = (await lireRelectures(b.kv))[0];
    expect(r.clesNonVerifiees).toEqual(['src/enorme.ts', 'yarn.lock', '…']);
    expect(r.enPartie).toEqual(['src/enorme.ts', '…']); // une suppression sans différence : rien à relire
  });
});

// --- Réservation ------------------------------------------------------------------------------

describe('lot réservé 50 min', () => {
  it('second a-relire pendant 50 min → attente ; après → redonné', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const lot = await lotDe(b);
    expect(await preparerLot(b.kv, b.deps, NOW + HEURE + 49 * MIN)).toEqual({ lot: null, attente: true });
    expect(await dernierPassage(b.kv)).toBe(NOW); // une attente n'est pas un passage
    const encore = await lotDe(b, NOW + HEURE + 51 * MIN);
    expect(encore.projets[0].commits.map(c => c.sha)).toEqual(['a1']);
    expect(encore.id).not.toBe(lot.id);
    // l'ancien lot ne vaut plus
    await expect(ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + 2 * HEURE)).rejects.toMatchObject({ code: 409 });
    expect(await ecrireRapport(b.kv, rapportComplet(encore), b.deps, NOW + 2 * HEURE)).toMatchObject({ ok: true });
  });

  it('un rapport arrivé après 50 min est accepté tant qu’aucun nouveau lot n’a été préparé', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const lot = await lotDe(b);
    expect(await ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + HEURE + 55 * MIN)).toMatchObject({ ok: true });
    expect(await lireMarque(b.kv, D('a'))).toBe('a1');
  });

  it('lot d’un projet, un autre illisible : après le rapport, pas de passage complet, l’état le dit', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }, { nom: 'b', nouveaux: [commit('b1')] }]);
    b.depots[1].panne = true;
    const lot = await lotDe(b);
    expect(lot.projets.map(p => p.depot)).toEqual([D('a')]);
    expect(await ecrireRapport(b.kv, rapportComplet(lot, [avis()]), b.deps, NOW + HEURE + MIN)).toMatchObject({ ok: true, constats: 1 });
    expect(await lireMarque(b.kv, D('a'))).toBe('a1'); // le relu avance quand même
    expect(await lireConstats(b.kv)).toHaveLength(1);
    expect(await dernierPassage(b.kv)).toBe(NOW);
    expect((await etatLea(b.kv)).tache).toBe('a relu 1 commit dans 1 projet, 1 point ; n\'a pas pu lire 1 projet : b');
  });

  it('un commit illisible après le premier : le lot part, mais le passage n’est pas complet', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1'), commit('a2')] }]);
    b.depots[0].shasEnPanne = ['a2'];
    const lot = await lotDe(b);
    expect(lot.projets[0].commits.map(c => c.sha)).toEqual(['a1']);
    await ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + HEURE + MIN);
    expect(await lireMarque(b.kv, D('a'))).toBe('a1');
    expect(await dernierPassage(b.kv)).toBe(NOW);
    expect((await etatLea(b.kv)).tache).toMatch(/n'a pas pu lire 1 projet : a$/);
  });

  it('échéance coupée avec un lot non vide : pas de passage complet après le rapport', async () => {
    const b = banc([{ nom: 'a', chaine: [commit('a0')] }, { nom: 'c', chaine: [commit('c0')] }]);
    await preparerLot(b.kv, b.deps, NOW);
    b.depots[0].chaine.push(commit('a1'));
    b.depots.splice(1, 0, { nom: 'lent', chaine: [commit('l0')], lent: true }); // a, lent, c
    const r = await preparerLot(b.kv, { ...b.deps, echeance: 30 }, NOW + HEURE);
    expect(r.lot!.projets.map(p => p.depot)).toEqual([D('a')]);
    await ecrireRapport(b.kv, rapportComplet(r.lot!), b.deps, NOW + HEURE + MIN);
    expect(await dernierPassage(b.kv)).toBe(NOW);
    expect((await etatLea(b.kv)).tache).toBe('a relu 1 commit dans 1 projet, 0 point ; n\'a pas pu lire 2 projets : lent, c');
  });

  it('rien de nouveau après le rapport → { lot: null }, passage complet', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const lot = await lotDe(b);
    await ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + HEURE + MIN);
    expect(await dernierPassage(b.kv)).toBe(NOW + HEURE + MIN);
    expect(await preparerLot(b.kv, b.deps, NOW + 2 * HEURE)).toEqual({ lot: null });
    expect(await dernierPassage(b.kv)).toBe(NOW + 2 * HEURE);
  });
});

// --- Le rapport ------------------------------------------------------------------------------

describe('le rapport', () => {
  const deuxProjets = () => apresPremierPassage([
    { nom: 'a', nouveaux: [commit('a1'), commit('a2', [fichier('src/b.ts')])] },
    { nom: 'b', nouveaux: [commit('b1')] },
  ]);

  it('enregistre les constats, avance les marque-pages, garde la relecture', async () => {
    const b = await deuxProjets();
    const lot = await lotDe(b);
    const r = await ecrireRapport(b.kv, rapportComplet(lot, [avis(), avis({ sha: 'a2', fichier: 'src/b.ts', ligne: null, gravite: 'mineur' })]), b.deps, NOW + HEURE + MIN);
    expect(r).toEqual({ ok: true, constats: 2, envoyes: 0 });
    expect(await lireMarque(b.kv, D('a'))).toBe('a2');
    expect(await lireMarque(b.kv, D('b'))).toBe('b1');
    const constats = await lireConstats(b.kv);
    expect(constats).toHaveLength(2);
    expect(constats.find(c => c.sha === 'a1')).toMatchObject({ source: 'lea', statut: 'ouvert', message: 'message a1', gravite: 'moyen', ligne: 1 });
    const rel = await lireRelectures(b.kv);
    expect(rel.map(x => x.depot).sort()).toEqual([D('a'), D('b')]);
    expect(rel.find(x => x.depot === D('a'))!.commits).toEqual([{ sha: 'a1', message: 'message a1' }, { sha: 'a2', message: 'message a2' }]);
  });

  it('jusqua par projet ; projet absent du rapport → marque-page inchangé, redonné ensuite', async () => {
    const b = await deuxProjets();
    const lot = await lotDe(b);
    await ecrireRapport(b.kv, { lot: lot.id, projets: [{ depot: D('a'), jusqua: 'a1' }], constats: [] }, b.deps, NOW + HEURE + MIN);
    expect(await lireMarque(b.kv, D('a'))).toBe('a1');
    expect(await lireMarque(b.kv, D('b'))).toBe('b0');
    const suivant = await lotDe(b, NOW + 2 * HEURE);
    expect(suivant.projets.map(p => [p.depot, p.commits.map(c => c.sha)])).toEqual([[D('a'), ['a2']], [D('b'), ['b1']]]);
  });

  it('rapport rejoué → refusé, aucun doublon', async () => {
    const b = await deuxProjets();
    const lot = await lotDe(b);
    const corps = rapportComplet(lot, [avis()]);
    await ecrireRapport(b.kv, corps, b.deps, NOW + HEURE + MIN);
    await expect(ecrireRapport(b.kv, corps, b.deps, NOW + HEURE + 2 * MIN)).rejects.toMatchObject({ code: 409 });
    expect(await lireConstats(b.kv)).toHaveLength(1);
    expect(await lireRelectures(b.kv)).toHaveLength(2);
  });

  it('validation stricte', async () => {
    const b = await deuxProjets();
    const lot = await lotDe(b);
    const t = NOW + HEURE + MIN;
    const refuse = async (corps: unknown, code = 422) => {
      const e = await ecrireRapport(b.kv, corps, b.deps, t).catch(x => x);
      expect(e).toBeInstanceOf(Refus);
      expect((e as Refus).code).toBe(code);
      expect((e as Refus).message.length).toBeGreaterThan(5);
    };
    await refuse({ ...rapportComplet(lot), lot: 'inconnu' }, 409);
    await refuse('pas un objet', 400);
    await refuse({ lot: lot.id, constats: [] }, 400); // projets manquant
    await refuse({ lot: lot.id, projets: [{ depot: D('zzz') }], constats: [] });
    await refuse({ lot: lot.id, projets: [{ depot: D('a'), jusqua: 'b1' }], constats: [] });
    await refuse({ lot: lot.id, projets: [{ depot: D('a') }, { depot: D('a') }], constats: [] });
    await refuse(rapportComplet(lot, [avis({ depot: D('zzz') })]));
    await refuse(rapportComplet(lot, [avis({ sha: 'b1' })]));
    await refuse(rapportComplet(lot, [avis({ fichier: 'src/b.ts' })])); // fichier d'un autre commit
    await refuse(rapportComplet(lot, [avis({ gravite: 'critique' })]));
    await refuse(rapportComplet(lot, [avis({ quoi: 'x'.repeat(301) })]));
    await refuse(rapportComplet(lot, [avis({ conseil: '' })]));
    await refuse(rapportComplet(lot, [avis({ ligne: -3 })]));
    await refuse(rapportComplet(lot, Array.from({ length: 21 }, () => avis())));
    // constat sur un commit que le rapport ne compte pas relu (après jusqua)
    await refuse({ lot: lot.id, projets: [{ depot: D('a'), jusqua: 'a1' }], constats: [avis({ sha: 'a2', fichier: 'src/b.ts' })] });
    // constat sur un projet absent du rapport
    await refuse({ lot: lot.id, projets: [{ depot: D('a') }], constats: [avis({ depot: D('b'), sha: 'b1' })] });
    // rien n'a bougé
    expect(await lireMarque(b.kv, D('a'))).toBe('a0');
    expect(await lireConstats(b.kv)).toEqual([]);
    expect(await ecrireRapport(b.kv, rapportComplet(lot, [avis({ quoi: 'x'.repeat(300) })]), b.deps, t)).toMatchObject({ ok: true, constats: 1 });
  });

  it('état : « au travail » à la remise du lot, « termine » au rapport, avec des nombres seulement', async () => {
    const b = await deuxProjets();
    await lotDe(b);
    expect(await etatLea(b.kv)).toMatchObject({ statut: 'au travail', tache: 'relit les pushes', outil: 'GH' });
    const lot = await lotDe(b, NOW + HEURE + 51 * MIN);
    await ecrireRapport(b.kv, rapportComplet(lot, [avis()]), b.deps, NOW + 2 * HEURE);
    expect(await etatLea(b.kv)).toMatchObject({ statut: 'termine', tache: 'a relu 3 commits dans 2 projets, 1 point', outil: 'GH' });
    const j = (await journal(b.kv)).filter(e => e.agent === 'lea');
    expect(j[0]).toMatchObject({ statut: 'termine', texte: 'a relu 3 commits dans 2 projets, 1 point' });
    expect(JSON.stringify(j)).not.toMatch(/mon-compte|src\//);
  });
});

// --- Telegram ---------------------------------------------------------------------------------

describe('Telegram', () => {
  it('clé trouvée par le serveur : envoyée tout de suite, une seule fois, avec titre et lien', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1abcdef99', [fichier('src/cle.ts', patch('// rien', `const k = '${GHP}';`))])] }]);
    await lotDe(b);
    expect(b.envoyes).toHaveLength(1);
    expect(b.envoyes[0]).toBe([TITRE, '', '• a · a1abcde · src/cle.ts:2 · clé GitHub poussée par erreur', '', LIEN].join('\n'));
    const c = (await lireConstats(b.kv))[0];
    expect(await b.kv.hgetall(CLES_LEA.envoyes)).toEqual({ [c.id]: String(NOW + HEURE) });
    expect(c).not.toHaveProperty('envoye'); // l'envoi est suivi à part : le constat n'est jamais réécrit
    expect(c.conseil).toMatch(/compromise/);
    // le lot est redonné après 50 min : la clé est revue, jamais renvoyée
    await lotDe(b, NOW + 2 * HEURE);
    expect(b.envoyes).toHaveLength(1);
    expect(await lireConstats(b.kv)).toHaveLength(1);
  });

  it('graves de l’IA : 5 au plus par passage, « + N autres dans le bureau » ; clés du serveur toujours', async () => {
    const files = Array.from({ length: 20 }, (_, i) => fichier(`src/f${i}.ts`));
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', files)] }]);
    const lot = await lotDe(b);
    const graves = files.map((f, i) => avis({ fichier: f.filename, ligne: i + 1, gravite: 'grave', quoi: `faille numéro ${i}` }));
    const r = await ecrireRapport(b.kv, rapportComplet(lot, graves), b.deps, NOW + HEURE + MIN);
    expect(r).toEqual({ ok: true, constats: 20, envoyes: 5 });
    expect(b.envoyes).toHaveLength(1);
    const lignes = b.envoyes[0].split('\n');
    expect(lignes[0]).toBe(TITRE);
    expect(lignes.filter(l => l.startsWith('• '))).toHaveLength(5);
    expect(lignes).toContain('+ 15 autres dans le bureau');
    expect(lignes.at(-1)).toBe(LIEN);
    expect((await lireConstats(b.kv)).filter(c => c.gravite === 'grave')).toHaveLength(20);
    // passage suivant : rien n'est renvoyé (les 15 autres restent dans le bureau)
    await preparerLot(b.kv, b.deps, NOW + 2 * HEURE);
    expect(b.envoyes).toHaveLength(1);
  });

  it('7 clés du serveur dans un même passage : toutes envoyées', async () => {
    const lignes = Array.from({ length: 7 }, (_, i) => `const k${i} = '${GHP.slice(0, -1)}${i}';`);
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [fichier('src/cles.ts', patch(...lignes))])] }]);
    await lotDe(b);
    expect(b.envoyes[0].split('\n').filter(l => l.startsWith('• '))).toHaveLength(7);
    expect(b.envoyes[0]).not.toContain('autre');
  });

  it('les moyens et mineurs ne partent jamais sur Telegram', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const lot = await lotDe(b);
    await ecrireRapport(b.kv, rapportComplet(lot, [avis(), avis({ gravite: 'mineur' })]), b.deps, NOW + HEURE + MIN);
    expect(b.envoyer).not.toHaveBeenCalled();
  });

  it('échec d’envoi : jamais marqué envoyé, réessayé au passage suivant, puis plus jamais', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const lot = await lotDe(b);
    b.panne.telegram = 1;
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await ecrireRapport(b.kv, rapportComplet(lot, [avis({ gravite: 'grave', quoi: 'la connexion ne vérifie plus le mot de passe' })]), b.deps, NOW + HEURE + MIN);
    expect(r).toEqual({ ok: true, constats: 1, envoyes: 0 });
    expect(erreurs).toHaveBeenCalled();
    expect(await b.kv.hgetall(CLES_LEA.envoyes)).toEqual({});
    expect(await preparerLot(b.kv, b.deps, NOW + 2 * HEURE)).toEqual({ lot: null });
    expect(b.envoyes).toHaveLength(1);
    expect(b.envoyes[0]).toContain('• a · a1 · src/a.ts:1 · la connexion ne vérifie plus le mot de passe');
    expect(Object.values(await b.kv.hgetall(CLES_LEA.envoyes))).toEqual([String(NOW + 2 * HEURE)]);
    await preparerLot(b.kv, b.deps, NOW + 3 * HEURE);
    expect(b.envoyes).toHaveLength(1);
  });

  it('« Vu » ne change que le statut : rien n’est renvoyé', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [fichier('src/cle.ts', patch(`k = '${GHP}'`))])] }]);
    await lotDe(b);
    const c = (await lireConstats(b.kv))[0];
    expect(await marquerVu(b.kv, c.id)).toBe(true);
    expect(await marquerVu(b.kv, 'inconnu')).toBe(false);
    const apres = (await lireConstats(b.kv))[0];
    expect(apres).toEqual({ ...c, statut: 'vu' });
    await lotDe(b, NOW + 2 * HEURE);
    expect(b.envoyes).toHaveLength(1);
  });
});

// --- Un secret ne fuit jamais -----------------------------------------------------------------

describe('bout en bout avec un faux ghp_', () => {
  it('le secret n’apparaît nulle part : KV, lot, journal, messages, logs', async () => {
    const logs: string[] = [];
    for (const m of ['log', 'error', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [
      commit('a1', [fichier('src/config.ts', patch('export const conf = {', `  github: '${GHP}',`, '};'))], `ajoute la config ${GHP}`),
      commit('a2', [fichier('.env', patch(`GITHUB_TOKEN=${GHP}`), 'added')]),
    ] }]);
    const lot = await lotDe(b);
    const rendu = JSON.stringify(lot);
    expect(rendu).not.toContain(GHP);
    expect(rendu).toContain('[clé GitHub masquée]');
    expect(fichiersDe(lot, 'a', 'a1')[0].patch).toContain("  github: '[clé GitHub masquée]',");
    expect(lot.projets[0].commits[0].message).toBe('ajoute la config [clé GitHub masquée]');
    const constats = await lireConstats(b.kv);
    expect(constats.find(c => c.fichier === '(message du commit)')).toMatchObject({ gravite: 'grave', source: 'serveur' });
    // l'IA recopie le secret par mégarde : masqué avant stockage
    await ecrireRapport(b.kv, rapportComplet(lot, [avis({ fichier: 'src/config.ts', ligne: 2, gravite: 'grave', quoi: `la clé ${GHP} est en clair` })]), b.deps, NOW + HEURE + MIN);
    await preparerLot(b.kv, b.deps, NOW + 2 * HEURE);
    for (const lieu of [b.ecrits.join('\n'), JSON.stringify(await journal(b.kv)), b.envoyes.join('\n'), logs.join('\n'), JSON.stringify(await lireConstats(b.kv))]) {
      expect(lieu).not.toContain(GHP);
      expect(lieu).not.toContain(GHP.slice(4, 20));
    }
    expect(b.envoyes.join('\n')).toContain('clé GitHub poussée par erreur');
  });
});

// --- Les actions de la route ------------------------------------------------------------------

describe('traiterActionLea', () => {
  it('a-relire en GET, rapport en POST, sinon refus', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const r = (await traiterActionLea(b.kv, 'a-relire', undefined, b.deps, NOW + HEURE)) as { lot: Lot };
    expect(r.lot.projets).toHaveLength(1);
    await expect(traiterActionLea(b.kv, 'rapport', undefined, b.deps, NOW + HEURE)).rejects.toMatchObject({ code: 405 });
    await expect(traiterActionLea(b.kv, 'a-relire', {}, b.deps, NOW + HEURE)).rejects.toMatchObject({ code: 405 });
    await expect(traiterActionLea(b.kv, 'autre', undefined, b.deps, NOW + HEURE)).rejects.toMatchObject({ code: 404 });
    expect(await traiterActionLea(b.kv, 'rapport', rapportComplet(r.lot), b.deps, NOW + HEURE + MIN)).toMatchObject({ ok: true });
  });

  it('les clés Upstash de Léa', () => {
    expect(CLES_LEA.vu(D('qg'))).toBe('lea:vu:mon-compte/qg');
    expect([CLES_LEA.lot, CLES_LEA.constats, CLES_LEA.relectures, CLES_LEA.passage, CLES_LEA.envoyes]).toEqual(['lea:lot', 'lea:constats', 'lea:relectures', 'lea:passage', 'lea:envoyes']);
  });
});

// --- Revue finale : chaque point corrigé --------------------------------------------------------

const tentativeDe = async (kv: KV) => JSON.parse((await kv.hgetall(CLES_LEA.tentative)).json ?? 'null');

describe('I1 · un rapport partiel n’est jamais un passage complet', () => {
  const deuxProjets = () => apresPremierPassage([
    { nom: 'a', nouveaux: [commit('a1'), commit('a2', [fichier('src/b.ts')])] },
    { nom: 'b', nouveaux: [commit('b1')] },
  ]);

  it('« projets » vide alors que le lot a des projets → 422, rien n’avance', async () => {
    const b = await deuxProjets();
    const lot = await lotDe(b);
    await expect(ecrireRapport(b.kv, { lot: lot.id, projets: [], constats: [] }, b.deps, NOW + HEURE + MIN)).rejects.toMatchObject({ code: 422 });
    expect(await lireMarque(b.kv, D('a'))).toBe('a0');
    expect(await dernierPassage(b.kv)).toBe(NOW);
  });

  it('un projet laissé de côté : le relu avance, mais pas de passage complet ; l’essai dit « relu en partie »', async () => {
    const b = await deuxProjets();
    const lot = await lotDe(b);
    await ecrireRapport(b.kv, { lot: lot.id, projets: [{ depot: D('a') }], constats: [] }, b.deps, NOW + HEURE + MIN);
    expect(await lireMarque(b.kv, D('a'))).toBe('a2');
    expect(await lireMarque(b.kv, D('b'))).toBe('b0');
    expect(await dernierPassage(b.kv)).toBe(NOW);
    expect(await tentativeDe(b.kv)).toEqual({ quand: NOW + HEURE + MIN, issue: 'relu en partie', nonLus: 1, depots: ['b'] });
    expect((await etatLea(b.kv)).tache).toBe('a relu 2 commits dans 1 projet, 0 point ; relu en partie : b');
  });

  it('« jusqua » avant le dernier commit du lot : pas de passage complet', async () => {
    const b = await deuxProjets();
    const lot = await lotDe(b);
    await ecrireRapport(b.kv, { lot: lot.id, projets: [{ depot: D('a'), jusqua: 'a1' }, { depot: D('b') }], constats: [] }, b.deps, NOW + HEURE + MIN);
    expect(await dernierPassage(b.kv)).toBe(NOW);
    expect(await tentativeDe(b.kv)).toMatchObject({ issue: 'relu en partie', depots: ['a'] });
  });

  it('tout relu jusqu’au bout : passage complet, essai « complet »', async () => {
    const b = await deuxProjets();
    const lot = await lotDe(b);
    await ecrireRapport(b.kv, { lot: lot.id, projets: [{ depot: D('a'), jusqua: 'a2' }, { depot: D('b') }], constats: [] }, b.deps, NOW + HEURE + MIN);
    expect(await dernierPassage(b.kv)).toBe(NOW + HEURE + MIN);
    expect(await tentativeDe(b.kv)).toEqual({ quand: NOW + HEURE + MIN, issue: 'complet', nonLus: 0, depots: [] });
  });
});

describe('I2 · le dernier essai est gardé (lea:tentative) et l’erreur journalisée', () => {
  it('projets illisibles : noms courts seulement, journalisé une fois tant que ça ne change pas', async () => {
    const b = await apresPremierPassage([{ nom: 'app_livraison', nouveaux: [commit('c1')] }, { nom: 'qg', nouveaux: [commit('q1')] }]);
    b.depots[0].panne = true;
    b.depots[1].panne = true;
    expect(await preparerLot(b.kv, b.deps, NOW + HEURE)).toEqual({ lot: null });
    expect(await tentativeDe(b.kv)).toEqual({ quand: NOW + HEURE, issue: 'projets illisibles', nonLus: 2, depots: ['app_livraison', 'qg'] });
    await preparerLot(b.kv, b.deps, NOW + 2 * HEURE);
    const erreurs = (await journal(b.kv)).filter(e => e.agent === 'lea' && e.statut === 'erreur');
    expect(erreurs.map(e => e.texte)).toEqual(['n\'a pas pu lire 2 projets : app_livraison, qg']);
    expect(JSON.stringify(erreurs)).not.toContain(PROPRIO);
    // GitHub revient : l'essai redevient complet
    b.depots[0].panne = undefined;
    b.depots[1].panne = undefined;
    const lot = await lotDe(b, NOW + 3 * HEURE);
    await ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + 3 * HEURE + MIN);
    expect(await tentativeDe(b.kv)).toMatchObject({ issue: 'complet' });
  });

  it('lot remis il y a plus de 50 min sans rapport : « lot remis sans rapport », journalisé', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    await lotDe(b);
    await lotDe(b, NOW + HEURE + 51 * MIN);
    expect(await tentativeDe(b.kv)).toEqual({ quand: NOW + HEURE + 51 * MIN, issue: 'lot remis sans rapport', nonLus: 1, depots: ['a'] });
    expect((await journal(b.kv)).some(e => e.agent === 'lea' && e.statut === 'erreur' && e.texte === 'lot remis sans rapport')).toBe(true);
  });

  it('rapport refusé (422) : l’essai le dit, le lot reste remis et peut être corrigé', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const lot = await lotDe(b);
    await expect(ecrireRapport(b.kv, rapportComplet(lot, [avis({ gravite: 'critique' })]), b.deps, NOW + HEURE + MIN)).rejects.toMatchObject({ code: 422 });
    expect(await tentativeDe(b.kv)).toMatchObject({ issue: 'rapport refusé', depots: ['a'] });
    expect(await ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + HEURE + 2 * MIN)).toMatchObject({ ok: true });
    expect(await tentativeDe(b.kv)).toMatchObject({ issue: 'complet' });
  });

  it('un rapport rejoué (409) n’écrit rien, pas même l’essai', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const lot = await lotDe(b);
    await ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + HEURE + MIN);
    const avant = await tentativeDe(b.kv);
    await expect(ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + HEURE + 2 * MIN)).rejects.toMatchObject({ code: 409 });
    expect(await tentativeDe(b.kv)).toEqual(avant);
  });
});

describe('I5 · fichiers de clé : jamais envoyés, toujours fouillés', () => {
  const CORPS = 'MIIE'.repeat(16);
  const cle = patch('-----BEGIN ' + 'PRIVATE KEY-----', CORPS, '-----END ' + 'PRIVATE KEY-----');

  it('clé .pem ajoutée : différence jamais envoyée, note, constat grave à la ligne de la clé (un seul)', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [fichier('certs/serveur.pem', cle, 'added'), fichier('src/a.ts')])] }]);
    const lot = await lotDe(b);
    const f = fichiersDe(lot, 'a', 'a1').find(x => x.chemin === 'certs/serveur.pem')!;
    expect(f).toEqual({ chemin: 'certs/serveur.pem', statut: 'added', enPartie: 'non fourni', note: 'non envoyé : fichier de clé' });
    expect(JSON.stringify(lot)).not.toContain(CORPS);
    expect((await lireConstats(b.kv)).map(c => [c.fichier, c.ligne, c.quoi])).toEqual([['certs/serveur.pem', 1, 'clé privée poussée par erreur']]);
  });

  it('fichier de clé sans différence lisible (.p12, id_rsa) ajouté : constat « clé privée » sans ligne ; une clé publique : rien', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [
      fichier('android/release.p12', null, 'added'), fichier('.ssh/id_rsa', patch('xx'), 'added'), fichier('.ssh/id_rsa.pub', patch('ssh-rsa AAAA moi'), 'added'),
      fichier('src/a.ts'),
    ])] }]);
    const lot = await lotDe(b);
    expect(fichiersDe(lot, 'a', 'a1').filter(x => x.note === 'non envoyé : fichier de clé').map(x => x.chemin)).toEqual(['android/release.p12', '.ssh/id_rsa']);
    expect((await lireConstats(b.kv)).map(c => [c.fichier, c.ligne, c.gravite]).sort()).toEqual([['.ssh/id_rsa', null, 'grave'], ['android/release.p12', null, 'grave']]);
  });

  it('.key de Keynote (sans différence) : pas d’alerte ; .key texte : alerte seulement si une clé y est trouvée', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [
      fichier('docs/presentation.key', null, 'added'), fichier('notes/liste.key', patch('rien de secret'), 'added'), fichier('certs/vrai.key', cle, 'added'), fichier('src/a.ts'),
    ])] }]);
    const lot = await lotDe(b);
    expect(fichiersDe(lot, 'a', 'a1').filter(x => x.note === 'non envoyé : fichier de clé').map(x => x.chemin)).toEqual(['docs/presentation.key', 'notes/liste.key', 'certs/vrai.key']);
    expect((await lireConstats(b.kv)).map(c => [c.fichier, c.ligne])).toEqual([['certs/vrai.key', 1]]);
  });

  it('un certificat .pem lisible (sans clé privée) n’est pas une alerte', async () => {
    const cert = patch('-----BEGIN CERTIFICATE-----', CORPS, '-----END CERTIFICATE-----');
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [fichier('certs/ca.pem', cert, 'added'), fichier('src/a.ts')])] }]);
    await lotDe(b);
    expect(await lireConstats(b.kv)).toEqual([]);
  });
});

describe('M1 · Telegram : lignes courtes, plusieurs messages, tout part', () => {
  it('60 clés du serveur : toutes envoyées dans le même passage, en plusieurs messages, titre « (suite) », lien dans chacun', async () => {
    const lignes = Array.from({ length: 60 }, (_, i) => `const k${i} = '${GHP.slice(0, -2)}${String(i).padStart(2, '0')}';`);
    const long = 'src/' + 'dossier-tres-long/'.repeat(12) + 'cles.ts';
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [fichier(long, patch(...lignes))])] }]);
    await lotDe(b);
    expect(b.envoyes.length).toBeGreaterThan(1);
    expect(b.envoyes.flatMap(m => m.split('\n')).filter(l => l.startsWith('• '))).toHaveLength(60);
    for (const [i, m] of b.envoyes.entries()) {
      expect(m.length).toBeLessThanOrEqual(3800);
      expect(m.split('\n')[0]).toBe(i === 0 ? TITRE : `${TITRE} (suite)`);
      expect(m.split('\n').at(-1)).toBe(LIEN);
      for (const l of m.split('\n')) expect(l.length).toBeLessThanOrEqual(180);
    }
    expect(b.envoyes.join('\n')).not.toContain('autre');
    await preparerLot(b.kv, b.deps, NOW + 2 * HEURE);
    expect(b.envoyes.flatMap(m => m.split('\n')).filter(l => l.startsWith('• '))).toHaveLength(60); // jamais renvoyées
  });

  it('« + N autres » ne compte que les graves de l’IA non envoyés', async () => {
    const files = Array.from({ length: 7 }, (_, i) => fichier(`src/f${i}.ts`));
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [...files, fichier('src/cle.ts', patch(`k = '${GHP}'`))])] }]);
    const lot = await lotDe(b);
    b.envoyes.length = 0;
    b.panne.telegram = 0;
    const graves = files.map((f, i) => avis({ fichier: f.filename, gravite: 'grave', quoi: `faille ${i}` }));
    await ecrireRapport(b.kv, rapportComplet(lot, graves), b.deps, NOW + HEURE + MIN);
    expect(b.envoyes).toHaveLength(1);
    expect(b.envoyes[0]).toContain('+ 2 autres dans le bureau');
  });
});

describe('M3 · « Vu » jamais perdu, jamais envoyé', () => {
  it('un grave marqué « Vu » avant l’envoi ne part pas ; le constat reste « vu »', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const lot = await lotDe(b);
    b.panne.telegram = 1;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await ecrireRapport(b.kv, rapportComplet(lot, [avis({ gravite: 'grave' })]), b.deps, NOW + HEURE + MIN);
    const c = (await lireConstats(b.kv))[0];
    await marquerVu(b.kv, c.id);
    await preparerLot(b.kv, b.deps, NOW + 2 * HEURE);
    expect(b.envoyes).toEqual([]);
    expect((await lireConstats(b.kv))[0].statut).toBe('vu');
  });
});

describe('M4 · un constat de l’IA nomme un fichier dont la différence a été envoyée', () => {
  it('fichier .env, renommé ou trop lourd pour le lot : refusé (422)', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [
      fichier('.env', patch('X=1'), 'added'), fichier('src/vieux.ts', null, 'renamed'), fichier('src/a.ts'),
    ])] }]);
    const lot = await lotDe(b);
    for (const f of ['.env', 'src/vieux.ts']) {
      await expect(ecrireRapport(b.kv, rapportComplet(lot, [avis({ fichier: f })]), b.deps, NOW + HEURE + MIN)).rejects.toMatchObject({ code: 422 });
    }
    expect(await ecrireRapport(b.kv, rapportComplet(lot, [avis()]), b.deps, NOW + HEURE + MIN)).toMatchObject({ ok: true, constats: 1 });
  });

  it('fichier retiré du lot faute de place (« trop gros ») : refusé aussi', async () => {
    const files = Array.from({ length: 5 }, (_, i) => fichier(`src/f${i}.ts`, code(String(i).repeat(39 * KO))));
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', files)] }]);
    const lot = await lotDe(b);
    await expect(ecrireRapport(b.kv, rapportComplet(lot, [avis({ fichier: 'src/f4.ts' })]), b.deps, NOW + HEURE + MIN)).rejects.toMatchObject({ code: 422 });
    expect(await ecrireRapport(b.kv, rapportComplet(lot, [avis({ fichier: 'src/f0.ts' })]), b.deps, NOW + HEURE + MIN)).toMatchObject({ ok: true });
  });
});

describe('M5 · rien à relire : le serveur accepte le lot lui-même', () => {
  it('que des .env, verrous et renommages : pas de lot, relecture gardée, marque-page avancé, passage complet, journal', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1', [fichier('.env', patch(`API_SECRET=${ENV_SECRET}`), 'added'), fichier('yarn.lock'), fichier('src/v.ts', null, 'renamed')])] }]);
    expect(await preparerLot(b.kv, b.deps, NOW + HEURE)).toEqual({ lot: null });
    expect(await lireMarque(b.kv, D('a'))).toBe('a1');
    expect(await dernierPassage(b.kv)).toBe(NOW + HEURE);
    expect((await lireRelectures(b.kv))[0]).toMatchObject({ depot: D('a'), commits: [{ sha: 'a1', message: 'message a1' }], enPartie: ['.env'] });
    expect(await tentativeDe(b.kv)).toMatchObject({ issue: 'complet' });
    expect((await journal(b.kv)).find(e => e.agent === 'lea')).toMatchObject({ statut: 'termine', texte: 'a relu 1 commit dans 1 projet, 2 points' });
    expect(await b.kv.hgetall(CLES_LEA.lot)).toEqual({}); // aucun lot remis
    expect(b.envoyes).toHaveLength(1); // les clés du .env sont envoyées
  });

  it('un lot remis puis périmé est remplacé : son rapport tardif est refusé (409)', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const lot = await lotDe(b);
    b.depots[0].chaine[1] = commit('a1', [fichier('yarn.lock')]); // même commit, désormais sans code à relire
    expect(await preparerLot(b.kv, b.deps, NOW + 2 * HEURE)).toEqual({ lot: null });
    await expect(ecrireRapport(b.kv, rapportComplet(lot), b.deps, NOW + 2 * HEURE + MIN)).rejects.toMatchObject({ code: 409 });
  });
});

describe('M8 · les adresses écrites par l’IA ne sont jamais cliquables', () => {
  it('https:// et http:// deviennent hxxps:// et hxxp://, en KV et sur Telegram', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const lot = await lotDe(b);
    await ecrireRapport(b.kv, rapportComplet(lot, [avis({ gravite: 'grave', quoi: 'envoie les données vers https://pirate.exemple/x', conseil: 'retirer l’appel à HTTP://autre.exemple' })]), b.deps, NOW + HEURE + MIN);
    const c = (await lireConstats(b.kv))[0];
    expect(c.quoi).toBe('envoie les données vers hxxps://pirate.exemple/x');
    expect(c.conseil).toBe('retirer l’appel à hxxp://autre.exemple');
    expect(b.envoyes.join('\n')).not.toMatch(/https?:\/\/pirate/);
  });
});

describe('M10 · le verrou n’est effacé que par celui qui l’a posé', () => {
  it('verrou expiré puis repris par un autre passage : la fin du premier n’y touche pas', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [commit('a1')] }]);
    const lu = b.deps.fetch;
    let repris = false;
    const deps: DepsLea = {
      ...b.deps,
      fetch: (async (u: string | URL | Request, i?: RequestInit) => {
        if (!repris) {
          repris = true;
          await b.kv.del(CLES_LEA.verrou); // le verrou du premier passage expire…
          await b.kv.setnx(CLES_LEA.verrou, 'autre-passage', 280); // …et un autre passage le prend
        }
        return lu(u, i);
      }) as typeof fetch,
    };
    await preparerLot(b.kv, deps, NOW + HEURE);
    expect(await b.kv.get(CLES_LEA.verrou)).toBe('autre-passage');
  });

  it('le verrou porte un jeton au hasard et disparaît à la fin', async () => {
    const b = await apresPremierPassage([{ nom: 'a', nouveaux: [] }]);
    const poses = b.ecrits.filter((_, i, l) => l[i - 1] === CLES_LEA.verrou);
    expect(new Set(poses).size).toBe(poses.length);
    expect(poses.every(v => v.length >= 16)).toBe(true);
    expect(await b.kv.get(CLES_LEA.verrou)).toBeNull();
  });
});
