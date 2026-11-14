import { describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES, Refus } from '../qg';
import { CLES_ZORO, demanderRapportMac, enregistrerRapportMac, lireRapportMac } from './mac';
import {
  creneauDuTour, faireTour, importants, lireHistorique, lireSignales, lireTour, messageTelegram, NON_LU, traiterActionZoro, type DepsZoro,
} from './tour';
import type { Cle, DossierMac, Faille, Important, Projet, Tour } from './types';
import { ignorer } from '../silence';

const NOW = Date.UTC(2026, 10, 10, 9, 0); // mardi 10 novembre 2026, 09:00 UTC
const JOUR = 86_400_000;
const SEMAINE = 7 * JOUR;
const LIEN = 'https://mon-qg.vercel.app/?bureau=zoro';

// --- Fabriques ------------------------------------------------------------------------------

const faille = (o: Partial<Faille> = {}): Faille => ({
  id: 'GHSA-1', paquet: 'next', version: '15.0.0', gravite: 'haute', corrigeeEn: '15.0.5', directeProd: true, resume: 'r', ...o,
});
const projet = (o: Partial<Projet> = {}): Projet => ({
  depot: 'app_livraison', pousse: NOW - 5 * JOUR, failles: [], ci: { etat: 'vert', passages: 10, echecs: 0 }, ...o,
});
const dossier = (o: Partial<DossierMac> = {}): DossierMac => ({
  nom: 'qg', git: true, compte: 'mon-compte', distant: true,
  nonEnregistres: 0, plusAncienNonEnregistre: null, nonPousses: 0, plusAncienNonPousse: null,
  stashes: 0, dernierCommit: NOW - 2 * JOUR, modifie: NOW - 2 * JOUR, ...o,
});
const base = (o: Partial<Omit<Tour, 'importants'>> = {}): Omit<Tour, 'importants'> => ({
  quand: NOW, type: 'tour', projets: [], nonLus: [], cles: [], mac: null, macVieux: false, ...o,
});
const cles = (l: Important[]) => l.map(i => i.cle);

// --- Faux monde (GitHub, OSV, Telegram) ------------------------------------------------------

type Run = { conclusion: string; created_at: string };
type Monde = {
  depots: { nom: string; pousse: number }[];
  expiration?: string;
  paquets?: Record<string, Record<string, string>>;   // dépôt → dependencies (versions exactes)
  runs?: Record<string, Run[]>;                        // dépôt → passages CI
  vulns?: Record<string, { id: string; severite: string }[]>; // « nom@version » → failles
  github?: 'panne'; osv?: 'panne';
  lents?: string[];                                     // dépôts dont GitHub ne répond jamais
};
const json = (o: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status: 200, headers });
const iso = (t: number) => new Date(t).toISOString();
const entete = (t: number) => `${iso(t).slice(0, 19).replace('T', ' ')} UTC`; // format de github-authentication-token-expiration
const vert = (): Run[] => [{ conclusion: 'success', created_at: iso(NOW - JOUR) }];
const rouge = (depuis = NOW - 3 * JOUR): Run[] => [{ conclusion: 'failure', created_at: iso(depuis) }, { conclusion: 'success', created_at: iso(depuis - JOUR) }];

function banc(m: Monde, opts: { jeton?: string | null; linkedin?: { expire: number } | null; echeance?: number } = {}) {
  const kv = memoire();
  const envoyes: string[] = [];
  const appels: string[] = [];
  let casse = false;
  let pendant: { statut: string; tache: string; outil?: string } | null = null;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    appels.push(u);
    pendant ??= await agent(kv);
    if (u.startsWith('https://api.osv.dev')) {
      if (m.osv === 'panne') return new Response('', { status: 503 });
      if (u.endsWith('/v1/querybatch')) {
        const q = JSON.parse(String(init?.body)).queries as { package: { name: string }; version: string }[];
        return json({ results: q.map(x => ({ vulns: (m.vulns?.[`${x.package.name}@${x.version}`] ?? []).map(v => ({ id: v.id })) })) });
      }
      const id = decodeURIComponent(u.split('/v1/vulns/')[1] ?? '');
      const v = Object.values(m.vulns ?? {}).flat().find(x => x.id === id);
      return v ? json({ id, summary: 's', database_specific: { severity: v.severite }, affected: [] }) : new Response('', { status: 404 });
    }
    if (m.github === 'panne') return new Response('', { status: 500 });
    if (u.includes('/user/repos')) return json(m.depots.map(d => ({ full_name: `mon-compte/${d.nom}`, archived: false, pushed_at: iso(d.pousse) })));
    if (u.endsWith('/user')) return json({}, m.expiration ? { 'github-authentication-token-expiration': m.expiration } : {});
    const r = /\/repos\/mon-compte\/([^/?]+)([^?]*)/.exec(u);
    if (!r) return new Response('', { status: 404 });
    const [, depot, reste] = r;
    if (m.lents?.includes(depot)) {
      return new Promise<Response>((_, rejeter) => {
        const s = init?.signal;
        s?.addEventListener('abort', () => rejeter(new DOMException('coupé', 'AbortError')));
      });
    }
    if (reste === '') return json({ default_branch: 'main' });
    if (reste === '/git/trees/HEAD') return json({ tree: [{ path: 'package.json', type: 'blob' }], truncated: false });
    if (reste === '/contents/package.json') return new Response(JSON.stringify({ dependencies: m.paquets?.[depot] ?? {} }), { status: 200 });
    if (reste === '/actions/workflows') return json({ total_count: 1 });
    if (reste === '/actions/runs') return json({ workflow_runs: m.runs?.[depot] ?? vert() });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  const deps: DepsZoro = {
    fetch: f,
    envoyer: async (t: string) => { if (casse) throw new Error('telegram en panne'); envoyes.push(t); },
    jeton: opts.jeton === null ? undefined : (opts.jeton ?? 'jeton'),
    linkedin: async () => opts.linkedin ?? null,
    ...(opts.echeance ? { echeance: opts.echeance } : {}),
  };
  return {
    kv, deps, envoyes, appels,
    casse: (v: boolean) => { casse = v; },
    pendant: () => pendant,
    tour: (now = NOW) => faireTour(kv, deps, now, 'tour') as Promise<Tour>,
    verifier: (now = NOW) => faireTour(kv, deps, now, 'verifier') as Promise<Tour>,
  };
}
const agent = async (kv: KV) => JSON.parse((await kv.hgetall(CLES.etats)).zoro ?? 'null') as { statut: string; tache: string; outil?: string } | null;
const journal = async (kv: KV) => (await kv.lrange(CLES.journal, 0, -1)).map(v => JSON.parse(v) as { agent: string; texte: string; statut?: string });

