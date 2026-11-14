import { describe, expect, it, vi } from 'vitest';
import { memoire } from '../memoire';
import { Refus } from '../qg';
import { nomProjet, EXCLUS } from './projets';
import { traiterActionMafe } from './api';
import { calculerReleve, CLES_MAFE, dernierReleve, jourDe, type ReleveMafe } from './releve';

const NOW = Date.parse('2026-11-10T07:30:00Z'); // un mardi
const MARDI_LUNDI = Date.parse('2026-11-09T07:30:00Z'); // un lundi
const jours = (n: number, de = NOW) => new Date(de - n * 86_400_000).toISOString();
const B = 'https://api.github.com';
const LISTE = `${B}/user/repos?affiliation=owner&per_page=100`;

type Table = Record<string, Response | (() => Response)>;
function faux(table: Table) {
  const appels: { url: string; init?: RequestInit }[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    appels.push({ url, init });
    const r = table[url];
    if (!r) return new Response('nope', { status: 404 });
    return typeof r === 'function' ? r() : r.clone();
  }) as unknown as typeof fetch;
  return { f, appels };
}
const json = (o: unknown) => new Response(JSON.stringify(o));
const texte = (t: string) => new Response(t);
const arbre = (...chemins: string[]) => json({ tree: chemins.map((path) => ({ path, type: 'blob' })) });
const unCommit = (date: string, message: string, sha = 'abc') => ({ sha, html_url: `https://github.com/x/${sha}`, commit: { message, committer: { date } } });

/** Le monde commun : on y ajoute ce qu'il faut. */
function monde(now = NOW, extra: Table = {}, depots?: unknown[]) {
  const since = (d: string) => `${B}/repos/${d}/commits?since=${new Date(now - 7 * 86_400_000).toISOString()}&per_page=100`;
  const arbreDe = (d: string) => `${B}/repos/${d}/git/trees/HEAD?recursive=1`;
  const table: Table = {
    [LISTE]: json(depots ?? [
      { full_name: 'mon-compte/PROJET_TERRA', archived: false, pushed_at: jours(1, now) },
      { full_name: 'mon-compte/app_livraison', archived: false, pushed_at: jours(2, now) },
      { full_name: 'mon-compte/boutique-shop', archived: false, pushed_at: jours(20, now) },
      { full_name: 'mon-compte/duolingo_clone', archived: false, pushed_at: jours(1, now) },
      { full_name: 'mon-compte/ancien', archived: false, pushed_at: jours(120, now) },
      { full_name: 'mon-compte/mon_portfolio', archived: false, pushed_at: jours(50, now) },
    ]),
    // Terra : check-list avec cases et séance
    [arbreDe('mon-compte/PROJET_TERRA')]: arbre('docs/taches-humaines.md', 'docs/seances/2026-11-09.md', 'README.md'),
    [`${B}/repos/mon-compte/PROJET_TERRA/contents/docs/taches-humaines.md`]: texte('## Étape\n- [x] Acheter le domaine\n- [x] Créer le compte\n- [ ] Écrire les statuts\n- [ ] Ouvrir la banque\n'),
    [`${B}/repos/mon-compte/PROJET_TERRA/commits?path=docs/taches-humaines.md&per_page=30`]: json([
      { sha: 's2', commit: { committer: { date: '2026-11-08T10:00:00Z' } } },
      { sha: 's1', commit: { committer: { date: '2026-11-05T10:00:00Z' } } },
    ]),
    [`${B}/repos/mon-compte/PROJET_TERRA/contents/docs/taches-humaines.md?ref=s2`]: texte('## Étape\n- [x] Acheter le domaine\n- [x] Créer le compte\n- [ ] Écrire les statuts\n- [ ] Ouvrir la banque\n'),
    [`${B}/repos/mon-compte/PROJET_TERRA/contents/docs/taches-humaines.md?ref=s1`]: texte('## Étape\n- [x] Acheter le domaine\n- [ ] Créer le compte\n- [ ] Écrire les statuts\n- [ ] Ouvrir la banque\n'),
    [`${B}/repos/mon-compte/PROJET_TERRA/contents/docs/seances/2026-11-09.md`]: texte('# Séance\n\n## La suite\n- Relire les statuts\n'),
    [since('mon-compte/PROJET_TERRA')]: json([unCommit(jours(1), 'Statuts', 'c1')]),
    // Livreo : liste sans cases, plus deux fichiers à ne jamais choisir
    [arbreDe('mon-compte/app_livraison')]: arbre('docs/taches.md', 'docs/checklist_securite.md', 'docs/roadmap_produit.md'),
    [`${B}/repos/mon-compte/app_livraison/contents/docs/taches.md`]: texte('# À faire\n- **Paiement**\n- **Notifications**\n'),
    [`${B}/repos/mon-compte/app_livraison/contents/docs/checklist_securite.md`]: texte('- [ ] a\n- [ ] b\n'),
    [`${B}/repos/mon-compte/app_livraison/contents/docs/roadmap_produit.md`]: texte('- [ ] vision\n'),
    [since('mon-compte/app_livraison')]: json([]),
    // Boutique Shop : aucun fichier
    [arbreDe('mon-compte/boutique-shop')]: arbre('README.md'),
    [since('mon-compte/boutique-shop')]: json([]),
    // Portfolio en pause
    [arbreDe('mon-compte/mon_portfolio')]: arbre('README.md'),
    [since('mon-compte/mon_portfolio')]: json([]),
    ...extra,
  };
  return { table, since, arbreDe };
}

