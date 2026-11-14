import { describe, expect, it, vi } from 'vitest';
import { memoire } from './memoire';
import type { Bouton, Recu } from './telegram';
import type { Sujet } from '@/data/crise';
import { cibler, confirmationIgnore, groupesDe } from '@/data/silence';
import { lireReunions, suivreCrise, type DepsCrise } from './crise/suivi';
import { CLES_SILENCE, envoyerAlerte, lireIgnores, vueSilence } from './silence';
import type { DepsTelegram } from './l/webhook';

vi.mock('server-only', () => ({}));
const { traiterTelegram } = await import('./l/webhook');

// « C'est connu, ignore » et la pause des alertes, dans l'état réel du 12 novembre 2026 : l'API Livreo en panne depuis
// 1 j 21 h (services impayés), un point grave de Léa dans qg, 13 failles critiques de Zoro ; une réunion de crise ouverte
// à 12:40, puis un rappel chaque heure. Heure d'Abidjan = UTC.

const MIN = 60_000, H = 60 * MIN;
const a = (h: number, m: number, j = 12) => Date.UTC(2026, 10, j, h, m);
const PANNE = a(12, 40) - (45 * H); // 1 j 21 h avant 12:40

const livreo = (o: Partial<Sujet> = {}): Sujet => ({
  cle: 'site:api-livreo', genre: 'site', agent: 'luffy', projet: 'Livreo', nom: 'API Livreo', detail: '503', depuis: PANNE, grave: true, ...o,
});
const lea = (id = 'cle|1'): Sujet => ({
  cle: `lea:${id}`, genre: 'lea', agent: 'lea', projet: 'qg', nom: 'qg', detail: 'clé GitHub poussée', depuis: a(9, 0), grave: true,
});
const faille = (n: number, projet = n < 10 ? 'qg' : 'boutique-shop'): Sujet => ({
  cle: `zoro:faille:${projet}:GHSA-${n}`, genre: 'zoro', agent: 'zoro', projet, nom: projet, detail: 'faille critique dans next 15.0.0', depuis: a(9, 0, 10), grave: true,
});
const failles = Array.from({ length: 13 }, (_, i) => faille(i));

function banc(sujets: Sujet[]) {
  const kv = memoire();
  let lus = sujets;
  const recus: { texte: string; boutons?: Bouton[][] }[] = [];
  const envoyer = async (texte: string, boutons?: Bouton[] | Bouton[][]) => {
    recus.push({ texte, ...(boutons ? { boutons: (Array.isArray(boutons[0]) ? boutons : [boutons]) as Bouton[][] } : {}) });
  };
  const lire = async () => ({ sujets: lus, illisibles: [] });
  const deps: DepsTelegram = { envoyer, lire, publier: vi.fn(), telecharger: vi.fn(), rendre: vi.fn(), envoyerImage: vi.fn(), envoyerFichier: vi.fn() } as unknown as DepsTelegram;
  const crise: DepsCrise = { envoyer, lire };
  let n = 0;
  const texte = (t: string, now: number) => traiterTelegram(kv, { type: 'texte', id: `m${++n}`, de: '42', texte: t } satisfies Recu, deps, now);
  const bouton = (donnee: string, now: number) => traiterTelegram(kv, { type: 'bouton', id: `c${++n}`, de: '42', donnee, chat: 42, message: 1 } satisfies Recu, deps, now);
  return { kv, recus, deps, texte, bouton, passe: (now: number) => suivreCrise(kv, crise, now), alertes: (s: Sujet[]) => { lus = s; } };
}