/** Un monde type : une faille haute directe dans app_livraison, boutique-shop en rouge. */
const mondeType = (): Monde => ({
  depots: [{ nom: 'app_livraison', pousse: NOW - 2 * JOUR }, { nom: 'boutique-shop', pousse: NOW - 4 * JOUR }],
  paquets: { app_livraison: { next: '15.0.0' }, 'boutique-shop': { react: '19.0.0' } },
  vulns: { 'next@15.0.0': [{ id: 'GHSA-1', severite: 'HIGH' }] },
  runs: { 'boutique-shop': rouge(NOW - 3 * JOUR) },
});

// --- Les règles d'importance --------------------------------------------------------------------

describe('importants', () => {
  it('importants — failles : seulement critique/haute ET directeProd, projets actifs ; une Important par (dépôt, id)', () => {
    const t = base({
      projets: [
        projet({
          depot: 'A',
          failles: [
            faille({ id: 'GHSA-1', gravite: 'critique' }),
            faille({ id: 'GHSA-2', gravite: 'haute' }),
            faille({ id: 'GHSA-2', gravite: 'haute', version: '14.0.0' }), // même faille, autre version : une seule
            faille({ id: 'GHSA-3', gravite: 'haute', directeProd: false }), // dev ou indirecte : page seulement
            faille({ id: 'GHSA-4', gravite: 'moyenne' }),
            faille({ id: 'GHSA-5', gravite: 'basse' }),
          ],
        }),
        projet({ depot: 'dormant', pousse: NOW - 100 * JOUR, failles: [faille({ gravite: 'critique' })] }),
        projet({ depot: 'illisible', failles: null }),
      ],
    });
    const r = importants(t, NOW);
    expect(cles(r)).toEqual(['faille:A:GHSA-1', 'faille:A:GHSA-2']);
    expect(r.every(i => i.partie === 'failles' && i.projet === 'A')).toBe(true);
  });

  it('importants — CI : rouge et poussé il y a ≤ 30 jours ; rouge mais poussé il y a 40 jours → rien ; illisible → rien', () => {
    const r = importants(base({
      projets: [
        projet({ depot: 'recent', pousse: NOW - 10 * JOUR, ci: { etat: 'rouge', depuis: NOW - 3 * JOUR, passages: 5, echecs: 2 } }),
        projet({ depot: 'limite', pousse: NOW - 30 * JOUR, ci: { etat: 'rouge', depuis: NOW - 31 * JOUR, passages: 5, echecs: 2 } }),
        projet({ depot: 'ancien', pousse: NOW - 40 * JOUR, ci: { etat: 'rouge', depuis: NOW - 41 * JOUR, passages: 5, echecs: 5 } }),
        projet({ depot: 'flou', ci: { etat: 'illisible', raison: 'droit Actions manquant' } }),
        projet({ depot: 'sans', ci: { etat: 'sans-tests' } }),
        projet({ depot: 'vert' }),
      ],
    }), NOW);
    expect(cles(r)).toEqual(['ci:recent', 'ci:limite']);
    expect(r[0]).toMatchObject({ partie: 'ci', projet: 'recent', texte: 'tests en échec depuis le 7 novembre' });
  });

  it('importants — clés : bientot ou expiree seulement (sans-date et non-connecte → rien)', () => {
    const c: Cle[] = [
      { nom: 'GitHub (lecture)', expire: NOW + 5 * JOUR, etat: 'bientot' },
      { nom: 'LinkedIn', expire: NOW - JOUR, etat: 'expiree' },
    ];
    const r = importants(base({ cles: c }), NOW);
    expect(r).toEqual([
      { cle: 'cle:GitHub (lecture)', partie: 'cles', projet: 'GitHub (lecture)', texte: 'expire dans 5 jours' },
      { cle: 'cle:LinkedIn', partie: 'cles', projet: 'LinkedIn', texte: 'a expiré, à renouveler' },
    ]);
    const calmes: Cle[] = [
      { nom: 'GitHub (lecture)', expire: null, etat: 'sans-date' },
      { nom: 'LinkedIn', expire: null, etat: 'non-connecte' },
    ];
    expect(importants(base({ cles: calmes }), NOW)).toEqual([]);
    expect(importants(base({ cles: [{ nom: 'LinkedIn', expire: NOW + 60 * JOUR, etat: 'ok' }] }), NOW)).toEqual([]);
  });

  it('importants — Mac : git actif (< 90 j) avec non enregistrés ou non poussés depuis > 7 jours, ou sans distant ; hors git, stashes → rien ; rapport vieux de > 2 jours → aucune alerte Mac', () => {
    const dossiers: DossierMac[] = [
      dossier({ nom: 'a', nonEnregistres: 3, plusAncienNonEnregistre: NOW - 12 * JOUR }),
      dossier({ nom: 'b', nonPousses: 2, plusAncienNonPousse: NOW - 9 * JOUR }),
      dossier({ nom: 'c', nonEnregistres: 1, plusAncienNonEnregistre: NOW - 3 * JOUR, nonPousses: 1, plusAncienNonPousse: NOW - 6 * JOUR }),
      dossier({ nom: 'd', distant: false, compte: null, nonPousses: 4, plusAncienNonPousse: NOW - 20 * JOUR }), // sans distant : une seule alerte
      dossier({ nom: 'dormant', dernierCommit: NOW - 100 * JOUR, nonEnregistres: 2, plusAncienNonEnregistre: NOW - 120 * JOUR }),
      dossier({ nom: 'dormant-sans-distant', distant: false, compte: null, dernierCommit: NOW - 200 * JOUR }),
      dossier({ nom: 'notes', git: false, distant: false, compte: null, dernierCommit: null, modifie: NOW - JOUR }),
      dossier({ nom: 'g', stashes: 5 }),
      dossier({ nom: 'flou', illisible: true, nonEnregistres: 3, plusAncienNonEnregistre: NOW - 30 * JOUR, distant: false }),
    ];
    const r = importants(base({ mac: { quand: NOW - JOUR, dossiers } }), NOW);
    expect(cles(r)).toEqual(['mac:a:nonEnregistres', 'mac:b:nonPousses', 'mac:d:sansDistant']);
    expect(r.map(i => i.texte)).toEqual([
      '3 changements pas enregistrés depuis 12 jours',
      '2 commits pas encore envoyés en ligne depuis 9 jours',
      'aucune copie en ligne (pas de dépôt distant)',
    ]);
    // rapport vieux de 3 jours, ou marqué vieux : rien
    expect(importants(base({ mac: { quand: NOW - 3 * JOUR, dossiers } }), NOW)).toEqual([]);
    expect(importants(base({ mac: { quand: NOW - JOUR, dossiers }, macVieux: true }), NOW)).toEqual([]);
    expect(importants(base({ mac: null, macVieux: true }), NOW)).toEqual([]);
  });
});

