import { createHash } from 'node:crypto';
import { memoire, type KV } from '../memoire';
import type { DepsPaul } from './lot';

// Aide de test : un faux GitHub pour Paul (lecture et écriture), sans réseau. Chaque dépôt a une chaîne de commits et
// ses fichiers à la tête ; un PUT sur contents vérifie le sha comme GitHub (409 si le fichier a changé depuis).

export const PROPRIO = 'mon-compte';
export const D = (nom: string) => `${PROPRIO}/${nom}`;
export const JOUR = 86_400_000;
export const HEURE = 3_600_000;
/** Jeudi 12 novembre 2026, 18:00 UTC. */
export const NOW = Date.UTC(2026, 10, 12, 18, 0);
// Faux secrets, toujours par concaténation (jamais une vraie forme d'un seul tenant dans le code).
export const GHP = 'ghp' + '_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
export const ENV_SECRET = 'S3cr3t' + 'ValeurQuiFuit' + '42';
export const JETON_ECRITURE = 'jeton' + '-ecriture-' + 'secret';
export const CLE_GOOGLE = 'AIza' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q';
export const MOT_DE_PASSE = 'mot' + 'de' + 'passe' + '42';

export type FauxCommit = { sha: string; message?: string; date?: number; fichiers?: string[] };
/** `arbrePanne` : l'arborescence ne se lit pas ; `compare` : la comparaison répond « behind » ou « identical » quoi qu'il arrive. */
export type FauxDepot = { nom: string; chaine: FauxCommit[]; fichiers: Record<string, string>; panne?: true; arbrePanne?: true; compare?: 'behind' | 'identical'; fork?: true };
export type Ecriture = { depot: string; chemin: string; corps: { message: string; content: string; sha?: string; branch?: string }; jeton: string };

export const blob = (texte: string) => createHash('sha1').update(texte).digest('hex');
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const b64 = (t: string) => Buffer.from(t, 'utf8').toString('base64');

export function fauxGitHub(depots: FauxDepot[]) {
  const blobs = new Map<string, string>();
  const ecritures: Ecriture[] = [];
  const appels: string[] = [];
  for (const d of depots) for (const t of Object.values(d.fichiers)) blobs.set(blob(t), t);
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    appels.push(u);
    const h = (init?.headers ?? {}) as Record<string, string>;
    if (u.includes('/user/repos')) return json(depots.map(d => ({ full_name: D(d.nom), archived: false, fork: d.fork === true, pushed_at: new Date(NOW - JOUR).toISOString() })));
    const m = /\/repos\/mon-compte\/([^/?]+)(.*)$/.exec(u);
    const d = m && depots.find(x => x.nom === m[1]);
    if (!m || !d) return new Response('', { status: 404 });
    if (d.panne) return new Response('', { status: 500 });
    const reste = m[2];
    const tete = d.chaine.at(-1)?.sha;
    for (const t of Object.values(d.fichiers)) blobs.set(blob(t), t);
    if (init?.method === 'PUT') {
      const chemin = decodeURIComponent(/^\/contents\/([^?]+)$/.exec(reste)![1]);
      const corps = JSON.parse(String(init.body)) as Ecriture['corps'];
      ecritures.push({ depot: D(d.nom), chemin, corps, jeton: (h.Authorization ?? '').replace(/^Bearer /, '') });
      const actuel = d.fichiers[chemin];
      if (actuel !== undefined && corps.sha !== blob(actuel)) return json({ message: 'does not match' }, 409);
      if (actuel === undefined && corps.sha) return json({ message: 'not found' }, 422);
      if (actuel !== undefined && !corps.sha) return json({ message: 'sha wasn\'t supplied' }, 422);
      const texte = Buffer.from(corps.content, 'base64').toString('utf8');
      d.fichiers[chemin] = texte;
      blobs.set(blob(texte), texte);
      const sha = blob(`commit:${chemin}:${texte}`);
      d.chaine.push({ sha, message: corps.message, date: NOW, fichiers: [chemin] });
      return json({ content: { sha: blob(texte) }, commit: { sha, html_url: `https://github.com/${D(d.nom)}/commit/${sha}` } }, actuel === undefined ? 201 : 200);
    }
    if (reste === '') return json({ default_branch: 'main' });
    if (reste === '/branches/main') return tete ? json({ commit: { sha: tete } }) : new Response('', { status: 404 });
    const brut = (c: FauxCommit) => ({ sha: c.sha, commit: { message: c.message ?? `message ${c.sha}`, author: { date: new Date(c.date ?? NOW - HEURE).toISOString() } } });
    const cmp = /^\/compare\/([^.]+)\.\.\.main\?per_page=100$/.exec(reste);
    if (cmp) {
      const i = d.chaine.findIndex(c => c.sha === decodeURIComponent(cmp[1]));
      if (i < 0) return new Response('', { status: 404 });
      if (d.compare) return json({ status: d.compare, total_commits: 0, commits: [] });
      const apres = d.chaine.slice(i + 1);
      return json({ status: apres.length ? 'ahead' : 'identical', total_commits: apres.length, commits: apres.slice(0, 100).map(brut) });
    }
    const liste = /^\/commits\?sha=main(?:&since=([^&]+))?&per_page=100$/.exec(reste);
    if (liste) {
      const depuis = liste[1] ? Date.parse(decodeURIComponent(liste[1])) : -Infinity;
      return json([...d.chaine].reverse().filter(c => (c.date ?? NOW - HEURE) >= depuis).slice(0, 100).map(brut));
    }
    const un = /^\/commits\/([^/?]+)$/.exec(reste);
    if (un) {
      const c = d.chaine.find(x => x.sha === decodeURIComponent(un[1]));
      if (!c) return new Response('', { status: 404 });
      return json({ ...brut(c), files: (c.fichiers ?? ['src/a.ts']).map(filename => ({ filename, status: 'modified', patch: '@@ -1 +1 @@\n+x' })) });
    }
    const contenu = /^\/contents\/([^?]+)\?ref=/.exec(reste);
    if (contenu) {
      const chemin = decodeURIComponent(contenu[1]);
      const t = d.fichiers[chemin];
      if (t === undefined) return new Response('', { status: 404 });
      if (h.Accept === 'application/vnd.github.raw') return new Response(t);
      return json({ type: 'file', sha: blob(t), encoding: 'base64', content: b64(t), size: t.length });
    }
    if (/^\/git\/trees\//.test(reste)) {
      if (d.arbrePanne) return new Response('', { status: 500 });
      const dossiers = new Set<string>();
      for (const p of Object.keys(d.fichiers)) { const x = p.split('/'); for (let i = 1; i < x.length; i++) dossiers.add(x.slice(0, i).join('/')); }
      return json({ tree: [...[...dossiers].map(path => ({ path, type: 'tree' })), ...Object.keys(d.fichiers).map(path => ({ path, type: 'blob' }))] });
    }
    const b = /^\/git\/blobs\/([0-9a-f]+)$/.exec(reste);
    if (b) {
      const t = blobs.get(b[1]);
      return t === undefined ? new Response('', { status: 404 }) : json({ sha: b[1], encoding: 'base64', content: b64(t) });
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: f, ecritures, appels };
}

