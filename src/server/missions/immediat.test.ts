import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES, lireEtat } from '../qg';
import type { Recu } from '../telegram';
import type { DepsTelegram } from '../l/webhook';
import { CLES_LUFFY } from '../luffy/vigie';
import { CLES_SILENCE } from '../silence';
import { lirePauses, mettreEnPause, pauseEnCours } from '../pause-agents';
import type { DepsImmediat } from './immediat';

vi.mock('server-only', () => ({}));
const { executerActions, immediatDepuisPage, pasEnPause, resultatZoro } = await import('./immediat');
const { traiterTelegram } = await import('../l/webhook');
const { CLES_RELAIS } = await import('../kuroro-relais');

// Les actions immédiates, faites par le code. Jeudi 12 novembre 2026, 15:00 (Abidjan = UTC).
const T = Date.UTC(2026, 10, 12, 15, 0);
const D = T - 3 * 3_600_000;
let kv: KV;
let recus: string[];
let travaux: (() => Promise<void>)[];
/** Les sites répondent 200, sauf l'API Livreo (503). */
const fetchSites = (async (url: string) => new Response(null, { status: String(url).includes('api.livreo') ? 503 : 200 })) as unknown as typeof fetch;
const immediat = (): DepsImmediat => ({
  envoyer: async (t) => { recus.push(t); },
  luffy: () => ({ fetch: fetchSites, envoyer: async (t) => { recus.push(`alerte : ${t}`); } }),
  zoro: () => ({ fetch: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch, envoyer: async (t) => { recus.push(t); }, jeton: undefined, linkedin: async () => null, echeance: 2_000 }),
  plusTard: (t) => { travaux.push(t); },
});
const finir = async () => { for (const t of travaux.splice(0)) await t(); };
const msg = (texte: string): Recu => ({ type: 'texte', id: 'm1', de: '42', texte });
const depsT = () => ({ envoyer: async (t: string) => { recus.push(t); }, lire: async () => ({ sujets: [], illisibles: [] }), immediat: immediat() }) as unknown as DepsTelegram;

/** L'API Livreo est en panne depuis 3 h, annoncée, et le patron a dit de l'ignorer. */
async function livreoEnPanneIgnoree() {
  await kv.hset(CLES_LUFFY.etat, 'api-livreo', JSON.stringify({ echecs: 30, depuis: D, annoncee: true, raison: 'erreur 503', vu: T - 300_000 }));
  await kv.hset(CLES_SILENCE.ignores, 'site:api-livreo', JSON.stringify({ cle: 'site:api-livreo', genre: 'site', agent: 'luffy', projet: 'Livreo', nom: 'API Livreo', detail: '503', depuis: D, grave: true, ignoreDepuis: T - 3_600_000 }));
}

beforeEach(() => { kv = memoire(); recus = []; travaux = []; });

describe('Luffy vérifie les sites à la demande', () => {
  it('la réponse tout de suite, puis le résultat sur Telegram (« API Livreo en panne (ignorée) »), et le journal', async () => {
    await livreoEnPanneIgnoree();
    const r = await executerActions(kv, [{ type: 'luffy-verifier' }], 'telegram', immediat(), T);
    expect(r).toEqual({ texte: 'Luffy vérifie tes sites maintenant : le résultat arrive ici dans une minute.', agents: ['luffy'] });
    expect(recus).toEqual([]);
    await finir();
    expect(recus).toEqual(['Luffy a vérifié : 5 sites en ligne, API Livreo en panne (ignorée).']);
    expect((await lireEtat(kv)).journal[0]).toMatchObject({ agent: 'luffy', texte: 'a vérifié les sites à ta demande', resultat: 'Luffy a vérifié : 5 sites en ligne, API Livreo en panne (ignorée).' });
  });
  it('tous en ligne ; un premier échec est dit tel quel (pas « en panne »)', async () => {
    await executerActions(kv, [{ type: 'luffy-verifier' }], 'page', immediat(), T);
    await finir();
    expect(recus).toEqual(['Luffy a vérifié : 5 sites en ligne, API Livreo ne répond pas (premier échec : il revérifie dans 5 min).']);
  });
});

describe('Zoro refait le tour à la demande', () => {
  it('le tour « verifier » (celui du bouton), puis le résultat sur Telegram', async () => {
    const r = await executerActions(kv, [{ type: 'zoro-verifier' }], 'telegram', immediat(), T);
    expect(r?.texte).toBe('Zoro refait le tour de sécurité maintenant (quelques minutes) : le résultat arrive ici.');
    await finir();
    expect(recus).toHaveLength(1);
    expect(recus[0]).toMatch(/^Zoro a refait le tour de sécurité : /);
    expect(recus[0]).toContain('Pas lu cette fois : GitHub');
  });
  it('un tour déjà en cours : il le dit', async () => {
    expect(await resultatZoro(kv, { occupe: true })).toBe('Zoro faisait déjà un tour de sécurité : son résultat est dans son bureau d’ici quelques minutes.');
  });
});