describe('la cible, reconnue par le code', () => {
  const ouverts = [livreo(), lea(), ...failles];
  it('un nom de site ou de projet de Luffy, « Léa », « Zoro » / « failles »', () => {
    for (const t of ['ignore Livreo', 'Livreo c\'est normal, ignore', 'ne t\'inquiète pas pour Livreo', 'ignore l\'API Livreo', 'ignore api-livreo']) {
      expect(cibler(t, ouverts)).toEqual({ quoi: 'groupes', groupes: [{ id: 'site:api-livreo', sujets: [livreo()] }] });
    }
    expect(cibler('tais-toi pour les failles de Zoro', ouverts)).toMatchObject({ quoi: 'groupes', groupes: [{ id: 'zoro' }] });
    expect((cibler('tais-toi pour les failles de Zoro', ouverts) as { groupes: { sujets: Sujet[] }[] }).groupes[0].sujets).toHaveLength(13);
    expect(cibler('ignore Léa', ouverts)).toMatchObject({ quoi: 'groupes', groupes: [{ id: 'lea' }] });
    expect(cibler('ignore les failles de boutique-shop', ouverts)).toMatchObject({ quoi: 'groupes', groupes: [{ id: 'zoro@boutique shop' }] });
  });
  it('un nom pour plusieurs agents (« qg » : Léa et Zoro) : un doute, jamais une supposition', () => {
    const c = cibler('ignore qg', ouverts);
    expect(c).toMatchObject({ quoi: 'doute', tout: { id: '*@qg' } });
    expect(c.quoi === 'doute' && c.groupes.map(g => g.id)).toEqual(['lea@qg', 'zoro@qg']);
  });
  it('rien de nommé : vague ; un nom qui n\'est pas ouvert : rien', () => {
    expect(cibler('ignore ça', ouverts)).toEqual({ quoi: 'vague' });
    expect(cibler('ne t\'inquiète pas', ouverts)).toEqual({ quoi: 'vague' });
    expect(cibler('ignore Boutique', ouverts)).toEqual({ quoi: 'rien', mots: 'boutique' });
  });
  it('la confirmation dit ce qui est compris, ce qui reste visible, et comment annuler', () => {
    expect(confirmationIgnore(groupesDe([livreo()]))).toBe('D\'accord : je ne te parle plus de l\'API Livreo tant qu\'elle reste en panne. Elle reste visible dans la page. Écris « reprends Livreo » pour annuler.');
    expect(confirmationIgnore(groupesDe(failles))).toBe('D\'accord : je ne te parle plus des 13 failles critiques de Zoro dans qg et boutique-shop. Elles restent visibles dans la page. Une nouvelle faille critique te sera signalée. Écris « reprends Zoro » pour annuler.');
    expect(confirmationIgnore(groupesDe([lea()]))).toBe('D\'accord : je ne te parle plus du point grave de Léa dans qg. Il reste visible dans la page. Un nouveau point grave te sera signalé. Écris « reprends Léa » pour annuler.');
  });
});

