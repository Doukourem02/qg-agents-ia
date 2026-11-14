import { describe, expect, it } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES, Refus } from '../qg';
import { SITES } from './sites';
import { CLES_LUFFY, duree, traiterActionLuffy, verifier, type EtatSite, type Panne } from './vigie';

const T0 = Date.parse('2026-11-10T10:00:00Z');
const MIN = 60_000;
const HEURE = 60 * MIN;

type Reponse = number | 'delai' | 'reseau';
function banc(depart: Record<string, Reponse> = {}) {
  const kv = memoire();
  const envoyes: string[] = [];
  const rep: Record<string, Reponse> = Object.fromEntries(SITES.map(s => [s.id, 200]));
  Object.assign(rep, depart);
  let casse = false;
  const appels: string[] = [];
  const boutons: ({ texte: string; donnee: string }[][] | undefined)[] = [];
  const deps = {
    fetch: (async (url: string, init?: RequestInit) => {
      appels.push(url);
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('manual');
      expect((init?.headers as Record<string, string>)['User-Agent']).toBe('QG-Vigie/1.0');
      const id = SITES.find(s => s.url === url)!.id;
      const r = rep[id];
      if (r === 'delai') throw new DOMException('timeout', 'TimeoutError');
      if (r === 'reseau') throw new TypeError('fetch failed');
      return new Response('', { status: r });
    }) as unknown as typeof fetch,
    envoyer: async (t: string, b?: { texte: string; donnee: string }[][]) => { if (casse) throw new Error('telegram en panne'); envoyes.push(t); boutons.push(b); },
  };
  return {
    kv, envoyes, boutons, deps, appels, rep,
    passe: (now: number) => verifier(kv, deps, now),
    casse: (v: boolean) => { casse = v; },
  };
}
const etats = async (kv: KV) => Object.fromEntries(Object.entries(await kv.hgetall(CLES_LUFFY.etat)).map(([k, v]) => [k, JSON.parse(v) as EtatSite]));
const pannes = async (kv: KV) => (await kv.lrange(CLES_LUFFY.pannes, 0, -1)).map(v => JSON.parse(v) as Panne);
const agent = async (kv: KV) => JSON.parse((await kv.hgetall(CLES.etats)).luffy ?? 'null') as { statut: string; tache: string; outil?: string } | null;

describe('duree', () => {
  it('minutes, heures, jours', () => {
    expect(duree(5 * MIN)).toBe('5 min');
    expect(duree(130 * MIN)).toBe('2 h 10');
    expect(duree(120 * MIN)).toBe('2 h');
    expect(duree((3 * 24 * 60 + 4 * 60) * MIN)).toBe('3 j 4 h');
    expect(duree(0)).toBe('1 min');
    expect(duree(59.6 * MIN)).toBe('1 h');
    expect(duree(119.6 * MIN)).toBe('2 h');
    expect(duree(23 * HEURE + 59.6 * MIN)).toBe('1 j');
    expect(duree(3 * 24 * HEURE + 23.6 * HEURE)).toBe('4 j');
  });
});