describe('projets', () => {
  it('nomme les projets et exclut les exercices', () => {
    expect(nomProjet('mon-compte/app_livraison')).toBe('Livreo');
    expect(nomProjet('mon-compte/PROJET_TERRA')).toBe('Terra');
    expect(nomProjet('mon-compte/autre')).toBe('autre');
    expect(EXCLUS).toEqual(['duolingo_clone', 'control']);
  });
});

describe('calculerReleve', () => {
  const par = (r: ReleveMafe, fin: string) => r.projets.find((p) => p.depot.endsWith(fin))!;

  it('écarte exclus et vieux dépôts, lit cases, liste, commits, séance et historique', async () => {
    const { table } = monde();
    const { f } = faux(table);
    const kv = memoire();
    const r = await calculerReleve(kv, { fetch: f, jeton: 'JET' }, NOW);
    expect(r.projets.map((p) => p.nom).sort()).toEqual(['Boutique Shop', 'Livreo', 'Portfolio', 'Terra']);

    const terra = par(r, 'PROJET_TERRA');
    expect(terra.avancement).toMatchObject({ genre: 'cases', fichier: 'docs/taches-humaines.md', faites: 2, total: 4 });
    expect(terra.avancement.genre === 'cases' && terra.avancement.derniere).toEqual({ texte: 'Créer le compte', quand: '2026-11-08T10:00:00Z' });
    expect(terra.seance).toMatchObject({ date: '2026-11-09', suite: ['Relire les statuts'] });
    expect(terra.commits).toEqual([{ date: jours(1), message: 'Statuts', url: 'https://github.com/x/c1' }]);
    expect(terra.dernierTravail).toBe(jours(1));
    expect(terra.enPause).toBe(false);
    expect(terra.ouOnSArrete).toContain('La suite');

    const livreo = par(r, 'app_livraison');
    expect(livreo.avancement).toMatchObject({ genre: 'liste', fichier: 'docs/taches.md', restantes: 2, premiere: 'Paiement' });
  });

  it('ne lit jamais checklist_securite ni roadmap, et n\'envoie le jeton qu\'à api.github.com', async () => {
    const { table } = monde();
    const { f, appels } = faux(table);
    await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, NOW);
    expect(appels.some((a) => /checklist_securite|roadmap/.test(a.url))).toBe(false);
    for (const a of appels) {
      expect(new URL(a.url).hostname).toBe('api.github.com');
      expect((a.init?.headers as Record<string, string>).Authorization).toBe('Bearer JET');
    }
  });

  it('une grosse journée : les commits de la veille sont tous lus (pages de 100)', async () => {
    const { table, since } = monde();
    const s = since('mon-compte/boutique-shop');
    const page1 = Array.from({ length: 100 }, (_, i) => unCommit(jours(0.1), 'aujourd\'hui ' + i, 'a' + i));
    const page2 = Array.from({ length: 30 }, (_, i) => unCommit(jours(1), 'hier ' + i, 'h' + i));
    table[s] = json(page1);
    table[s + '&page=2'] = json(page2);
    const { f } = faux(table);
    const r = await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, NOW);
    expect(par(r, 'boutique-shop').commits).toHaveLength(130);
    expect(r.aEcrire.find(n => n.depot.endsWith('boutique-shop'))?.commits).toHaveLength(30);
  });

  it('Boutique Shop sans fichier : commits, et la date de pousse quand rien depuis 7 jours', async () => {
    const { table } = monde();
    const { f } = faux(table);
    const r = await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, NOW);
    const kds = par(r, 'boutique-shop');
    expect(kds.avancement).toEqual({ genre: 'commits' });
    expect(kds.commits).toEqual([]);
    expect(kds.ouOnSArrete).toContain('21 oct.');
    expect(kds.dernierTravail).toBeNull();
    expect(kds.enPause).toBe(false); // poussé il y a 20 jours
    expect(par(r, 'mon_portfolio').enPause).toBe(true); // 50 jours
    expect(par(r, 'mon_portfolio').ouOnSArrete).toContain('Dernier travail le');
  });

  it('choisit la priorité avec le travail le plus récent', async () => {
    const { table } = monde();
    const { f } = faux(table);
    const r = await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, NOW);
    expect(r.priorite).toMatchObject({ nom: 'Terra' });
  });

  it('une tâche urgente non faite est listée, pas une case cochée', async () => {
    const { table } = monde(NOW, {
      [`${B}/repos/mon-compte/PROJET_TERRA/contents/docs/taches-humaines.md`]: texte('## Urgent\n- [x] Fait\n- [ ] Signer\n'),
      [`${B}/repos/mon-compte/PROJET_TERRA/commits?path=docs/taches-humaines.md&per_page=30`]: json([]),
    });
    const { f } = faux(table);
    const r = await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, NOW);
    const a = par(r, 'PROJET_TERRA').avancement;
    expect(a.genre === 'cases' && a.urgentes).toEqual(['Signer']);
    expect(r.priorite?.raison).toContain('Signer');
  });

  it('un fichier qui répond 500 : ce projet est « lecture impossible », les autres sont complets', async () => {
    const { table } = monde(NOW, {
      [`${B}/repos/mon-compte/PROJET_TERRA/contents/docs/taches-humaines.md`]: () => new Response('boom', { status: 500 }),
    });
    const { f } = faux(table);
    const r = await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, NOW);
    const s = par(r, 'PROJET_TERRA');
    expect(s.lectureImpossible).toBe(true);
    expect(s.ouOnSArrete).toBe('lecture impossible aujourd\'hui');
    expect(par(r, 'app_livraison').lectureImpossible).toBeUndefined();
    expect(par(r, 'app_livraison').avancement.genre).toBe('liste');
    expect(r.projets).toHaveLength(4);
  });

  it('un historique illisible rend aussi le projet « lecture impossible »', async () => {
    const { table } = monde(NOW, {
      [`${B}/repos/mon-compte/PROJET_TERRA/contents/docs/taches-humaines.md?ref=s1`]: () => new Response('', { status: 500 }),
    });
    const { f } = faux(table);
    const r = await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, NOW);
    expect(par(r, 'PROJET_TERRA').lectureImpossible).toBe(true);
  });

  it('liste des dépôts injoignable : rejette et n\'écrit rien', async () => {
    const kv = memoire();
    const { f } = faux({ [LISTE]: new Response('', { status: 500 }) });
    await expect(calculerReleve(kv, { fetch: f, jeton: 'JET' }, NOW)).rejects.toThrow();
    expect(await kv.hgetall(CLES_MAFE.releves)).toEqual({});
  });

  it('sans jeton : Refus 503', async () => {
    const { f } = faux({});
    const err = await calculerReleve(memoire(), { fetch: f }, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(Refus);
    expect(err.code).toBe(503);
    expect(err.message).toBe('jeton GitHub perso manquant');
  });

  it('range le relevé sous mafe:releves et garde phrase et bilan au second calcul du jour', async () => {
    const kv = memoire();
    const { table } = monde();
    const { f } = faux(table);
    const r1 = await calculerReleve(kv, { fetch: f, jeton: 'JET' }, NOW);
    expect(r1.jour).toBe('2026-11-10');
    expect(jourDe(NOW)).toBe('2026-11-10');
    const rangé = JSON.parse((await kv.hgetall(CLES_MAFE.releves))['2026-11-10']);
    expect(rangé.quand).toBe(NOW);
    await kv.hset(CLES_MAFE.releves, '2026-11-10', JSON.stringify({ ...rangé, phrase: 'Bonjour', bilan: 'Bien' }));
    const r2 = await calculerReleve(kv, { fetch: f, jeton: 'JET' }, NOW + 60_000);
    expect(r2.phrase).toBe('Bonjour');
    expect(r2.bilan).toBe('Bien');
    expect((await dernierReleve(kv))?.phrase).toBe('Bonjour');
  });

  it('dernierReleve : null sans rien, sinon le jour le plus récent', async () => {
    const kv = memoire();
    expect(await dernierReleve(kv)).toBeNull();
    await kv.hset(CLES_MAFE.releves, '2026-11-08', JSON.stringify({ jour: '2026-11-08' }));
    await kv.hset(CLES_MAFE.releves, '2026-11-09', JSON.stringify({ jour: '2026-11-09' }));
    expect((await dernierReleve(kv))?.jour).toBe('2026-11-09');
  });
});

