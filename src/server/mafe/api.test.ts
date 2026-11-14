import { describe, expect, it } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES, Refus } from '../qg';
import { CLE_BOITE } from '../l/boite';
import { CLES_MAFE, type ReleveMafe } from './releve';
import { traiterActionMafe, type DepsMafeApi, type NoteSeance } from './api';

const MARDI = Date.parse('2026-11-10T10:00:00Z');
const MERCREDI = Date.parse('2026-11-11T10:00:00Z');
const VENDREDI = Date.parse('2026-11-13T17:00:00Z');
const jourDe = (n: number) => new Date(n).toISOString().slice(0, 10);

const ID = '2026-11-09:mon-compte/qg';
const A_ECRIRE = { id: ID, depot: 'mon-compte/qg', nom: 'QG', jour: '2026-11-09', jours: ['2026-11-09'], commits: [{ date: '2026-11-09T10:00:00Z', message: 'm', url: 'https://github.com/x' }] };

function banc(echec = false) {
  const kv = memoire();
  const envoyes: string[] = [];
  let casse = echec;
  const deps: DepsMafeApi = {
    fetch: (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
    jeton: 'jeton-test',
    envoyer: async (texte) => { if (casse) throw new Error('telegram en panne'); envoyes.push(texte); },
  };
  const semer = (now: number, extra: Partial<ReleveMafe> = {}) => {
    const r: ReleveMafe = { jour: jourDe(now), quand: now, projets: [], priorite: null, aEcrire: [A_ECRIRE], ...extra };
    return kv.hset(CLES_MAFE.releves, r.jour, JSON.stringify(r));
  };
  const agir = (action: string, corps: Record<string, unknown>, now = MARDI) => traiterActionMafe(kv, action, corps, deps, now);
  return { kv, envoyes, deps, semer, agir, repare: () => { casse = false; } };
}
const code = async (p: Promise<unknown>) => p.then(() => 0, (e: unknown) => (e instanceof Refus ? e.code : -1));
const etat = async (kv: KV) => JSON.parse((await kv.hgetall(CLES.etats)).mafe ?? 'null') as { statut: string; tache: string; outil?: string } | null;
const releveDe = async (kv: KV, now: number) => JSON.parse((await kv.hgetall(CLES_MAFE.releves))[jourDe(now)]) as ReleveMafe;
const TG = 'Commence par QG — une tâche urgente attend.\nQG : suite X.';

describe('traiterActionMafe', () => {
  it('action inconnue : 404', async () => {
    expect(await code(banc().agir('zzz', {}))).toBe(404);
  });

  it('releve : le jeton manquant donne 503 et l\'état passe en erreur', async () => {
    const b = banc(); b.deps.jeton = undefined;
    expect(await code(b.agir('releve', {}))).toBe(503);
    expect((await etat(b.kv))?.statut).toBe('erreur');
  });

  it('rafraichir : même échec propre sans jeton', async () => {
    const b = banc(); b.deps.jeton = undefined;
    expect(await code(b.agir('rafraichir', {}))).toBe(503);
  });

  it('rafraichir : sa propre tâche, état terminé juste après le relevé (aucune icône GitHub allumée)', async () => {
    const b = banc();
    b.deps.fetch = (async (u: RequestInfo | URL) => new Response(String(u).includes('/user/repos') ? '[]' : 'nope', { status: String(u).includes('/user/repos') ? 200 : 404 })) as unknown as typeof fetch;
    await b.agir('rafraichir', {});
    const e = await etat(b.kv);
    expect(e).toMatchObject({ statut: 'termine', tache: 'relevé rafraîchi depuis le Mac' });
    expect(e?.outil).toBeUndefined();
    await b.agir('releve', {});
    expect((await etat(b.kv))?.tache).toBe('relevé des projets');
  });

  it('la note garde les jours que le relevé lui donne (ancien relevé : le jour seul)', async () => {
    const b = banc(); await b.semer(MARDI, { aEcrire: [{ ...A_ECRIRE, jours: ['2026-11-07', '2026-11-09'] }] });
    expect((await b.agir('note', { id: ID, markdown: '# n' }) as NoteSeance).jours).toEqual(['2026-11-07', '2026-11-09']);
    const c = banc(); const { jours: _j, ...ancien } = A_ECRIRE; void _j; await c.semer(MARDI, { aEcrire: [ancien as typeof A_ECRIRE] });
    expect((await c.agir('note', { id: ID, markdown: '# n' }) as NoteSeance).jours).toEqual(['2026-11-09']);
  });

  describe('point', () => {
    it('refuse un détail technique dans la phrase de la page (422)', async () => {
      const b = banc(); await b.semer(MARDI);
      for (const phrase of ['Commence par Portfolio (vercel.com → Settings)', 'Lance `pnpm dev`', 'Va sur https://x.y', 'Ouvre mon-portfolio/settings']) {
        expect(await code(b.agir('point', { phrase }))).toBe(422);
      }
      expect(await code(b.agir('point', { phrase: 'Commence par Portfolio : une tâche urgente attend.' }))).toBe(0);
    });
    it('refuse sans relevé du jour (409)', async () => {
      expect(await code(banc().agir('point', { phrase: 'ok' }))).toBe(409);
    });
    it('refuse une phrase absente ou trop longue', async () => {
      const b = banc(); await b.semer(MARDI);
      expect(await code(b.agir('point', {}))).toBe(400);
      expect(await code(b.agir('point', { phrase: 'a'.repeat(401) }))).toBe(400);
    });
    it('range la phrase dans le relevé et termine l\'état', async () => {
      const b = banc(); await b.semer(MARDI);
      await b.agir('point', { phrase: 'Commence par QG.' });
      expect((await releveDe(b.kv, MARDI)).phrase).toBe('Commence par QG.');
      const e = await etat(b.kv);
      expect(e?.statut).toBe('termine'); expect(e?.tache).toBe('point du matin');
    });
  });

  describe('envoyer', () => {
    it('mardi : envoie une fois, état Tg', async () => {
      const b = banc(); await b.semer(MARDI);
      expect(await b.agir('envoyer', { telegram: TG })).toMatchObject({ envoye: true });
      expect(b.envoyes).toEqual([TG]);
      expect(await etat(b.kv)).toMatchObject({ statut: 'termine', tache: 'envoie le point sur Telegram', outil: 'Tg' });
    });
    it('deux envoyer le même mardi : un seul message part (rejeu)', async () => {
      const b = banc(); await b.semer(MARDI);
      await b.agir('envoyer', { telegram: TG });
      expect(await b.agir('envoyer', { telegram: TG })).toMatchObject({ envoye: false });
      expect(b.envoyes).toHaveLength(1);
    });
    it('deux envoyer simultanés : un seul message part', async () => {
      const b = banc(); await b.semer(MARDI);
      await Promise.all([b.agir('envoyer', { telegram: TG }), b.agir('envoyer', { telegram: TG })]);
      expect(b.envoyes).toHaveLength(1);
    });
    it('un mercredi : 409, aucun appel', async () => {
      const b = banc(); await b.semer(MERCREDI);
      expect(await code(b.agir('envoyer', { telegram: TG }, MERCREDI))).toBe(409);
      expect(b.envoyes).toHaveLength(0);
    });
    it('texte qui ne commence pas par « Commence par » ou trop long : 400', async () => {
      const b = banc(); await b.semer(MARDI);
      expect(await code(b.agir('envoyer', { telegram: 'Salut' }))).toBe(400);
      expect(await code(b.agir('envoyer', { telegram: 'Commence par ' + 'a'.repeat(1500) }))).toBe(400);
      expect(await code(b.agir('envoyer', {}))).toBe(400);
      expect(b.envoyes).toHaveLength(0);
    });
    it('sans relevé du jour : 409', async () => {
      const b = banc();
      expect(await code(b.agir('envoyer', { telegram: TG }))).toBe(409);
      expect(b.envoyes).toHaveLength(0);
    });
    it('Telegram en échec : 502, verrou libéré, nouvel essai possible', async () => {
      const b = banc(true); await b.semer(MARDI);
      expect(await code(b.agir('envoyer', { telegram: TG }))).toBe(502);
      expect(await b.kv.get(`mafe:envoi:${jourDe(MARDI)}`)).toBeNull();
      expect(Object.keys(await b.kv.hgetall(CLES_MAFE.messages))).toHaveLength(0);
      b.repare();
      expect(await b.agir('envoyer', { telegram: TG })).toMatchObject({ envoye: true });
      expect(b.envoyes).toHaveLength(1);
    });
    it('vendredi sans bilan : 422, rien envoyé', async () => {
      const b = banc(); await b.semer(VENDREDI);
      expect(await code(b.agir('envoyer', { telegram: TG }, VENDREDI))).toBe(422);
      expect(b.envoyes).toHaveLength(0);
    });
    it('vendredi : bilan rangé dans le relevé et déposé chez L', async () => {
      const b = banc(); await b.semer(VENDREDI);
      await b.agir('envoyer', { telegram: TG, bilan: 'QG a bien avancé.' }, VENDREDI);
      expect((await releveDe(b.kv, VENDREDI)).bilan).toBe('QG a bien avancé.');
      const boite = JSON.parse((await b.kv.hgetall(CLE_BOITE))['mafe-2026-11-13']);
      expect(boite).toMatchObject({ type: 'note', contenu: 'Bilan de la semaine (Mafe) : QG a bien avancé.' });
      expect(b.envoyes).toHaveLength(1);
    });
    it('vendredi : le dépôt chez L a échoué après l\'envoi, le rejeu le rattrape sans renvoyer Telegram', async () => {
      const b = banc(); await b.semer(VENDREDI);
      const hset = b.kv.hset.bind(b.kv); let casse = true;
      b.kv.hset = async (k, c, v) => { if (casse && k === CLE_BOITE) throw new Error('kv en panne'); return hset(k, c, v); };
      await expect(b.agir('envoyer', { telegram: TG, bilan: 'Bilan.' }, VENDREDI)).rejects.toThrow();
      casse = false;
      expect(await b.agir('envoyer', { telegram: TG, bilan: 'Bilan.' }, VENDREDI)).toMatchObject({ envoye: false });
      expect(b.envoyes).toHaveLength(1);
      expect((await releveDe(b.kv, VENDREDI)).bilan).toBe('Bilan.');
      expect(Object.keys(await b.kv.hgetall(CLE_BOITE))).toEqual(['mafe-2026-11-13']);
      await b.agir('envoyer', { telegram: TG, bilan: 'Bilan.' }, VENDREDI);
      expect(Object.keys(await b.kv.hgetall(CLE_BOITE))).toHaveLength(1);
    });
    it('vendredi : bilan trop long : 400', async () => {
      const b = banc(); await b.semer(VENDREDI);
      expect(await code(b.agir('envoyer', { telegram: TG, bilan: 'a'.repeat(1001) }, VENDREDI))).toBe(400);
    });
    it('le mardi, un bilan éventuel est ignoré', async () => {
      const b = banc(); await b.semer(MARDI);
      await b.agir('envoyer', { telegram: TG, bilan: 'x' });
      expect((await releveDe(b.kv, MARDI)).bilan).toBeUndefined();
      expect(Object.keys(await b.kv.hgetall(CLE_BOITE))).toHaveLength(0);
    });
  });

  describe('note / notion / a-copier / copie', () => {
    const MD = '---\ndate: 2026-11-09\nprojet: QG\nauteur: mafe\n---\n## Ce qu\'on a fait\n- x';
    const lireNote = async (kv: KV) => JSON.parse((await kv.hgetall(CLES_MAFE.notes))[ID]) as NoteSeance;

    it('note : id hors de aEcrire : 422', async () => {
      const b = banc(); await b.semer(MARDI);
      expect(await code(b.agir('note', { id: 'autre', markdown: MD }))).toBe(422);
      expect(Object.keys(await b.kv.hgetall(CLES_MAFE.notes))).toHaveLength(0);
    });
    it('note : markdown absent ou trop long : 400', async () => {
      const b = banc(); await b.semer(MARDI);
      expect(await code(b.agir('note', { id: ID }))).toBe(400);
      expect(await code(b.agir('note', { id: ID, markdown: 'a'.repeat(4001) }))).toBe(400);
    });
    it('note : rangée avec ses champs, obsidian false', async () => {
      const b = banc(); await b.semer(MARDI);
      const n = await b.agir('note', { id: ID, markdown: MD }, MARDI) as NoteSeance;
      expect(n).toMatchObject({ id: ID, depot: 'mon-compte/qg', nom: 'QG', jour: '2026-11-09', markdown: MD, auteur: 'mafe', obsidian: false, quand: MARDI });
      expect(await lireNote(b.kv)).toEqual(n);
    });
    it('note rejouée : même objet, notion conservé, rien de changé', async () => {
      const b = banc(); await b.semer(MARDI);
      const premiere = await b.agir('note', { id: ID, markdown: MD }) as NoteSeance;
      await b.agir('notion', { id: ID, url: 'https://www.notion.so/page-1' });
      const rejeu = await b.agir('note', { id: ID, markdown: 'AUTRE TEXTE' }, MARDI + 5000) as NoteSeance;
      expect(rejeu.notion).toBe('https://www.notion.so/page-1');
      expect(rejeu.markdown).toBe(MD);
      expect(rejeu.quand).toBe(premiere.quand);
      expect(Object.keys(await b.kv.hgetall(CLES_MAFE.notes))).toHaveLength(1);
    });
    it('notion : enregistre l\'adresse, garde la première, refuse une fausse adresse', async () => {
      const b = banc(); await b.semer(MARDI);
      await b.agir('note', { id: ID, markdown: MD });
      expect(await code(b.agir('notion', { id: ID, url: 'http://evil.fr' }))).toBe(422);
      expect(await code(b.agir('notion', { id: ID, url: 'https://exemple.fr/x' }))).toBe(422);
      for (const mauvais of ['https://notion.so.evil.fr/a', 'https://evil.fr/notion.so', 'https://notion.fr/a', 'https://evilnotion.so/a', 'https://x.notion.com/a'])
        expect(await code(b.agir('notion', { id: ID, url: mauvais }))).toBe(422);
      for (const bon of ['https://notion.so/a', 'https://app.notion.com/a', 'https://mon.notion.site/a'])
        expect((await b.agir('notion', { id: ID, url: bon }) as NoteSeance).notion).toBeDefined();
      await b.kv.hdel(CLES_MAFE.notes, ID);
      await b.agir('note', { id: ID, markdown: MD });
      expect(await code(b.agir('notion', { id: 'inconnu', url: 'https://www.notion.so/a' }))).toBe(404);
      await b.agir('notion', { id: ID, url: 'https://www.notion.so/a' });
      const n = await b.agir('notion', { id: ID, url: 'https://www.notion.so/b' }) as NoteSeance;
      expect(n.notion).toBe('https://www.notion.so/a');
    });
    it('a-copier puis copie : seules les notes pas encore copiées, puis plus aucune', async () => {
      const b = banc(); await b.semer(MARDI);
      await b.agir('note', { id: ID, markdown: MD });
      expect(await b.agir('a-copier', {})).toMatchObject([{ id: ID, obsidian: false }]);
      await b.agir('copie', { ids: [ID, 'inconnu'] });
      expect((await lireNote(b.kv)).obsidian).toBe(true);
      expect(await b.agir('a-copier', {})).toEqual([]);
    });
    it('copie : ids doit être une liste de textes', async () => {
      expect(await code(banc().agir('copie', { ids: 'x' }))).toBe(400);
      expect(await code(banc().agir('copie', {}))).toBe(400);
    });
  });
});