describe('verifier', () => {
  it('tout répond : aucun message, passage compté', async () => {
    const b = banc();
    const r = await b.passe(T0);
    expect(r).toEqual({ alertes: [], retours: [] });
    expect(b.envoyes).toEqual([]);
    expect(b.appels.length).toBe(SITES.length);
    expect((await b.kv.hgetall(CLES_LUFFY.dernier)).quand).toBe(String(T0));
    expect((await agent(b.kv))).toMatchObject({ statut: 'termine', tache: 'vérifie les sites' });
    expect((await agent(b.kv))?.outil).toBeUndefined();
  });

  it('1 échec : pas de message ; 2 échecs : un message avec la raison ; 3e : rien de plus', async () => {
    const b = banc({ boutique: 503 });
    await b.passe(T0);
    expect(b.envoyes).toEqual([]);
    const r = await b.passe(T0 + 5 * MIN);
    expect(b.envoyes).toEqual(['⚠️ Boutique Stores ne répond plus (erreur 503).']);
    expect(r).toMatchObject({ alertes: ['⚠️ Boutique Stores ne répond plus (erreur 503).'] });
    expect((await agent(b.kv))?.outil).toBe('Tg');
    await b.passe(T0 + 10 * MIN);
    expect(b.envoyes.length).toBe(1);
    expect((await agent(b.kv))?.outil).toBeUndefined();
  });

  it('raisons : délai dépassé, site introuvable ; un bouton « Ignorer » par site tombé', async () => {
    const b = banc({ portfolio: 'delai', bella: 'reseau' });
    await b.passe(T0); await b.passe(T0 + 5 * MIN);
    expect(b.envoyes.length).toBe(1);
    expect(b.boutons[0]).toEqual([[{ texte: 'Ignorer Portfolio', donnee: 'ign:site:portfolio' }], [{ texte: 'Ignorer studio-deco', donnee: 'ign:site:bella' }]]);
    expect(b.envoyes[0]).toContain('⚠️ Portfolio ne répond plus (délai dépassé).');
    expect(b.envoyes[0]).toContain('⚠️ studio-deco ne répond plus (site introuvable).');
  });

  it('retour : message avec la durée, panne close dans le journal', async () => {
    const b = banc({ boutique: 503 });
    await b.passe(T0); await b.passe(T0 + 5 * MIN);
    expect((await pannes(b.kv))).toEqual([{ site: 'boutique', nom: 'Boutique Stores', debut: T0 }]);
    b.rep.boutique = 200;
    const r = await b.passe(T0 + 10 * MIN);
    expect(b.envoyes[1]).toBe('✅ Boutique Stores est revenu, panne de 10 min.');
    expect(b.boutons[1]).toBeUndefined(); // un retour n'a rien à ignorer
    expect(r).toMatchObject({ retours: ['✅ Boutique Stores est revenu, panne de 10 min.'] });
    expect(await pannes(b.kv)).toEqual([{ site: 'boutique', nom: 'Boutique Stores', debut: T0, fin: T0 + 10 * MIN }]);
    expect((await etats(b.kv)).boutique.echecs).toBe(0);
  });

  it('RF 2 : échec / réussite / échec : jamais d\'alerte', async () => {
    const b = banc({ boutique: 503 });
    await b.passe(T0);
    b.rep.boutique = 200; await b.passe(T0 + 5 * MIN);
    b.rep.boutique = 503; await b.passe(T0 + 10 * MIN);
    expect(b.envoyes).toEqual([]);
    expect((await etats(b.kv)).boutique.echecs).toBe(1);
  });

  it('deux sites qui tombent ensemble : un seul message', async () => {
    const b = banc({ boutique: 500, solidar: 'reseau' });
    await b.passe(T0); await b.passe(T0 + 5 * MIN);
    expect(b.envoyes.length).toBe(1);
    expect(b.envoyes[0].split('\n').length).toBe(2);
  });

  it('tous les sites en échec : passage ignoré, compteurs inchangés, rien envoyé', async () => {
    const b = banc({ boutique: 503 });
    await b.passe(T0);
    for (const s of SITES) b.rep[s.id] = 'reseau';
    const avant = await etats(b.kv);
    const r = await b.passe(T0 + 5 * MIN);
    expect(r).toMatchObject({ ignore: true });
    expect(await etats(b.kv)).toEqual(avant);
    expect(b.envoyes).toEqual([]);
    expect((await b.kv.hgetall(CLES_LUFFY.dernier)).quand).toBe(String(T0));
  });

  it('RF 1 : deux passages simultanés : un seul compte, un seul message', async () => {
    const b = banc({ boutique: 503 });
    await b.passe(T0); // 1er échec
    const [x, y] = await Promise.all([b.passe(T0 + 5 * MIN), b.passe(T0 + 5 * MIN)]);
    const occupes = [x, y].filter(r => 'occupe' in r);
    expect(occupes).toEqual([{ occupe: true }]);
    expect(b.envoyes.length).toBe(1);
    expect((await etats(b.kv)).boutique.echecs).toBe(2);
  });

  it('la réponse est libérée (corps annulé)', async () => {
    const b = banc();
    let annules = 0;
    const base = b.deps.fetch;
    b.deps.fetch = (async (u: string, i?: RequestInit) => {
      const r = await (base as (u: string, i?: RequestInit) => Promise<Response>)(u, i);
      Object.defineProperty(r, 'body', { value: { cancel: async () => { annules++; } } });
      return r;
    }) as unknown as typeof fetch;
    await b.passe(T0);
    expect(annules).toBe(SITES.length);
  });

  it('un échec Telegram est journalisé sans détail', async () => {
    const b = banc({ boutique: 503 });
    b.casse(true);
    const vus: unknown[][] = [];
    const orig = console.error; console.error = (...a: unknown[]) => { vus.push(a); };
    try { await b.passe(T0); await b.passe(T0 + 5 * MIN); } finally { console.error = orig; }
    expect(vus).toEqual([['luffy : envoi Telegram échoué']]);
  });

  it('le verrou est levé après un passage', async () => {
    const b = banc();
    await b.passe(T0);
    expect(await b.kv.get(CLES_LUFFY.verrou)).toBeNull();
  });

  it('RF 3 : panne de 3 jours : un seul message, durée en jours', async () => {
    const b = banc({ boutique: 503 });
    await b.passe(T0); await b.passe(T0 + 5 * MIN);
    for (const k of [10, 60, 1000, 4000]) await b.passe(T0 + k * MIN);
    expect(b.envoyes.length).toBe(1);
    b.rep.boutique = 200;
    await b.passe(T0 + (3 * 24 * 60 + 4 * 60) * MIN);
    expect(b.envoyes.length).toBe(2);
    expect(b.envoyes[1]).toBe('✅ Boutique Stores est revenu, panne de 3 j 4 h.');
  });

  it('RF 4 : Telegram en panne : l\'alerte repart au passage suivant', async () => {
    const b = banc({ boutique: 503 });
    b.casse(true);
    await b.passe(T0);
    const r = await b.passe(T0 + 5 * MIN); // ne jette pas
    expect(r).toMatchObject({ alertes: [] });
    expect(b.envoyes).toEqual([]);
    expect((await etats(b.kv)).boutique.annoncee).toBeFalsy();
    expect((await b.kv.hgetall(CLES_LUFFY.dernier)).quand).toBe(String(T0 + 5 * MIN));
    expect(await pannes(b.kv)).toEqual([]);
    expect((await agent(b.kv))?.outil).toBeUndefined();
    b.casse(false);
    await b.passe(T0 + 10 * MIN);
    expect(b.envoyes).toEqual(['⚠️ Boutique Stores ne répond plus (erreur 503).']);
    expect((await etats(b.kv)).boutique.annoncee).toBe(true);
    expect((await agent(b.kv))?.outil).toBe('Tg');
  });

  it('RF 4 : retour d\'une panne jamais annoncée : aucun message', async () => {
    const b = banc({ boutique: 503 });
    b.casse(true);
    await b.passe(T0); await b.passe(T0 + 5 * MIN);
    b.casse(false); b.rep.boutique = 200;
    await b.passe(T0 + 10 * MIN);
    expect(b.envoyes).toEqual([]);
  });

  it('un « revenu » non parti repart au passage suivant', async () => {
    const b = banc({ boutique: 503 });
    await b.passe(T0); await b.passe(T0 + 5 * MIN);
    b.rep.boutique = 200; b.casse(true);
    await b.passe(T0 + 10 * MIN);
    expect(b.envoyes.length).toBe(1);
    expect((await pannes(b.kv))[0].fin).toBeUndefined();
    b.casse(false);
    await b.passe(T0 + 15 * MIN);
    expect(b.envoyes[1]).toBe('✅ Boutique Stores est revenu, panne de 15 min.');
    expect((await pannes(b.kv))[0].fin).toBe(T0 + 15 * MIN);
  });

  it('plages normales : API Livreo 404 normal, Boutique 404 panne, Admin Livreo 307 normal', async () => {
    const b = banc({ 'api-livreo': 404, 'admin-livreo': 307 });
    await b.passe(T0); await b.passe(T0 + 5 * MIN);
    expect(b.envoyes).toEqual([]);
    b.rep.boutique = 404;
    await b.passe(T0 + 10 * MIN); await b.passe(T0 + 15 * MIN);
    expect(b.envoyes).toEqual(['⚠️ Boutique Stores ne répond plus (erreur 404).']);
    b.rep['api-livreo'] = 503;
    await b.passe(T0 + 20 * MIN); await b.passe(T0 + 25 * MIN);
    expect(b.envoyes[1]).toBe('⚠️ API Livreo ne répond plus (erreur 503).');
  });

  it('le journal des pannes oublie ce qui a plus de 30 jours', async () => {
    const b = banc();
    const vieille: Panne = { site: 'bella', nom: 'studio-deco', debut: T0 - 40 * 86_400_000, fin: T0 - 39 * 86_400_000 };
    const recente: Panne = { site: 'bella', nom: 'studio-deco', debut: T0 - 5 * 86_400_000, fin: T0 - 4 * 86_400_000 };
    await b.kv.lpush(CLES_LUFFY.pannes, JSON.stringify(vieille));
    await b.kv.lpush(CLES_LUFFY.pannes, JSON.stringify(recente));
    await b.passe(T0);
    expect(await pannes(b.kv)).toEqual([recente]);
  });
});

