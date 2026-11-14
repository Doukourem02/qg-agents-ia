import { describe, expect, it, vi } from 'vitest';
import { memoire } from '../memoire';
import { CLES_LIGHT, calculerReleve, contientNomInterdit, etiquetteDe, jourDe, nomsInterdits, releveDuJour } from './releve';

const NOW = Date.parse('2026-11-09T00:00:00Z');
const jours = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const json = (o: unknown, init?: ResponseInit) => new Response(JSON.stringify(o), init);
const LISTE = 'https://api.github.com/user/repos?affiliation=owner&per_page=100';
const arbre = (d: string) => `https://api.github.com/repos/${d}/git/trees/HEAD?recursive=1`;
const contenu = (d: string, p: string) => `https://api.github.com/repos/${d}/contents/${p}`;
const npm = (p: string) => `https://registry.npmjs.org/${encodeURIComponent(p)}/latest`;

function faux(table: Record<string, Response | (() => Response)>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const r = table[String(input)];
    if (!r) return new Response('nope', { status: 404 });
    return typeof r === 'function' ? r() : r.clone();
  }) as unknown as typeof fetch;
}
const pkg = (o: object) => new Response(JSON.stringify(o));

const base = () => ({
  [LISTE]: json([
    { full_name: 'moi/livreo', archived: false, pushed_at: jours(1) },
    { full_name: 'moi/terra', archived: false, pushed_at: jours(2) },
  ]),
  [arbre('moi/livreo')]: json({ tree: [{ path: 'package.json', type: 'blob' }] }),
  [arbre('moi/terra')]: json({ tree: [{ path: 'package.json', type: 'blob' }] }),
  [contenu('moi/livreo', 'package.json')]: pkg({ dependencies: { expo: '~55.0.0' } }),
  [contenu('moi/terra', 'package.json')]: pkg({ name: 'terra', dependencies: { expo: '~58.0.14' } }),
  [npm('expo')]: json({ version: '58.0.19' }),
});
const jetons = { perso: 'p', pro: 'q' };