// --- Le message Telegram --------------------------------------------------------------------

describe('messageTelegram', () => {
  it('message : titre « 🛡️ Zoro · tour de sécurité du mardi », lignes groupées par partie, au plus 12 lignes puis « + N autres dans la page », lien https://mon-qg.vercel.app/?bureau=zoro', () => {
    const rouges = Array.from({ length: 13 }, (_, i) => projet({
      depot: `p${String(i).padStart(2, '0')}`, ci: { etat: 'rouge', depuis: NOW - 3 * JOUR, passages: 3, echecs: 1 },
    }));
    const t = base({
      projets: [projet({ depot: 'A', failles: [faille({ id: 'G1', gravite: 'critique' }), faille({ id: 'G2' }), faille({ id: 'G3' })] }), ...rouges],
      cles: [{ nom: 'GitHub (lecture)', expire: NOW + 5 * JOUR, etat: 'bientot' }],
    });
    const texte = messageTelegram(importants(t, NOW), new Set())!;
    const lignes = texte.split('\n');
    expect(lignes[0]).toBe('🛡️ Zoro · tour de sécurité du mardi');
    expect(lignes.at(-1)).toBe(LIEN);
    const points = lignes.filter(l => l.startsWith('• '));
    expect(points.length).toBe(12);
    // 1 ligne de failles (A, groupée), 13 rouges, 1 clé = 15 lignes : 12 montrées, 3 dans la page
    expect(texte).toContain('+ 3 autres dans la page');
    expect(points[0]).toBe('• A : 1 faille critique et 2 hautes');
    expect(lignes.indexOf('Failles')).toBeLessThan(lignes.indexOf('Tests'));
    expect(points[1]).toBe('• p00 : tests en échec depuis le 7 novembre');
    expect(texte).not.toContain('Clés'); // coupée : dans la page
  });

  it('message : ce qui était déjà signalé → une ligne « toujours : … » par projet ; rien d\'important → null', () => {
    const t = base({
      projets: [
        projet({ depot: 'A', failles: [faille({ id: 'G1', gravite: 'critique' }), faille({ id: 'G2' }), faille({ id: 'G9' })] }),
        projet({ depot: 'B', failles: [faille({ id: 'G5' })], ci: { etat: 'rouge', depuis: NOW - 3 * JOUR, passages: 3, echecs: 1 } }),
      ],
      mac: { quand: NOW - JOUR, dossiers: [dossier({ nom: 'notes-x', distant: false, compte: null })] },
    });
    const imp = importants(t, NOW);
    const texte = messageTelegram(imp, new Set(['faille:A:G1', 'faille:A:G2', 'ci:B', 'mac:notes-x:sansDistant']))!;
    const points = texte.split('\n').filter(l => l.startsWith('• '));
    expect(points).toEqual([
      '• A : 1 faille haute',
      '• B : 1 faille haute',
      '• toujours : 1 faille critique et 1 haute dans A',
      '• toujours : B, tests en échec depuis le 7 novembre',
      '• toujours : notes-x, aucune copie en ligne (pas de dépôt distant)',
    ]);
    expect(texte.split('\n')).toContain('Sur ton Mac');
    expect(messageTelegram([], new Set(['faille:A:G1']))).toBeNull();
  });

  it('message : la coupe à 12 lignes ne cache jamais un point nouveau derrière des rappels « toujours »', () => {
    const rouges = Array.from({ length: 13 }, (_, i) => projet({
      depot: `p${String(i).padStart(2, '0')}`, ci: { etat: 'rouge', depuis: NOW - 3 * JOUR, passages: 3, echecs: 1 },
    }));
    const t = base({ projets: rouges, mac: { quand: NOW - JOUR, dossiers: [dossier({ nom: 'neuf', distant: false, compte: null })] } });
    const deja = new Set(rouges.map(p => `ci:${p.depot}`));
    const lignes = messageTelegram(importants(t, NOW), deja)!.split('\n');
    const points = lignes.filter(l => l.startsWith('• '));
    expect(points).toHaveLength(12);
    expect(points).toContain('• neuf : aucune copie en ligne (pas de dépôt distant)');
    expect(points.filter(l => l.startsWith('• toujours'))).toHaveLength(11);
    expect(lignes).toContain('+ 2 autres dans la page');
    // les parties restent dans leur ordre : Tests avant Sur ton Mac
    expect(lignes.indexOf('Tests')).toBeLessThan(lignes.indexOf('Sur ton Mac'));
  });

  it('message : une ligne « Pas lu cette fois : … » (des nombres, jamais un nom) quand une partie n\'a pas été lue', () => {
    const imp: Important[] = [{ cle: 'ci:a', partie: 'ci', projet: 'a', texte: 'tests en échec depuis le 7 novembre' }];
    const lignes = messageTelegram(imp, new Set(), 'Pas lu cette fois : failles de 2 projets, Mac')!.split('\n');
    expect(lignes).toContain('Pas lu cette fois : failles de 2 projets, Mac');
    expect(lignes.at(-1)).toBe(LIEN);
    expect(messageTelegram(imp, new Set())).not.toContain('Pas lu');
  });

  it('message : les caractères de contrôle et retours à la ligne des noms sont retirés', () => {
    const imp: Important[] = [{ cle: 'mac:x:sansDistant', partie: 'mac', projet: 'mau\nvais\u0007\u202enom', texte: 'aucune\r copie' }];
    const texte = messageTelegram(imp, new Set())!;
    expect(texte).toContain('• mauvaisnom : aucune copie');
    expect(texte).not.toMatch(/[\u0007\r\u202e]/);
    expect(texte.split('\n').filter(l => l.startsWith('• ')).length).toBe(1);
  });
});