/** Une mémoire qui note tout ce qui y est écrit (pour vérifier qu'aucun secret n'y entre). */
export function memoireEspionne() {
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

export type Message = { texte: string; boutons?: { texte: string; donnee: string }[][] };

export function banc(depots: FauxDepot[], o: { jeton?: string | null } = {}) {
  const { kv, ecrits } = memoireEspionne();
  const gh = fauxGitHub(depots);
  const messages: Message[] = [];
  const panne = { telegram: false };
  const envoyer = async (texte: string, boutons?: Message['boutons']) => {
    if (panne.telegram) throw new Error('Telegram ne répond pas');
    messages.push({ texte, boutons });
  };
  const deps: DepsPaul = { fetch: gh.fetch, envoyer, jeton: o.jeton === null ? undefined : (o.jeton ?? 'jeton-lecture'), echeance: 5_000 };
  return { kv, ecrits, gh, messages, deps, depots, panne, ecriture: { fetch: gh.fetch, jeton: JETON_ECRITURE } };
}

export const README = ['# Mon projet', '', 'Une appli.', '', '## Lancer', '', '```', 'npm run dev', '```', '', '## Notes', '', 'Écrit par le patron.'].join('\n') + '\n';
export const CLAUDE = ['# Projet', '@AGENTS.md', '', 'Mes règles à moi : ne pas toucher.', ''].join('\n');

/** Un dépôt ordinaire : un vieux commit (il y a 10 jours) puis `n` commits de la semaine. */
export function depot(nom: string, n = 2, fichiers: Record<string, string> = {}): FauxDepot {
  return {
    nom,
    chaine: [{ sha: blob(`${nom}-vieux`), date: NOW - 10 * JOUR }, ...Array.from({ length: n }, (_, i) => ({ sha: blob(`${nom}-${i}`), date: NOW - (n - i) * HEURE, message: `Ajoute la partie ${i}`, fichiers: [`src/partie${i}.ts`] }))],
    fichiers: { 'README.md': README, 'CLAUDE.md': CLAUDE, 'package.json': JSON.stringify({ scripts: { dev: 'next dev', test: 'vitest run' } }), 'src/index.ts': 'x', ...fichiers },
  };
}