describe('calculerReleve', () => {
  it('une ligne par fichier, alerte de retard avec vrai nom puis texte anonyme', async () => {
    const kv = memoire();
    const r = await calculerReleve(kv, { fetch: faux(base()), jetons: { perso: 'p' } }, NOW);
    expect(r.lignes).toHaveLength(2);
    const a = r.alertes.find(x => x.cle === 'retard:moi/livreo:package.json:expo:55')!;
    expect(a.texte).toContain('livreo');
    expect(a.texteAnonyme.toLowerCase()).not.toContain('livreo');
    expect(a.texteAnonyme.toLowerCase()).not.toContain('terra');
    expect(r.alertes.some(x => x.type === 'majeure')).toBe(false);
    const sortie = JSON.stringify([r.lignes.map(l => l.etiquette), r.alertes.map(x => x.texteAnonyme)]);
    for (const n of r.nomsInterdits) expect(sortie.toLowerCase()).not.toContain(n);
    expect(await releveDuJour(kv, jourDe(NOW))).toMatchObject({ jour: '2026-11-09' });
  });

  it('étiquettes stables même quand un dépôt disparaît', async () => {
    const kv = memoire();
    const deps = { fetch: faux(base()), jetons: { perso: 'p' } };
    const r1 = await calculerReleve(kv, deps, NOW);
    expect(r1.lignes.find(l => l.depot === 'moi/livreo')!.etiquette).toBe('projet A');
    expect(r1.lignes.find(l => l.depot === 'moi/terra')!.etiquette).toBe('projet B');
    const t = base();
    t[LISTE] = json([{ full_name: 'moi/terra', archived: false, pushed_at: jours(2) }]);
    const r2 = await calculerReleve(kv, { fetch: faux(t), jetons: { perso: 'p' } }, NOW + 86_400_000);
    expect(r2.lignes.map(l => l.etiquette)).toEqual(['projet B']);
    expect(await etiquetteDe(kv, 'moi/livreo')).toBe('projet A');
    expect(await etiquetteDe(kv, 'moi/neuf')).toBe('projet C');
  });

  it('une clé déjà envoyée disparaît des alertes, la ligne reste', async () => {
    const kv = memoire();
    await kv.hset(CLES_LIGHT.alertes, 'retard:moi/livreo:package.json:expo:55', '2026-11-08');
    const r = await calculerReleve(kv, { fetch: faux(base()), jetons: { perso: 'p' } }, NOW);
    expect(r.alertes).toHaveLength(0);
    expect(r.lignes).toHaveLength(2);
  });

  it('jeton pro absent : compte non suivi (choix), pas signalé ; perso relevé', async () => {
    const r = await calculerReleve(memoire(), { fetch: faux(base()), jetons: { perso: 'p' } }, NOW);
    expect(r.comptesNonLus).toEqual([]);
    expect(r.lignes.length).toBeGreaterThan(0);
  });

  it('GitHub injoignable pour un compte : compte non lu', async () => {
    const t = base(); delete (t as Record<string, unknown>)[LISTE];
    const r = await calculerReleve(memoire(), { fetch: faux(t), jetons }, NOW);
    expect(r.comptesNonLus).toEqual(['perso', 'pro']);
  });

  it('dépôt dont la lecture échoue : aucune ligne ni alerte', async () => {
    const t = base(); delete (t as Record<string, unknown>)[arbre('moi/livreo')];
    const r = await calculerReleve(memoire(), { fetch: faux(t), jetons: { perso: 'p' } }, NOW);
    expect(r.lignes.every(l => l.depot === 'moi/terra')).toBe(true);
    expect(r.alertes.some(a => a.cle.includes('livreo'))).toBe(false);
  });

  it('Node 20 dont le cycle finit avant 90 jours : alerte fin:nodejs:20', async () => {
    const t = {
      ...base(),
      [contenu('moi/livreo', 'package.json')]: pkg({ engines: { node: '>=20' } }),
      'https://endoflife.date/api/nodejs.json': json([{ cycle: '20', eol: '2026-04-30' }, { cycle: '24', eol: '2028-04-30' }]),
    };
    const r = await calculerReleve(memoire(), { fetch: faux(t), jetons: { perso: 'p' } }, NOW);
    const a = r.alertes.find(x => x.cle === 'fin:nodejs:20')!;
    expect(a.type).toBe('fin');
    expect(a.texteAnonyme.toLowerCase()).not.toContain('livreo');
  });

  it('majeure : nouveau majeur sorti pour un outil utilisé, une seule alerte', async () => {
    const t = { ...base(), [npm('expo')]: json({ version: '59.0.0' }) };
    const r = await calculerReleve(memoire(), { fetch: faux(t), jetons: { perso: 'p' } }, NOW);
    expect(r.alertes.filter(a => a.cle === 'majeure:expo:59')).toHaveLength(1);
  });

  it('garde les 8 derniers jours', async () => {
    const kv = memoire();
    const deps = { fetch: faux(base()), jetons: { perso: 'p' } };
    for (let i = 0; i < 10; i++) await calculerReleve(kv, deps, NOW + i * 86_400_000);
    expect(Object.keys(await kv.hgetall(CLES_LIGHT.releves))).toHaveLength(8);
    expect(await releveDuJour(kv, '2026-11-09')).toBeNull();
    expect(await releveDuJour(kv, '2026-11-18')).not.toBeNull();
  });
});