// --- Le tour ------------------------------------------------------------------------------

describe('faireTour', () => {
  it('le premier tour (aucune mémoire) envoie tout ce qui est important', async () => {
    const b = banc(mondeType());
    const t = await b.tour();
    expect(cles(t.importants)).toEqual(['faille:app_livraison:GHSA-1', 'ci:boutique-shop']);
    expect(b.envoyes).toHaveLength(1);
    expect(b.envoyes[0]).toContain('• app_livraison : 1 faille haute');
    expect(b.envoyes[0]).toContain('• boutique-shop : tests en échec depuis le 7 novembre');
    expect(b.envoyes[0]).not.toContain('toujours');
    expect(await lireSignales(b.kv)).toEqual(['faille:app_livraison:GHSA-1', 'ci:boutique-shop']);
    expect((await lireTour(b.kv))?.quand).toBe(NOW);
    expect(t.projets.map(p => p.depot)).toEqual(['app_livraison', 'boutique-shop']);
    expect(t.nonLus).toEqual([]);
  });

  it('une faille que le patron a dit d\'ignorer n\'est pas redite sur Telegram (elle reste dans le tour, donc dans la page)', async () => {
    const b = banc(mondeType());
    await ignorer(b.kv, [{ cle: 'zoro:faille:app_livraison:GHSA-1', genre: 'zoro', agent: 'zoro', projet: 'app_livraison', nom: 'app_livraison', detail: 'faille', depuis: NOW, grave: true }], NOW);
    const t = await b.tour();
    expect(cles(t.importants)).toEqual(['faille:app_livraison:GHSA-1', 'ci:boutique-shop']);
    expect(b.envoyes[0]).not.toContain('app_livraison');
    expect(b.envoyes[0]).toContain('• boutique-shop : tests en échec depuis le 7 novembre');
  });

  it('tour : envoie, puis mémorise les clés signalées (les disparues sont oubliées) et ajoute à l\'historique (8 au plus)', async () => {
    const m = mondeType();
    const b = banc(m);
    await b.tour();
    m.runs = {}; // boutique-shop repasse au vert
    await b.tour(NOW + SEMAINE);
    expect(b.envoyes).toHaveLength(2);
    expect(b.envoyes[1]).toContain('• toujours : 1 faille haute dans app_livraison');
    expect(b.envoyes[1]).not.toContain('boutique-shop');
    expect(await lireSignales(b.kv)).toEqual(['faille:app_livraison:GHSA-1']);
    for (let i = 2; i < 11; i++) await b.tour(NOW + i * SEMAINE);
    const h = await lireHistorique(b.kv);
    expect(h).toHaveLength(8);
    expect(h[0]).toEqual({ quand: NOW + 10 * SEMAINE, importants: 1 });
  });

  it('tour : rien d\'important → aucun message, mémoire vidée, historique quand même', async () => {
    const m = mondeType();
    const b = banc(m);
    await b.tour();
    m.vulns = {}; m.runs = {};
    const t = await b.tour(NOW + SEMAINE);
    expect(t.importants).toEqual([]);
    expect(b.envoyes).toHaveLength(1);
    expect(await lireSignales(b.kv)).toEqual([]);
    expect((await lireHistorique(b.kv))[0]).toEqual({ quand: NOW + SEMAINE, importants: 0 });
  });

  it('tour : envoi Telegram en échec → Refus 503 (QStash réessaie), mémoire inchangée, aucune marque d\'envoi, tour enregistré quand même', async () => {
    const b = banc(mondeType());
    b.casse(true);
    const e = await b.tour().then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(Refus);
    expect((e as Refus).code).toBe(503);
    expect(b.envoyes).toEqual([]);
    expect(await lireSignales(b.kv)).toEqual([]);
    expect(await b.kv.get(CLES_ZORO.envoye(creneauDuTour(NOW)))).toBeNull();
    expect((await lireTour(b.kv))?.importants).toHaveLength(2);
    expect(await lireHistorique(b.kv)).toHaveLength(1);
    expect(await agent(b.kv)).toMatchObject({ statut: 'erreur' });
    expect((await agent(b.kv))!.tache).not.toMatch(/fait le tour de sécurité/);
    // QStash réessaie quelques minutes plus tard : le message part, une seule fois ; l'historique garde une entrée par mardi
    b.casse(false);
    await b.tour(NOW + 5 * 60_000);
    expect(b.envoyes).toHaveLength(1);
    expect(b.envoyes[0]).not.toContain('toujours');
    expect(await lireHistorique(b.kv)).toEqual([{ quand: NOW + 5 * 60_000, importants: 2 }]);
    expect(await b.kv.get(CLES_ZORO.envoye(creneauDuTour(NOW)))).not.toBeNull();
  });

  it('tour : un second tour du même mardi (doublon QStash, nouvel essai, tour relancé) n\'envoie rien de plus, mais le tour est enregistré', async () => {
    const b = banc(mondeType());
    await b.tour();
    const t = await b.tour(NOW + 2 * 3_600_000);
    expect(b.envoyes).toHaveLength(1);
    expect((await lireTour(b.kv))?.quand).toBe(t.quand);
    expect(await lireSignales(b.kv)).toEqual(['faille:app_livraison:GHSA-1', 'ci:boutique-shop']);
    expect((await lireHistorique(b.kv)).map(h => h.quand)).toEqual([NOW + 2 * 3_600_000]);
    // même un tour lancé le lundi suivant reste dans le créneau de ce mardi
    await b.tour(NOW + 6 * JOUR);
    expect(b.envoyes).toHaveLength(1);
  });

  it('tour : un tour de validation le lundi ne bloque pas celui du mardi (deux créneaux, deux messages)', async () => {
    const b = banc(mondeType());
    await b.tour(NOW - JOUR); // lundi 9 novembre : créneau du mardi 3
    await b.tour();           // mardi 10 novembre, 09:00 : nouveau créneau
    expect(b.envoyes).toHaveLength(2);
    expect(creneauDuTour(NOW - JOUR)).toBe(NOW - SEMAINE);
    expect(creneauDuTour(NOW)).toBe(NOW);
    expect(creneauDuTour(NOW + 6 * JOUR + 23 * 3_600_000)).toBe(NOW);
  });

  it('tour : une partie non lue cette semaine ne fait pas oublier ce qui était signalé', async () => {
    const m = mondeType();
    const b = banc(m);
    await b.tour();
    m.osv = 'panne';
    await b.tour(NOW + SEMAINE);
    expect(await lireSignales(b.kv)).toEqual(['ci:boutique-shop', 'faille:app_livraison:GHSA-1']);
    m.osv = undefined;
    await b.tour(NOW + 2 * SEMAINE);
    expect(b.envoyes[2]).toContain('• toujours : 1 faille haute dans app_livraison');
  });

  it('verifier : ni envoi, ni mémoire, ni historique ; seulement zoro:tour', async () => {
    const m = mondeType();
    const b = banc(m);
    await b.tour();
    m.runs = {};
    const t = await b.verifier(NOW + JOUR);
    expect(t.type).toBe('verifier');
    expect(b.envoyes).toHaveLength(1);
    expect(await lireSignales(b.kv)).toEqual(['faille:app_livraison:GHSA-1', 'ci:boutique-shop']);
    expect(await lireHistorique(b.kv)).toHaveLength(1);
    expect(await lireTour(b.kv)).toEqual(t);
    // un verifier seul : aucune mémoire ni historique créés
    const c = banc(mondeType());
    await c.verifier();
    expect(c.envoyes).toEqual([]);
    expect(await c.kv.hgetall(CLES_ZORO.signales)).toEqual({});
    expect(await lireHistorique(c.kv)).toEqual([]);
    expect(await lireTour(c.kv)).not.toBeNull();
  });

  it('OSV injoignable → projets « failles illisibles », le message ne contient jamais « aucune faille »', async () => {
    const b = banc({ ...mondeType(), osv: 'panne' });
    const t = await b.tour();
    expect(t.projets.find(p => p.depot === 'app_livraison')?.failles).toBeNull();
    expect(t.projets.find(p => p.depot === 'boutique-shop')?.failles).toBeNull();
    expect(b.envoyes).toHaveLength(1); // boutique-shop en rouge
    expect(b.envoyes[0]).not.toMatch(/aucune faille|rien à signaler/i);
    // rien d'autre d'important : aucun message (et donc jamais « aucune faille »)
    const c = banc({ ...mondeType(), osv: 'panne', runs: {} });
    expect((await c.tour()).importants).toEqual([]);
    expect(c.envoyes).toEqual([]);
  });

  it('tour : le message dit ce qui n\'a pas été lu cette fois, en nombres ; tout lu → pas de ligne', async () => {
    const b = banc({ ...mondeType(), osv: 'panne' }); // failles illisibles pour les 2 projets, aucun rapport du Mac
    await b.tour();
    expect(b.envoyes[0]).toContain('Pas lu cette fois : failles de 2 projets, Mac');
    expect(b.envoyes[0].split('\n').find(l => l.startsWith('Pas lu'))).not.toMatch(/app_livraison|boutique-shop/);
    const c = banc(mondeType());
    await enregistrerRapportMac(c.kv, { dossiers: [dossier()] }, NOW - JOUR);
    await c.tour();
    expect(c.envoyes[0]).not.toContain('Pas lu');
  });

  it('GitHub injoignable → tour terminé, projets vides, « GitHub » non lu ; jamais « rien à signaler »', async () => {
    const b = banc({ ...mondeType(), github: 'panne' }, { linkedin: { expire: NOW + 3 * JOUR } });
    const t = await b.tour();
    expect(t.projets).toEqual([]);
    expect(t.nonLus).toEqual([NON_LU.github]);
    expect(t.cles).toEqual([{ nom: 'LinkedIn', expire: NOW + 3 * JOUR, etat: 'bientot' }]);
    expect(b.envoyes[0]).toContain('• LinkedIn : expire dans 3 jours');
    expect(b.envoyes[0]).not.toMatch(/aucune faille|rien à signaler/i);
  });

  it('clé GitHub expirée et GitHub muet : la dernière échéance connue, passée → « expirée », signalée sur Telegram', async () => {
    const m: Monde = { depots: [], expiration: entete(NOW - JOUR) };
    const b = banc(m);
    await b.tour(NOW - 8 * JOUR); // échéance lue en direct : dans 7 jours
    m.github = 'panne';           // la clé expire : GitHub refuse tout
    const t = await b.tour();
    expect(t.nonLus).toEqual([NON_LU.github]);
    expect(t.cles[0]).toEqual({ nom: 'GitHub (lecture)', expire: NOW - JOUR, etat: 'expiree' });
    expect(t.importants.map(i => i.cle)).toContain('cle:GitHub (lecture)');
    expect(b.envoyes).toHaveLength(2);
    expect(b.envoyes[1]).toContain('GitHub (lecture), a expiré, à renouveler');
    // et encore la semaine suivante (la mémoire de l'échéance ne se perd pas)
    expect((await b.tour(NOW + SEMAINE)).cles[0].etat).toBe('expiree');
  });

  it('GitHub muet, échéance connue dans 10 jours → « bientôt » ; dans 20 jours ou jamais connue → clé non listée', async () => {
    const m: Monde = { depots: [], expiration: entete(NOW + 10 * JOUR) };
    const b = banc(m);
    await b.tour(NOW - 7 * JOUR); // dans 17 jours : ok
    m.github = 'panne';
    const t = await b.tour();
    expect(t.cles[0]).toEqual({ nom: 'GitHub (lecture)', expire: NOW + 10 * JOUR, etat: 'bientot' });
    expect(b.envoyes.at(-1)).toContain('GitHub (lecture) : expire dans 10 jours');

    const loin: Monde = { depots: [], expiration: entete(NOW + 20 * JOUR) };
    const c = banc(loin);
    await c.tour(NOW - JOUR);
    loin.github = 'panne';
    const u = await c.tour();
    expect(u.cles.map(x => x.nom)).toEqual(['LinkedIn']);
    // l'échéance retenue sert encore quand elle approche
    expect((await c.tour(NOW + 7 * JOUR)).cles[0]).toMatchObject({ nom: 'GitHub (lecture)', etat: 'bientot' });

    const jamais = banc({ depots: [], github: 'panne' });
    const v = await jamais.tour();
    expect(v.cles.map(x => x.nom)).toEqual(['LinkedIn']);
    expect(v.importants).toEqual([]);
    expect(jamais.envoyes).toEqual([]);
  });

  it('clé sans date lue en direct : l\'ancienne échéance est oubliée', async () => {
    const m: Monde = { depots: [], expiration: entete(NOW + 5 * JOUR) };
    const b = banc(m);
    await b.tour(NOW - JOUR);
    m.expiration = undefined;     // nouvelle clé sans date
    await b.tour();
    m.github = 'panne';
    expect((await b.tour(NOW + 1)).cles.map(x => x.nom)).toEqual(['LinkedIn']);
  });

  it('clé GitHub absente → aucune lecture GitHub, partie « clé GitHub absente », pas de plantage', async () => {
    const b = banc(mondeType(), { jeton: null });
    const t = await b.tour();
    expect(b.appels.filter(u => u.includes('github.com'))).toEqual([]);
    expect(t.nonLus).toEqual([NON_LU.sansCle]);
    expect(t.projets).toEqual([]);
    expect(t.cles.map(c => c.nom)).toEqual(['LinkedIn']);
  });

  it('expiration de la clé GitHub illisible (/user raté) → la clé est dite non lue, pas « sans date »', async () => {
    const m = mondeType();
    const b = banc(m);
    const brut = b.deps.fetch;
    b.deps.fetch = (async (u: string | URL | Request, init?: RequestInit) =>
      String(u).endsWith('/user') ? new Response('', { status: 500 }) : brut(u, init)) as typeof fetch;
    const t = await b.tour();
    expect(t.nonLus).toEqual([NON_LU.cleGithub]);
    expect(t.cles.map(c => c.nom)).toEqual(['LinkedIn']);
  });

  it('un dépôt pas fini à l\'échéance → nonLus, les autres sont lus, le tour se termine', async () => {
    const b = banc({ ...mondeType(), lents: ['boutique-shop'] }, { echeance: 150 });
    const t = await b.tour();
    expect(t.projets.map(p => p.depot)).toEqual(['app_livraison']);
    expect(t.nonLus).toEqual(['boutique-shop']);
  });

  it('Mac : rapport récent lu, vieux de plus de 2 jours → macVieux et aucune alerte Mac', async () => {
    const b = banc({ depots: [] });
    await enregistrerRapportMac(b.kv, { dossiers: [dossier({ nom: 'seul', distant: false, compte: null })] }, NOW - JOUR);
    const t = await b.tour();
    expect(t.macVieux).toBe(false);
    expect(cles(t.importants)).toEqual(['mac:seul:sansDistant']);
    await enregistrerRapportMac(b.kv, { dossiers: [dossier({ nom: 'seul', distant: false, compte: null })] }, NOW - 3 * JOUR);
    const v = await b.tour(NOW + 1);
    expect(v.macVieux).toBe(true);
    expect(v.importants).toEqual([]);
    const sans = await banc({ depots: [] }).tour();
    expect(sans.mac).toBeNull();
    expect(sans.macVieux).toBe(true);
  });

  it('état : « au travail » (tache « fait le tour de sécurité », outil GH) au début, « termine » à la fin ; verifier : tache « vérifie à la demande »', async () => {
    const b = banc(mondeType());
    await b.tour();
    expect(b.pendant()).toMatchObject({ statut: 'au travail', tache: 'fait le tour de sécurité', outil: 'GH' });
    const fin = await agent(b.kv);
    expect(fin).toMatchObject({ statut: 'termine', outil: 'GH' });
    // aucun rapport du Mac : une partie non lue, dite dans le résumé
    expect(fin!.tache).toBe('fait le tour de sécurité : 2 points importants, 2 projets lus, une partie non lue, prévenu sur Telegram');
    const j = await journal(b.kv);
    expect(j.map(e => e.statut)).toEqual(['termine']);
    expect(j[0].texte).toMatch(/^fait le tour de sécurité/);
    expect(j[0].texte).not.toMatch(/app_livraison|boutique-shop/);

    const c = banc(mondeType());
    await c.verifier();
    expect(c.pendant()).toMatchObject({ statut: 'au travail', tache: 'vérifie à la demande', outil: 'GH' });
    expect((await agent(c.kv))!.tache).toBe('vérifie à la demande : 2 points importants, 2 projets lus, une partie non lue');
  });

  it('résumé du journal : seuls les projets lus en entier comptent ; une partie non lue est dite ; tout lu → rien de plus', async () => {
    const m: Monde = { ...mondeType(), runs: { 'boutique-shop': [] } }; // boutique-shop : aucun passage terminé → tests illisibles
    const b = banc(m);
    await enregistrerRapportMac(b.kv, { dossiers: [dossier()] }, NOW - JOUR);
    await b.tour();
    expect((await agent(b.kv))!.tache).toBe('fait le tour de sécurité : 1 point important, 1 projet lu, une partie non lue, prévenu sur Telegram');
    const c = banc({ ...mondeType(), runs: {} });
    await enregistrerRapportMac(c.kv, { dossiers: [dossier()] }, NOW - JOUR);
    await c.verifier();
    expect((await agent(c.kv))!.tache).toBe('vérifie à la demande : 1 point important, 2 projets lus');
    // failles illisibles (OSV en panne) : le projet n'est pas compté comme lu
    const d = banc({ ...mondeType(), runs: {}, osv: 'panne' });
    await enregistrerRapportMac(d.kv, { dossiers: [dossier()] }, NOW - JOUR);
    await d.verifier();
    expect((await agent(d.kv))!.tache).toBe('vérifie à la demande : 0 point important, 0 projet lu, une partie non lue');
  });

  it('un tour raté : « le tour de sécurité a échoué » pour tour, « la vérification a échoué » pour verifier', async () => {
    for (const [type, texte] of [['tour', 'le tour de sécurité a échoué'], ['verifier', 'la vérification a échoué']] as const) {
      const b = banc(mondeType());
      const kv: KV = { ...b.kv, hset: async (k, f, v) => { if (k === CLES_ZORO.tour && f === 'json') throw new Error('kv en panne'); return b.kv.hset(k, f, v); } };
      await expect(faireTour(kv, b.deps, NOW, type)).rejects.toThrow('kv en panne');
      expect(await agent(b.kv)).toMatchObject({ statut: 'erreur', tache: texte });
    }
  });

  it('verrou : un second tour pendant le premier → Refus 503 (QStash réessaie) ; une vérification pendant un tour → { occupe: true }', async () => {
    const b = banc(mondeType());
    const [x, y] = await Promise.allSettled([b.tour(), b.tour()]);
    const refus = [x, y].filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason as Refus);
    expect(refus).toHaveLength(1);
    expect(refus[0]).toBeInstanceOf(Refus);
    expect(refus[0].code).toBe(503);
    expect(refus[0].message).toBe('un tour est déjà en cours');
    expect(b.envoyes).toHaveLength(1);
    expect('occupe' in (await b.tour(NOW + SEMAINE))).toBe(false); // le verrou est levé
    await b.kv.setnx(CLES_ZORO.verrou, '1', 60);
    expect(await b.verifier(NOW + SEMAINE + 1)).toEqual({ occupe: true });
    expect(await traiterActionZoro(b.kv, 'verifier', undefined, b.deps, NOW + SEMAINE + 1)).toEqual({ occupe: true });
    const e = await traiterActionZoro(b.kv, 'tour', undefined, b.deps, NOW + SEMAINE + 1).then(() => null, (z: unknown) => z);
    expect((e as Refus).code).toBe(503);
  });
});

