import { beforeEach, describe, expect, it } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES_MAFE, type ReleveMafe } from './releve';
import { vueMafe } from './vue';

// Mardi 10 novembre 2026, 10:00.
const NOW = Date.UTC(2026, 10, 10, 10, 0);
let kv: KV;
beforeEach(() => { kv = memoire(); });

const releve = (jour: string, extra: Partial<ReleveMafe> = {}): ReleveMafe =>
  ({ jour, quand: Date.parse(`${jour}T07:30:00Z`), projets: [], priorite: null, aEcrire: [], ...extra });
const pose = (r: ReleveMafe) => kv.hset(CLES_MAFE.releves, r.jour, JSON.stringify(r));

describe('vueMafe', () => {
  it('sans relevé : releve null, ni note ni message', async () => {
    expect(await vueMafe(kv, NOW)).toEqual({ releve: null, derniereNote: null, message: null });
  });

  it('relevé du jour ou d\'hier : à jour', async () => {
    await pose(releve('2026-11-10'));
    expect((await vueMafe(kv, NOW)).releve?.pasAJour).toBeUndefined();
    await kv.del(CLES_MAFE.releves);
    await pose(releve('2026-11-09'));
    expect((await vueMafe(kv, NOW)).releve?.pasAJour).toBeUndefined();
  });

  it('relevé d\'avant-hier : pasAJour', async () => {
    await pose(releve('2026-11-08'));
    expect((await vueMafe(kv, NOW)).releve).toMatchObject({ jour: '2026-11-08', pasAJour: true });
  });

  it('le lundi, le relevé du vendredi est encore à jour', async () => {
    await pose(releve('2026-11-06'));
    expect((await vueMafe(kv, Date.UTC(2026, 10, 9, 9, 0))).releve?.pasAJour).toBeUndefined();
  });

  it('relevé abîmé : traité comme absent', async () => {
    await kv.hset(CLES_MAFE.releves, '2026-11-10', '{pas du json');
    expect((await vueMafe(kv, NOW)).releve).toBeNull();
  });

  it('dernière note et dernier message', async () => {
    const note = (id: string, nom: string, jour: string, quand: number) =>
      kv.hset(CLES_MAFE.notes, id, JSON.stringify({ id, depot: 'x', nom, jour, markdown: '#', auteur: 'mafe', obsidian: false, quand }));
    await note('a', 'Livreo', '2026-11-05', 100);
    await note('b', 'QG', '2026-11-10', 200);
    await kv.hset(CLES_MAFE.messages, '2026-11-09', JSON.stringify({ jour: '2026-11-09', texte: 'x', envoye: 5 }));
    await kv.hset(CLES_MAFE.messages, '2026-11-10', JSON.stringify({ jour: '2026-11-10', texte: 'x', envoye: 9 }));
    const v = await vueMafe(kv, NOW);
    expect(v.derniereNote).toEqual({ nom: 'QG', jour: '2026-11-10' });
    expect(v.message).toEqual({ jour: '2026-11-10', envoye: 9 });
  });
});