describe('notes à écrire', () => {
  const veille = '2026-11-09T15:00:00Z';
  const base = (extra: Table = {}) => {
    const m = monde(NOW, {
      [m_since('mon-compte/boutique-shop')]: json([unCommit(veille, 'Panier', 'k1')]),
      ...extra,
    });
    return m.table;
  };
  function m_since(d: string) { return `${B}/repos/${d}/commits?since=${new Date(NOW - 7 * 86_400_000).toISOString()}&per_page=100`; }

  it('commits la veille sans séance ni note : une entrée', async () => {
    const { f } = faux(base());
    const r = await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, NOW);
    expect(r.aEcrire).toEqual([{
      id: '2026-11-09:mon-compte/boutique-shop', depot: 'mon-compte/boutique-shop', nom: 'Boutique Shop', jour: '2026-11-09',
      jours: ['2026-11-09'], commits: [{ date: veille, message: 'Panier', url: 'https://github.com/x/k1' }],
    }]);
  });

  it('un fichier de séance ce jour-là : aucune entrée', async () => {
    const { f } = faux(base({
      [`${B}/repos/mon-compte/boutique-shop/git/trees/HEAD?recursive=1`]: arbre('docs/seances/2026-11-09-2.md'),
      [`${B}/repos/mon-compte/boutique-shop/contents/docs/seances/2026-11-09-2.md`]: texte('## La suite\n- x\n'),
    }));
    const r = await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, NOW);
    expect(r.aEcrire).toEqual([]);
  });

  it('une note déjà rangée au QG pour cet id : aucune entrée', async () => {
    const kv = memoire();
    await kv.hset(CLES_MAFE.notes, '2026-11-09:mon-compte/boutique-shop', JSON.stringify({ id: 'x' }));
    const { f } = faux(base());
    const r = await calculerReleve(kv, { fetch: f, jeton: 'JET' }, NOW);
    expect(r.aEcrire).toEqual([]);
  });

  it('le lundi : vendredi, samedi et dimanche comptent, pas jeudi', async () => {
    const d = (j: string) => `${j}T12:00:00Z`;
    const since = `${B}/repos/mon-compte/boutique-shop/commits?since=${new Date(MARDI_LUNDI - 7 * 86_400_000).toISOString()}&per_page=100`;
    const m = monde(MARDI_LUNDI, { [since]: json([unCommit(d('2026-11-08'), 'Dim', 'a'), unCommit(d('2026-11-06'), 'Ven', 'b'), unCommit(d('2026-11-05'), 'Jeu', 'c')]) });
    const { f } = faux(m.table);
    const r = await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, MARDI_LUNDI);
    expect(r.aEcrire).toHaveLength(1);
    expect(r.aEcrire[0].commits.map((c) => c.message)).toEqual(['Dim', 'Ven']);
    expect(r.aEcrire[0].jour).toBe('2026-11-08');
  });

  it('le lundi : une ancienne note sans « jours » ne couvre que le jour de son id', async () => {
    const d = (j: string) => `${j}T12:00:00Z`;
    const since = `${B}/repos/mon-compte/boutique-shop/commits?since=${new Date(MARDI_LUNDI - 7 * 86_400_000).toISOString()}&per_page=100`;
    const m = monde(MARDI_LUNDI, { [since]: json([unCommit(d('2026-11-08'), 'Dim', 'a'), unCommit(d('2026-11-06'), 'Ven', 'b')]) });
    const kv = memoire();
    await kv.hset(CLES_MAFE.notes, '2026-11-08:mon-compte/boutique-shop', JSON.stringify({ id: 'x' }));
    const { f } = faux(m.table);
    const r = await calculerReleve(kv, { fetch: f, jeton: 'JET' }, MARDI_LUNDI);
    expect(r.aEcrire).toHaveLength(1);
    expect(r.aEcrire[0]).toMatchObject({ id: '2026-11-06:mon-compte/boutique-shop', jour: '2026-11-06' });
    expect(r.aEcrire[0].commits.map((c) => c.message)).toEqual(['Ven']);
  });
});