describe('pause et reprise', () => {
  it('« mets Ye en pause cette semaine » : rangée, confirmée ; « reprends Paul » sans pause → null', async () => {
    const r = await executerActions(kv, [{ type: 'pause-agent', agent: 'ye', jusqua: Date.UTC(2026, 10, 16) }], 'telegram', immediat(), T);
    expect(r?.texte).toMatch(/^D’accord : Ye est en pause jusqu’à lundi 16 à 00:00\./);
    expect(pauseEnCours(await lirePauses(kv), 'ye', T + 1)).toEqual({ depuis: T, jusqua: Date.UTC(2026, 10, 16) });
    expect(await executerActions(kv, [{ type: 'reprendre-agent', agent: 'paul' }], 'telegram', immediat(), T)).toBeNull();
    expect((await executerActions(kv, [{ type: 'reprendre-agent', agent: 'ye' }], 'telegram', immediat(), T + 60_000))?.texte).toBe('Ye reprend : ses prochains passages ont lieu comme prévu.');
  });
  it('une fin déjà passée : il demande jusqu’à quand, rien n’est rangé', async () => {
    const r = await executerActions(kv, [{ type: 'pause-agent', agent: 'ye', jusqua: T - 1 }], 'telegram', immediat(), T);
    expect(r?.texte).toContain('Je n’ai pas compris jusqu’à quand');
    expect(await lirePauses(kv)).toEqual({});
  });
  it('la barre de mission : la même action, avec la mission pour la page', async () => {
    expect(await immediatDepuisPage(kv, 'mets Paul en pause', immediat(), T)).toMatchObject({ mission: { agent: 'paul', nom: 'Paul' } });
    expect(await immediatDepuisPage(kv, 'reprends Clara', immediat(), T)).toEqual({ texte: pasEnPause('clara'), mission: { agent: 'clara', nom: 'Clara' } });
    expect(await immediatDepuisPage(kv, 'mes sites sont en ligne ?', immediat(), T)).toBeNull();
  });
});

describe('sur Telegram : avant les commandes et avant Kuroro', () => {
  it('« vérifie mes sites » : la réponse du code, le résultat ensuite, jamais le modèle', async () => {
    await livreoEnPanneIgnoree();
    expect(await traiterTelegram(kv, msg('vérifie mes sites'), depsT(), T)).toBe('Luffy vérifie tes sites maintenant : le résultat arrive ici dans une minute.');
    await finir();
    expect(recus).toEqual(['Luffy a vérifié : 5 sites en ligne, API Livreo en panne (ignorée).']);
    expect(await kv.lrange(CLES_RELAIS.demandes, 0, -1)).toEqual([]);
  });
  it('« mets Ye en pause cette semaine », puis « reprends Ye »', async () => {
    expect(await traiterTelegram(kv, msg('mets Ye en pause cette semaine'), depsT(), T)).toMatch(/^D’accord : Ye est en pause jusqu’à lundi 16 à 00:00/);
    expect(await traiterTelegram(kv, msg('reprends Ye'), depsT(), T + 60_000)).toBe('Ye reprend : ses prochains passages ont lieu comme prévu.');
  });
  it('« reprends Paul » sans pause ni ignoré : dit honnêtement ; « reprends Livreo » reste la commande des ignorés', async () => {
    expect(await traiterTelegram(kv, msg('reprends Paul'), depsT(), T)).toBe('Paul n’est pas en pause : rien à reprendre.');
    expect(await traiterTelegram(kv, msg('reprends Livreo'), depsT(), T)).toBe('Je n\'ignore rien en ce moment.');
  });
  it('« reprends Luffy » sans pause, mais un site de Luffy ignoré : la reprise des ignorés', async () => {
    await livreoEnPanneIgnoree();
    const r = await traiterTelegram(kv, msg('reprends Luffy'), depsT(), T);
    expect(r).not.toBe(pasEnPause('luffy'));
    expect(await kv.hgetall(CLES_SILENCE.ignores)).toEqual({});
  });
  it('une question n’est jamais une action : elle va à Kuroro', async () => {
    await mettreEnPause(kv, 'luffy', null, T - 1);
    await traiterTelegram(kv, msg('mes sites sont en ligne ?'), depsT(), T);
    expect(travaux).toEqual([]);
    expect(await kv.lrange(CLES.missions('luffy'), 0, -1)).toEqual([]);
  });
});