describe('calculerReleve : échéance et rejeu', () => {
  it('échéance passée après la liste : le reste est sauté, rien n\'est inventé', async () => {
    const fin = new AbortController();
    const f0 = faux(base());
    const f = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      const r = await f0(u, init);
      if (String(u) === LISTE) fin.abort();
      return r;
    }) as unknown as typeof fetch;
    const r = await calculerReleve(memoire(), { fetch: f, jetons: { perso: 'p' }, echeance: fin.signal }, NOW);
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.lignes).toEqual([]);
    expect(r.alertes).toEqual([]);
  });

  it('relevé refait le même jour : résumé et choix gardés, alertes envoyées aujourd\'hui gardées', async () => {
    const kv = memoire();
    const deps = { fetch: faux(base()), jetons: { perso: 'p' } };
    const r1 = await calculerReleve(kv, deps, NOW);
    const cle = 'retard:moi/livreo:package.json:expo:55';
    expect(r1.alertes.map(a => a.cle)).toContain(cle);
    await kv.hset(CLES_LIGHT.releves, '2026-11-09', JSON.stringify({ ...r1, resume: 'Un retard.', choix: [{ titre: 'T', url: 'https://a.fr', pourquoi: 'p' }] }));
    await kv.hset(CLES_LIGHT.alertes, cle, String(NOW + 3600_000));
    const r2 = await calculerReleve(kv, deps, NOW + 2 * 3600_000);
    expect(r2.resume).toBe('Un retard.');
    expect(r2.choix).toHaveLength(1);
    expect(r2.alertes.map(a => a.cle)).toContain(cle);
    expect((await releveDuJour(kv, '2026-11-09'))!.resume).toBe('Un retard.');
    // Le lendemain, la clé envoyée la veille disparaît et le résumé n'est pas repris.
    const r3 = await calculerReleve(kv, deps, NOW + 86_400_000);
    expect(r3.alertes.map(a => a.cle)).not.toContain(cle);
    expect(r3.resume).toBeUndefined();
  });
});