// --- Le secret ne sort jamais ---------------------------------------------------------------

describe('la clé GitHub ne sort jamais', () => {
  it('ni dans zoro:tour, ni dans la mémoire de Zoro, ni dans le journal, ni sur Telegram, ni dans les journaux du serveur', async () => {
    const JETON = 'github_pat_11ZORO_SECRET_jamais_affiche_42';
    const espions = [vi.spyOn(console, 'error').mockImplementation(() => undefined), vi.spyOn(console, 'log').mockImplementation(() => undefined)];
    try {
      const m = mondeType();
      const b = banc(m, { jeton: JETON });
      await b.tour();                                  // message envoyé
      await b.verifier(NOW + JOUR);
      b.casse(true);
      await b.tour(NOW + SEMAINE).catch(() => undefined); // envoi raté (503)
      b.casse(false);
      m.github = 'panne';
      await b.tour(NOW + 2 * SEMAINE);                 // GitHub muet
      expect(b.appels.length).toBeGreaterThan(0);
      const stocke = JSON.stringify([
        await b.kv.hgetall(CLES_ZORO.tour), await b.kv.hgetall(CLES_ZORO.signales), await b.kv.lrange(CLES_ZORO.historique, 0, -1),
        await b.kv.get(CLES_ZORO.envoye(creneauDuTour(NOW))), await b.kv.hgetall(CLES.etats), await b.kv.lrange(CLES.journal, 0, -1),
      ]);
      expect(stocke).toContain('app_livraison'); // on a bien lu ce qui est stocké
      expect(stocke).not.toContain(JETON);
      expect(b.envoyes.length).toBeGreaterThan(0);
      for (const t of b.envoyes) expect(t).not.toContain(JETON);
      for (const e of espions) for (const appel of e.mock.calls) expect(JSON.stringify(appel)).not.toContain(JETON);
    } finally {
      for (const e of espions) e.mockRestore();
    }
  });
});