describe('notes du lundi sans doublon', () => {
  const d = (j: string) => `${j}T12:00:00Z`;
  const depuisLundi = () => `${B}/repos/mon-compte/boutique-shop/commits?since=${new Date(MARDI_LUNDI - 7 * 86_400_000).toISOString()}&per_page=100`;
  const lundi = () => monde(MARDI_LUNDI, { [depuisLundi()]: json([unCommit(d('2026-11-08'), 'Dim', 'a'), unCommit(d('2026-11-07'), 'Sam', 'c'), unCommit(d('2026-11-06'), 'Ven', 'b')]) });

  it('une note qui liste ven., sam. et dim. (rangée sous l\'id de dimanche) : plus rien à écrire', async () => {
    const kv = memoire();
    await kv.hset(CLES_MAFE.notes, '2026-11-08:mon-compte/boutique-shop', JSON.stringify({ id: '2026-11-08:mon-compte/boutique-shop', depot: 'mon-compte/boutique-shop', jours: ['2026-11-06', '2026-11-07', '2026-11-08'] }));
    const { f } = faux(lundi().table);
    const r = await calculerReleve(kv, { fetch: f, jeton: 'JET' }, MARDI_LUNDI);
    expect(r.aEcrire).toEqual([]);
  });

  it('une jour couvert par une séance du dépôt n\'est pas repris non plus', async () => {
    const m = lundi();
    m.table[`${B}/repos/mon-compte/boutique-shop/git/trees/HEAD?recursive=1`] = arbre('docs/seances/2026-11-06.md', 'docs/seances/2026-11-07.md', 'docs/seances/2026-11-08.md');
    const { f } = faux(m.table);
    const r = await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, MARDI_LUNDI);
    expect(r.aEcrire).toEqual([]);
  });

  it('lundi réaliste : relevé de 7 h 30, note écrite, rafraîchissement, relevé de nouveau : plus rien à écrire', async () => {
    const kv = memoire();
    const { f } = faux(lundi().table);
    const deps = { fetch: f, jeton: 'JET', envoyer: async () => undefined };
    const premier = await traiterActionMafe(kv, 'releve', {}, deps, MARDI_LUNDI) as ReleveMafe;
    expect(premier.aEcrire).toHaveLength(1);
    expect(premier.aEcrire[0].jours).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
    await traiterActionMafe(kv, 'note', { id: premier.aEcrire[0].id, markdown: '# Séance' }, deps, MARDI_LUNDI);
    const rafraichi = await traiterActionMafe(kv, 'rafraichir', {}, deps, MARDI_LUNDI + 3_600_000) as ReleveMafe;
    expect(rafraichi.aEcrire).toEqual([]);
    const encore = await traiterActionMafe(kv, 'releve', {}, deps, MARDI_LUNDI + 7_200_000) as ReleveMafe;
    expect(encore.aEcrire).toEqual([]);
  });
});

