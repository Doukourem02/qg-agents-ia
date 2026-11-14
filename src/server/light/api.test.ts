import { describe, expect, it } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES, Refus } from '../qg';
import { CLE_BOITE } from '../l/boite';
import { aiguiller } from '../l/routage';
import { CLES_LIGHT, type Releve } from './releve';
import { marquerVu, traiterActionLight, type DepsLight } from './api';

const NOW = Date.parse('2026-11-09T07:00:00Z');
const JOUR = '2026-11-09';
const ALERTE = { cle: 'majeure:expo:58', type: 'majeure' as const, texte: 'expo 58 est sorti. Utilisé dans moi/livreo.', texteAnonyme: 'expo 58 est sorti.' };

function banc(alertes = [ALERTE], echec = false) {
  const kv = memoire();
  const envoyes: { texte: string; boutons?: { texte: string; donnee: string }[] }[] = [];
  let casse = echec;
  const deps: DepsLight = {
    fetch: (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
    jetons: {},
    envoyer: async (texte, boutons) => {
      if (casse) throw new Error('telegram en panne');
      envoyes.push({ texte, boutons });
    },
  };
  const releve: Releve = {
    jour: JOUR, quand: NOW, lignes: [], alertes, comptesNonLus: [], nomsInterdits: ['livreo', 'moi/livreo'],
    lectures: [
      { titre: 'T', url: 'https://a.fr/x', source: 'expo' },
      { titre: 'Notes', url: 'https://github.com/moi/livreo/releases/1', source: 'expo' },
      { titre: 'Codé', url: 'https://a.fr/%4Civreo', source: 'expo' },
    ],
  };
  const semer = () => kv.hset(CLES_LIGHT.releves, JOUR, JSON.stringify(releve));
  const rapport = (corps: Record<string, unknown> = {}, now = NOW) =>
    traiterActionLight(kv, 'rapport', { resume: 'Rien de grave.', lectures: [], ...corps }, deps, now);
  const relance = (now = NOW + 7 * 3600_000) => traiterActionLight(kv, 'relance', {}, deps, now);
  return { kv, envoyes, deps, semer, rapport, relance, repare: () => { casse = false; } };
}

const etatLight = async (kv: KV) => JSON.parse((await kv.hgetall(CLES.etats)).light ?? 'null') as { statut: string; tache: string } | null;

const code = async (p: Promise<unknown>) => p.then(() => 0, (e: unknown) => (e instanceof Refus ? e.code : -1));

describe('traiterActionLight', () => {
  it('rapport avant releve : 409', async () => {
    const b = banc();
    expect(await code(b.rapport())).toBe(409);
  });

  it('rapport avec un nom interdit : 422, rien enregistré ni envoyé', async () => {
    const b = banc(); await b.semer();
    expect(await code(b.rapport({ resume: 'Livreo est en retard.' }))).toBe(422);
    expect(await code(b.rapport({ lectures: [{ titre: 'x', url: 'https://a.fr', pourquoi: 'pour livreo' }] }))).toBe(422);
    expect(b.envoyes).toHaveLength(0);
    expect(JSON.parse((await b.kv.hgetall(CLES_LIGHT.releves))[JOUR]).resume).toBeUndefined();
  });

  it('rapport refusé : le 422 nomme le mot fautif et la zone', async () => {
    const b = banc(); await b.semer();
    const msg = (p: Promise<unknown>) => p.then(() => '', (e: unknown) => (e as Error).message);
    expect(await msg(b.rapport({ resume: 'Livreo est en retard.' }))).toBe('nom de projet interdit : « livreo » dans resume');
    expect(await msg(b.rapport({ lectures: [{ titre: 'x', url: 'https://a.fr/x', pourquoi: 'pour livreo' }] }))).toContain('« livreo » dans lectures');
  });

  it('rapport avec une alerte : envoie le texte réel et le bouton Vu, pose la clé', async () => {
    const b = banc(); await b.semer();
    const r = await b.rapport({ resume: 'Un majeur.', lectures: [{ titre: 'T', url: 'https://a.fr/x', pourquoi: 'utile' }] });
    expect(r).toEqual({ envoye: true, alertes: 1 });
    expect(b.envoyes).toHaveLength(1);
    expect(b.envoyes[0].texte).toContain('moi/livreo');
    expect(b.envoyes[0].texte).toContain('Le détail est sur la fiche de Light.');
    expect(b.envoyes[0].boutons).toEqual([{ texte: 'Vu', donnee: 'vu-light:2026-11-09' }]);
    expect(Object.keys(await b.kv.hgetall(CLES_LIGHT.alertes))).toEqual([ALERTE.cle]);
    const rel = JSON.parse((await b.kv.hgetall(CLES_LIGHT.releves))[JOUR]);
    expect(rel.resume).toBe('Un majeur.');
    expect(rel.choix).toHaveLength(1);
  });

  it('rapport rejoué : pas de 2e envoi, une seule note dans la boîte de L', async () => {
    const b = banc(); await b.semer();
    await b.rapport({ idee: 'Parler des majeurs.' });
    await b.rapport({ idee: 'Parler des majeurs.' });
    expect(b.envoyes).toHaveLength(1);
    const boite = Object.values(await b.kv.hgetall(CLE_BOITE)).map(v => JSON.parse(v));
    expect(boite).toHaveLength(1);
    expect(boite[0]).toMatchObject({ id: 'light-2026-11-09', type: 'note', contenu: 'Idée de Light : Parler des majeurs.' });
  });

  it('envoi en échec : 502, rien consommé ; le rapport suivant envoie', async () => {
    const b = banc([ALERTE], true); await b.semer();
    expect(await code(b.rapport())).toBe(502);
    expect(await b.kv.hgetall(CLES_LIGHT.alertes)).toEqual({});
    b.repare();
    expect(await b.rapport()).toEqual({ envoye: true, alertes: 1 });
    expect(b.envoyes).toHaveLength(1);
  });

  it('deux rapports simultanés : un seul envoi', async () => {
    const b = banc(); await b.semer();
    await Promise.all([b.rapport(), b.rapport()]);
    expect(b.envoyes).toHaveLength(1);
  });

  it('relevé sans alerte : aucun envoi', async () => {
    const b = banc([]); await b.semer();
    expect(await b.rapport()).toEqual({ envoye: false, alertes: 0 });
    expect(b.envoyes).toHaveLength(0);
  });

  it('relance : deux rappels, pas de 3e', async () => {
    const b = banc(); await b.semer(); await b.rapport();
    const r1 = await b.relance() as { relance: boolean; texte: string };
    expect(r1.relance).toBe(true);
    expect(r1.texte.startsWith('Rappel : ')).toBe(true);
    await b.relance(NOW + 12 * 3600_000);
    expect(b.envoyes).toHaveLength(3);
    expect(b.envoyes[2].texte.startsWith('Rappel : ')).toBe(true);
    expect(b.envoyes[2].boutons).toEqual([{ texte: 'Vu', donnee: 'vu-light:2026-11-09' }]);
    expect(await b.relance()).toMatchObject({ relance: false });
    expect(b.envoyes).toHaveLength(3);
  });

  it('relance après Vu, ou sans message du jour : relance false', async () => {
    const b = banc(); await b.semer(); await b.rapport();
    expect(await marquerVu(b.kv, JOUR)).toBe('Noté, plus de rappel aujourd\'hui.');
    expect(await b.relance()).toMatchObject({ relance: false });
    const c = banc();
    expect(await c.relance()).toMatchObject({ relance: false });
  });

  it('lecture hors du relevé, ou URL portant un nom (même encodé) : 422', async () => {
    const b = banc(); await b.semer();
    const l = (url: string) => ({ lectures: [{ titre: 'T', url, pourquoi: 'utile' }] });
    expect(await code(b.rapport(l('https://ailleurs.fr/x')))).toBe(422);
    expect(await code(b.rapport(l('https://github.com/moi/livreo/releases/1')))).toBe(422);
    expect(await code(b.rapport(l('https://a.fr/%4Civreo')))).toBe(422);
    expect(b.envoyes).toHaveLength(0);
    expect(await b.rapport(l('https://a.fr/x'))).toEqual({ envoye: true, alertes: 1 });
  });

  it('état de Light : erreur si le relevé casse, en pause si le rapport est refusé, erreur sur 502, termine sinon', async () => {
    const b = banc([ALERTE], true);
    const kvCasse: KV = { ...b.kv, hset: async (k, f, v) => { if (k === CLES_LIGHT.releves) throw new Error('kv en panne'); return b.kv.hset(k, f, v); } };
    await expect(traiterActionLight(kvCasse, 'releve', {}, b.deps, NOW)).rejects.toThrow('kv en panne');
    expect(await etatLight(b.kv)).toMatchObject({ statut: 'erreur' });
    expect(await code(b.rapport())).toBe(409);
    expect(await etatLight(b.kv)).toEqual(expect.objectContaining({ statut: 'en pause', tache: 'relevé fait, résumé à reprendre' }));
    await b.semer();
    expect(await code(b.rapport({ resume: 'Livreo !' }))).toBe(422);
    expect(await etatLight(b.kv)).toMatchObject({ statut: 'en pause' });
    expect(await code(b.rapport({ resume: 'x'.repeat(601) }))).toBe(400);
    expect(await etatLight(b.kv)).toMatchObject({ statut: 'en pause' });
    expect(await code(b.rapport())).toBe(502);
    expect(await etatLight(b.kv)).toMatchObject({ statut: 'erreur' });
    b.repare();
    await b.rapport();
    expect(await etatLight(b.kv)).toMatchObject({ statut: 'termine' });
  });

  it('Vu touché pendant l\'envoi d\'un rappel : vu est gardé', async () => {
    const b = banc(); await b.semer(); await b.rapport();
    const deps: DepsLight = { ...b.deps, envoyer: async () => { await marquerVu(b.kv, JOUR, NOW + 7 * 3600_000); } };
    expect(await traiterActionLight(b.kv, 'relance', {}, deps, NOW + 7 * 3600_000)).toMatchObject({ relance: true });
    const m = JSON.parse((await b.kv.hgetall(CLES_LIGHT.messages))[JOUR]);
    expect(m.vu).toBe(NOW + 7 * 3600_000);
    expect(m.relances).toHaveLength(1);
    expect(await b.relance()).toMatchObject({ relance: false });
  });

  it('deux relances simultanées : un seul rappel', async () => {
    const b = banc(); await b.semer(); await b.rapport();
    await Promise.all([b.relance(), b.relance()]);
    expect(b.envoyes).toHaveLength(2);
    const m = JSON.parse((await b.kv.hgetall(CLES_LIGHT.messages))[JOUR]);
    expect(m.relances).toHaveLength(1);
  });

  it('marquerVu sur un jour inconnu', async () => {
    expect(await marquerVu(memoire(), '2026-01-01')).toBe('Ce relevé n\'existe plus.');
  });

  it('action inconnue : 404', async () => {
    const b = banc();
    expect(await code(traiterActionLight(b.kv as KV, 'zut', {}, b.deps, NOW))).toBe(404);
  });

  it('releve : écrit l\'état et renvoie le relevé', async () => {
    const b = banc();
    const r = await traiterActionLight(b.kv, 'releve', {}, b.deps, NOW) as Releve;
    expect(r.jour).toBe(JOUR);
  });

  it('releve : allume l\'icône GitHub de Light dans la page', async () => {
    const b = banc();
    await traiterActionLight(b.kv, 'releve', {}, b.deps, NOW);
    const etat = JSON.parse((await b.kv.hgetall(CLES.etats)).light);
    expect(etat).toMatchObject({ statut: 'au travail', outil: 'GH' });
  });
});

describe('aiguiller vu-light', () => {
  const btn = (donnee: string) => ({ type: 'bouton' as const, id: 'c', de: '1', donnee, chat: 1, message: 2 });
  it('route le bouton', () => {
    expect(aiguiller(btn('vu-light:2026-11-09'))).toEqual({ vers: 'vu-light', jour: '2026-11-09' });
    expect(aiguiller(btn('vu-light:'))).toEqual({ vers: 'rien' });
  });
});