describe('journal global', () => {
  it('50 passages tranquilles : le journal ne bouge pas, l\'historique des autres survit, l\'état en direct est à jour', async () => {
    const b = banc();
    for (let i = 0; i < 20; i++) await b.kv.lpush(CLES.journal, JSON.stringify({ quand: T0 - i, agent: 'L', type: 'etat', texte: `t${i}` }));
    const avant = await b.kv.lrange(CLES.journal, 0, -1);
    for (let i = 0; i < 50; i++) await b.passe(T0 + i * 5 * MIN);
    expect(await b.kv.lrange(CLES.journal, 0, -1)).toEqual(avant);
    expect(await agent(b.kv)).toMatchObject({ tache: 'vérifie les sites' });
  });

  it('une alerte puis un retour : une entrée chacun, avec Tg', async () => {
    const b = banc({ boutique: 503 });
    await b.passe(T0); await b.passe(T0 + 5 * MIN);
    b.rep.boutique = 200;
    await b.passe(T0 + 10 * MIN);
    const j = (await b.kv.lrange(CLES.journal, 0, -1)).map(v => JSON.parse(v) as { agent: string; texte: string; resultat?: string });
    expect(j.map(e => e.texte)).toEqual(['prévient : Boutique Stores revenu', 'prévient : Boutique Stores en panne']);
    expect(JSON.stringify(j)).not.toContain('503');
  });
});

describe('traiterActionLuffy', () => {
  it('« verifier » seulement ; le reste : 404', async () => {
    const b = banc();
    const e = await traiterActionLuffy(b.kv, 'zzz', b.deps, T0).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Refus);
    expect((e as Refus).code).toBe(404);
    expect(await traiterActionLuffy(b.kv, 'verifier', b.deps, T0)).toEqual({ alertes: [], retours: [] });
  });
});