describe('cas limites du relevé', () => {
  it('une poussée récente empêche la pause même si la séance est ancienne', async () => {
    const m = monde(NOW, {
      [`${B}/repos/mon-compte/PROJET_TERRA/git/trees/HEAD?recursive=1`]: arbre('docs/seances/2026-09-01.md'),
      [`${B}/repos/mon-compte/PROJET_TERRA/contents/docs/seances/2026-09-01.md`]: texte('## La suite\n- x\n'),
      [`${B}/repos/mon-compte/PROJET_TERRA/commits?since=${new Date(NOW - 7 * 86_400_000).toISOString()}&per_page=100`]: json([]),
    });
    const { f } = faux(m.table);
    const r = await calculerReleve(memoire(), { fetch: f, jeton: 'JET' }, NOW);
    const s = r.projets.find((p) => p.depot.endsWith('PROJET_TERRA'))!;
    expect(s.dernierTravail).toBe('2026-09-01');
    expect(s.enPause).toBe(false);
  });

  it('un relevé du jour abîmé dans le KV est ignoré', async () => {
    const kv = memoire();
    await kv.hset(CLES_MAFE.releves, '2026-11-10', '{pas du json');
    const { f } = faux(monde().table);
    const r = await calculerReleve(kv, { fetch: f, jeton: 'JET' }, NOW);
    expect(r.jour).toBe('2026-11-10');
    expect(r.projets.length).toBeGreaterThan(0);
  });
});