// --- Les actions de la route ----------------------------------------------------------------

describe('traiterActionZoro', () => {
  it('a-envoyer, mac, tour, verifier ; action inconnue → Refus 404 ; mac sans corps → Refus 405', async () => {
    const b = banc({ depots: [] });
    expect(await traiterActionZoro(b.kv, 'a-envoyer', undefined, b.deps, NOW)).toEqual({ demande: false });
    await demanderRapportMac(b.kv);
    expect(await traiterActionZoro(b.kv, 'a-envoyer', undefined, b.deps, NOW)).toEqual({ demande: true });
    expect(await traiterActionZoro(b.kv, 'mac', { dossiers: [dossier()] }, b.deps, NOW)).toEqual({ ok: true });
    expect((await lireRapportMac(b.kv))?.dossiers).toHaveLength(1);
    expect(await traiterActionZoro(b.kv, 'a-envoyer', undefined, b.deps, NOW)).toEqual({ demande: false });
    expect(await traiterActionZoro(b.kv, 'tour', undefined, b.deps, NOW)).toMatchObject({ type: 'tour', quand: NOW });
    expect(await traiterActionZoro(b.kv, 'verifier', undefined, b.deps, NOW)).toMatchObject({ type: 'verifier' });
    const refus = async (action: string, corps: unknown) => {
      const e = await traiterActionZoro(b.kv, action, corps, b.deps, NOW).then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(Refus);
      return (e as Refus).code;
    };
    expect(await refus('autre', undefined)).toBe(404);
    expect(await refus('mac', undefined)).toBe(405);
    expect(await refus('mac', { dossiers: 'x' })).toBe(400);
  });
});