describe('noms interdits', () => {
  it('contientNomInterdit', () => {
    expect(contientNomInterdit('Le projet Terra avance', ['terra'])).toBe('terra');
    expect(contientNomInterdit('Projet A sur Expo 55', ['terra', 'qg'])).toBeNull();
    expect(contientNomInterdit('qgx', ['qg'])).toBeNull();
    expect(contientNomInterdit('le Boutique Shop', ['boutique-shop'])).toBe('boutique-shop');
    expect(contientNomInterdit('boutique-shop', ['boutique-shop'])).toBe('boutique-shop');
    expect(contientNomInterdit('Studio Deco', ['studio deco'])).toBe('studio deco');
  });
  it('nomsInterdits : dépôts, noms, catalogue, minuscules, ≥ 3, sans doublon', () => {
    const l = [{ depot: 'Moi/Livreo' }] as never;
    const n = nomsInterdits(l, ['Terra', 'ab', 'terra']);
    expect(n).toContain('moi/livreo'); expect(n).toContain('livreo'); expect(n).toContain('terra');
    expect(n).toContain('boutique stores');
    expect(n).not.toContain('ab');
    expect(new Set(n).size).toBe(n.length);
  });
  it('nomsInterdits : morceaux de 4 lettres et plus, sans les mots génériques', () => {
    const n = nomsInterdits([], ['moi/fitcoach-app', 'moi/web', '@moi/payeQuick', 'moi/super_admin.site']);
    expect(contientNomInterdit('Le fitcoach avance', n)).not.toBeNull();
    expect(contientNomInterdit('PayeQuick et quick', n)).not.toBeNull();
    expect(contientNomInterdit('le côté super', n)).not.toBeNull();
    expect(n).toContain('fitcoach-app');
    expect(n).not.toContain('app');
    expect(n).not.toContain('web');
    expect(n).not.toContain('admin');
    expect(n).not.toContain('site');
    expect(contientNomInterdit('Une app web pour le site, côté admin', n)).toBeNull();
  });
  it('nomsInterdits : un morceau qui est un outil suivi n\'est pas interdit (paquets de monorepo)', () => {
    const n = nomsInterdits([], ['@repo/typescript-config', '@repo/eslint-config', 'moi/tailwindcss-kit']);
    expect(contientNomInterdit('typescript 6 est sorti.', n)).toBeNull();
    expect(contientNomInterdit('tailwindcss 5 est sorti, revoir la config eslint.', n)).toBeNull();
    expect(n).toContain('@repo/typescript-config');
  });
  it('nomsInterdits : liste réelle du premier essai, mots génériques jamais interdits', () => {
    const n = nomsInterdits([], [
      'mon-compte/app_livraison', 'mon-compte/duolingo_clone', 'mon-compte/boutique-shop', 'mon-compte/mon_portfolio',
      'mon-compte/projet_terra', 'mon-compte/qg', 'projet-livreo', 'admin_livreo', 'driver_livreo', 'livreo_backend',
      'patron-portfolio', 'terra-admin', 'terra-backend', 'projet', 'driver', 'backend', 'clone', 'portfolio',
    ]);
    for (const g of ['projet', 'project', 'projects', 'backend', 'driver', 'clone', 'portfolio', 'mon', 'my', 'config']) {
      expect(n).not.toContain(g);
    }
    for (const t of ['projet A', 'projet B', 'backend', 'driver', 'portfolio']) expect(contientNomInterdit(t, n)).toBeNull();
    for (const t of ['Livreo', 'Terra', 'duolingo', 'boutique-shop', 'app_livraison']) expect(contientNomInterdit(t, n)).not.toBeNull();
    expect(contientNomInterdit(
      'TypeScript 7 est sorti : projet A et projet B ont 2 versions de retard. Fin de support de Node.js 20 sur projet A.', n,
    )).toBeNull();
  });
  it('nomsInterdits : une liste d\'entrées génériques seules ne produit rien', () => {
    const n = nomsInterdits([{ depot: 'moi/backend' }] as never, ['projet', 'Projects', 'my', 'mon']);
    for (const g of ['projet', 'projects', 'my', 'mon', 'backend', 'moi/backend']) {
      if (g !== 'moi/backend') expect(n).not.toContain(g);
    }
  });
  it('alertes : pas de retard pour une version 0.x, majeure inchangée ; expo-router jamais en alerte', async () => {
    const t = {
      ...base(),
      [contenu('moi/livreo', 'package.json')]: pkg({ dependencies: { 'react-native': '0.86.2', 'expo-router': '~6.0.23', 'drizzle-orm': '0.36.0' } }),
      [contenu('moi/terra', 'package.json')]: pkg({ name: 'terra', dependencies: { expo: '~58.0.14' } }),
      [npm('react-native')]: json({ version: '0.88.1' }),
      [npm('expo-router')]: json({ version: '58.0.30' }),
      [npm('drizzle-orm')]: json({ version: '0.45.4' }),
    };
    const r = await calculerReleve(memoire(), { fetch: faux(t), jetons: { perso: 'p' } }, NOW);
    expect(r.alertes.filter(a => a.type === 'retard')).toEqual([]);
    expect(r.alertes.some(a => a.cle.includes('expo-router'))).toBe(false);
    expect(r.lignes.some(l => l.paquet === 'expo-router' && l.ecart >= 2)).toBe(true);
    expect(r.lignes.some(l => l.paquet === 'drizzle-orm' && l.ecart >= 2)).toBe(true);
  });
  it('calculerReleve : tout dépôt de la fenêtre compte, même sans ligne', async () => {
    const t = { ...base(), [LISTE]: json([
      { full_name: 'moi/livreo', archived: false, pushed_at: jours(1) },
      { full_name: 'moi/fitcoach-app', archived: false, pushed_at: jours(1) },
    ]) };
    const r = await calculerReleve(memoire(), { fetch: faux(t), jetons: { perso: 'p' } }, NOW);
    expect(contientNomInterdit('fitcoach', r.nomsInterdits)).not.toBeNull();
    expect(r.nomsInterdits).not.toContain('app');
  });
});