describe('ignore sur Telegram : la réunion de crise du 12 novembre', () => {
  it('les rappels de la réunion en cours sont plafonnés à 3 (13:40, 14:40, 15:40), puis le silence', async () => {
    const b = banc([livreo(), lea(), ...failles]);
    for (let t = a(12, 40); t <= a(21, 55); t += 5 * MIN) await b.passe(t);
    expect(b.recus).toHaveLength(4);
    expect(b.recus[0].texte).toMatch(/^🔴 Réunion de crise à 12:40 · Livreo en panne depuis 1 j 21 h/);
    expect(b.recus.slice(1).map(r => r.texte.match(/^Livreo toujours en panne depuis [^;]+;/)?.[0])).toEqual([
      'Livreo toujours en panne depuis 1 j 22 h ;', 'Livreo toujours en panne depuis 1 j 23 h ;', 'Livreo toujours en panne depuis 2 j ;',
    ]);
    expect(b.recus.slice(1).map(r => r.texte.match(/prochain point à (\d\d:\d\d)$/)?.[1])).toEqual(['14:00', '15:00', '16:00']);
    // chaque message porte un bouton « Ignorer » par problème (un site, Léa, Zoro)
    for (const r of b.recus) expect(r.boutons?.map(x => x[0].donnee)).toEqual(['ign:site:api-livreo', 'ign:lea', 'ign:zoro']);
    expect(b.recus[0].boutons?.map(x => x[0].texte)).toEqual(['Ignorer API Livreo', 'Ignorer Léa', 'Ignorer les failles de Zoro']);
  });

  it('« ignore Livreo » : confirmé ; Livreo sort de la réunion et des rappels, mais reste visible', async () => {
    const b = banc([livreo(), lea(), ...failles]);
    await b.passe(a(12, 40));
    expect(await b.texte('ignore Livreo', a(13, 10))).toBeNull();
    expect(b.recus[1].texte).toBe('D\'accord : je ne te parle plus de l\'API Livreo tant qu\'elle reste en panne. Elle reste visible dans la page. Écris « reprends Livreo » pour annuler.');
    for (let t = a(13, 15); t <= a(16, 0); t += 5 * MIN) await b.passe(t);
    // la réunion reste ouverte (Léa et Zoro), mais il n'y a plus de panne de site : plus aucun rappel
    expect(b.recus).toHaveLength(2);
    const [r] = await lireReunions(b.kv);
    expect(r.fin).toBeUndefined();
    expect(r.sujets.some(s => s.cle === 'site:api-livreo')).toBe(false);
    expect(r.vus.find(s => s.cle === 'site:api-livreo')).toMatchObject({ ignore: a(13, 10) });
    expect(r.vus.find(s => s.cle === 'site:api-livreo')?.regle).toBeUndefined();
    // la page : ignoré par toi depuis 13:10
    expect(await vueSilence(b.kv, a(16, 0))).toEqual({ pause: null, ignores: [{ groupe: 'site:api-livreo', agent: 'luffy', libelle: 'API Livreo', depuis: a(13, 10), reprendre: 'Livreo' }] });
  });

  it('tout est ignoré : la réunion se termine proprement, un message de fin court, une fois', async () => {
    const b = banc([livreo(), lea(), ...failles]);
    await b.passe(a(12, 40));
    await b.bouton('ign:site:api-livreo', a(13, 0));
    await b.bouton('ign:lea', a(13, 1));
    expect(await b.texte('tais-toi pour les failles de Zoro', a(13, 2))).toBeNull();
    const textes = b.recus.map(r => r.texte);
    expect(textes.slice(1)).toEqual([
      'D\'accord : je ne te parle plus de l\'API Livreo tant qu\'elle reste en panne. Elle reste visible dans la page. Écris « reprends Livreo » pour annuler.',
      'D\'accord : je ne te parle plus du point grave de Léa dans qg. Il reste visible dans la page. Un nouveau point grave te sera signalé. Écris « reprends Léa » pour annuler.',
      'D\'accord : je ne te parle plus des 13 failles critiques de Zoro dans qg et boutique-shop. Elles restent visibles dans la page. Une nouvelle faille critique te sera signalée. Écris « reprends Zoro » pour annuler.',
      '✅ Fin de la réunion de crise à 13:02 · ignoré par toi : API Livreo, point grave de Léa et failles critiques de Zoro · débrief dans le journal',
    ]);
    for (let t = a(13, 5); t <= a(18, 0); t += 5 * MIN) await b.passe(t);
    expect(b.recus).toHaveLength(5);
    expect((await lireReunions(b.kv))[0].fin).toBe(a(13, 2));
  });

  it('il revient tout seul : Livreo revient puis retombe (nouvelle panne) ; un nouveau point grave ; une nouvelle faille', async () => {
    const b = banc([livreo()]);
    await b.texte('ignore Livreo', a(13, 0));
    expect(await lireIgnores(b.kv)).toHaveLength(1);
    // la même panne : toujours ignorée, aucune réunion
    await b.passe(a(13, 5));
    expect(await lireReunions(b.kv)).toEqual([]);
    // Livreo revient : l'ignoré est oublié
    b.alertes([]);
    await b.passe(a(13, 10));
    expect(await lireIgnores(b.kv)).toEqual([]);
    // et retombe : une nouvelle panne, une nouvelle réunion
    b.alertes([livreo({ depuis: a(13, 20) })]);
    await b.passe(a(13, 35));
    expect(b.recus.at(-1)?.texte).toMatch(/^🟠 Incident à 13:35 · Livreo en panne depuis 15 min/);

    const c = banc([lea('cle|1'), faille(1)]);
    await c.texte('ne t\'inquiète pas pour Léa et les failles de Zoro', a(9, 0));
    expect(c.recus[0].texte).toMatch(/^D'accord : je ne te parle plus du point grave de Léa dans qg ni de la faille critique de Zoro dans qg\./);
    await c.passe(a(9, 5));
    expect(await lireReunions(c.kv)).toEqual([]);
    c.alertes([lea('cle|1'), lea('cle|2'), faille(1), faille(2)]);
    await c.passe(a(9, 10));
    const [r] = await lireReunions(c.kv);
    expect(r.sujets.map(s => s.cle).sort()).toEqual(['lea:cle|2', 'zoro:faille:qg:GHSA-2']);
  });

  it('« reprends Livreo » et le bouton « Reprendre » annulent', async () => {
    const b = banc([livreo(), ...failles]);
    await b.texte('ignore Livreo', a(13, 0));
    await b.texte('ignore zoro', a(13, 0));
    expect(await b.texte('reprends Livreo', a(13, 5))).toBe('C\'est reparti : je te reparle de l\'API Livreo.');
    expect((await lireIgnores(b.kv)).every(i => i.genre === 'zoro')).toBe(true);
    expect(await b.bouton('rep:zoro', a(13, 6))).toBe('C\'est reparti : je te reparle des 13 failles critiques de Zoro dans qg et boutique-shop.');
    expect(await lireIgnores(b.kv)).toEqual([]);
    expect(await b.texte('reprends', a(13, 7))).toBe('Je n\'ignore rien en ce moment.');
  });

  it('une cible ambiguë ou absente : des boutons, rien n\'est ignoré sans choix', async () => {
    const b = banc([livreo(), lea(), ...failles]);
    expect(await b.texte('ignore qg', a(13, 0))).toBeNull();
    expect(b.recus[0].texte).toBe('J\'ai plusieurs choses à ce nom : point grave de Léa dans qg ; 10 failles critiques de Zoro dans qg. Laquelle ignorer ?');
    expect(b.recus[0].boutons?.map(r => r[0].donnee)).toEqual(['ign:lea@qg', 'ign:zoro@qg', 'ign:*@qg']);
    expect(await b.texte('ignore ça', a(13, 0))).toBeNull();
    expect(b.recus[1].texte).toMatch(/^Qu'est-ce que je ne dois plus te signaler \?/);
    expect(b.recus[1].boutons?.map(r => r[0].texte)).toEqual(['Ignorer API Livreo', 'Ignorer Léa', 'Ignorer les failles de Zoro']);
    expect(await b.texte('ignore Boutique', a(13, 0))).toBeNull();
    expect(b.recus[2].texte).toMatch(/^Je ne vois rien d'ouvert pour « boutique » en ce moment\./);
    expect(await lireIgnores(b.kv)).toEqual([]);
    // le bouton du doute : seulement les failles de qg
    await b.bouton('ign:zoro@qg', a(13, 1));
    expect((await lireIgnores(b.kv)).map(i => i.cle)).toEqual(failles.slice(0, 10).filter(f => f.projet === 'qg').map(f => f.cle));
  });

  it('« Livreo est revenu ? » est une question pour Kuroro, jamais un « ignore »', async () => {
    const b = banc([livreo()]);
    await b.texte('Livreo est revenu ?', a(13, 0));
    expect(await lireIgnores(b.kv)).toEqual([]);
  });
});

describe('la pause générale', () => {
  it('« pas d\'alertes pendant 2 h » : confirmé ; les alertes attendent, puis un seul message à la fin', async () => {
    const b = banc([]);
    expect(await b.texte('pas d\'alertes pendant 2 h', a(14, 0))).toBe('D\'accord : pas d\'alertes jusqu\'à 16:00. Les questions qui attendent ta réponse et le compte rendu de 08:15 passent quand même ; le reste t\'attend pour la fin de la pause. Écris « reprends les alertes » pour l\'arrêter avant.');
    expect((await vueSilence(b.kv, a(14, 30))).pause).toBe(a(16, 0));
    // une alerte de Luffy et le début d'une réunion pendant la pause : gardés, pas envoyés
    const luffy: string[] = [];
    await envoyerAlerte(b.kv, async t => { luffy.push(t); }, '⚠️ Portfolio ne répond plus (503).', undefined, a(14, 20));
    expect(luffy).toEqual([]);
    b.alertes([livreo({ depuis: a(14, 10) })]);
    for (let t = a(14, 30); t < a(16, 0); t += 5 * MIN) await b.passe(t);
    expect(b.recus).toEqual([]);
    // la pause finit : un seul message, puis le rappel de l'heure reprend son cours normal
    await b.passe(a(16, 0));
    expect(b.recus[0].texte).toBe('🔔 Fin de la pause des alertes. Pendant la pause :\n• ⚠️ Portfolio ne répond plus (503).\n• 🟠 Incident à 14:30 · Livreo en panne depuis 20 min · Kuroro, Stalker et Luffy en salle de réunion · prochain point à 15:00');
    expect(b.recus[1].texte).toMatch(/^Livreo toujours en panne depuis 1 h 50/);
    await b.passe(a(16, 5));
    expect(b.recus).toHaveLength(2);
  });
  it('« silence jusqu\'à demain 8 h », « reprends les alertes », durée manquante, pause trop longue', async () => {
    const b = banc([]);
    expect(await b.texte('silence jusqu\'à demain 8h', a(22, 0))).toMatch(/^D'accord : pas d'alertes jusqu'à demain 08:00\./);
    expect(await b.texte('reprends les alertes', a(23, 0))).toBe('Les alertes reprennent. Rien n\'est arrivé pendant la pause.');
    expect(await b.kv.hgetall(CLES_SILENCE.pause)).toEqual({});
    expect(await b.texte('reprends les alertes', a(23, 1))).toBe('Les alertes ne sont pas en pause.');
    expect(await b.texte('tais-toi', a(23, 2))).toBeNull();
    expect(b.recus[0]).toMatchObject({ texte: 'Une pause des alertes pour combien de temps ?' });
    expect(b.recus[0].boutons?.[0].map(x => x.donnee)).toEqual(['pse:60', 'pse:120', 'pse:d8']);
    expect(await b.bouton('pse:d8', a(23, 3))).toMatch(/jusqu'à demain 08:00/);
    expect(await b.texte('pas d\'alertes pendant 3 jours', a(23, 4))).toBeNull(); // pas une durée lue : une conversation
    expect(await b.texte('silence pendant 72 h', a(23, 4))).toMatch(/^Une pause dure 48 h au plus/);
  });
});
