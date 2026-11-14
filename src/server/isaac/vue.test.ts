import { beforeEach, describe, expect, it } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES } from '../qg';
import { CLES_ISAAC, type Proposition } from './api';
import { vueIsaac } from './vue';

const MIN = 60_000, JOUR = 86_400_000, GO = 1024 ** 3;
const NOW = Date.UTC(2026, 10, 10, 14, 0);
let kv: KV;
beforeEach(() => { kv = memoire(); });

const prop = (p: Partial<Proposition> & { id: string }) => kv.hset(CLES_ISAAC.propositions, p.id, JSON.stringify({
  genre: 'cache', libelle: 'caches de Cursor', taille: 4 * GO, impact: 'Cursor les recrée tout seul.', cibles: ['/Users/moi/Library/Caches/Cursor'], statut: 'proposee', quand: NOW - MIN, ...p,
}));

describe('vueIsaac', () => {
  it('sans données : Mac jamais vu, rien de mesuré', async () => {
    expect(await vueIsaac(kv, NOW)).toEqual({
      mac: { enLigne: false, vu: null }, place: null, propositions: [], liberes: { total: 0, liste: [] }, refusees: [], missionsEnAttente: 0,
    });
  });

  it('Mac en ligne sous 15 min, éteint au-delà (missions restent en attente)', async () => {
    await kv.hset(CLES_ISAAC.vu, 'relais', String(NOW - 14 * MIN));
    expect((await vueIsaac(kv, NOW)).mac).toEqual({ enLigne: true, vu: NOW - 14 * MIN });
    await kv.hset(CLES_ISAAC.vu, 'relais', String(NOW - 15 * MIN));
    await kv.lpush(CLES.missions('isaac'), JSON.stringify({ id: 'm1', quand: NOW, agent: 'isaac', texte: 'vide le cache' }));
    const v = await vueIsaac(kv, NOW);
    expect(v.mac).toEqual({ enLigne: false, vu: NOW - 15 * MIN });
    expect(v.missionsEnAttente).toBe(1);
  });

  it('la place : libre et total ; total absent si illisible ou incohérent', async () => {
    await kv.hset(CLES_ISAAC.place, 'mesure', JSON.stringify({ libre: 26 * GO, total: 228 * GO, quand: NOW - MIN }));
    expect((await vueIsaac(kv, NOW)).place).toEqual({ libre: 26 * GO, total: 228 * GO, quand: NOW - MIN });
    await kv.hset(CLES_ISAAC.place, 'mesure', JSON.stringify({ libre: 35 * GO, quand: NOW })); // après un nettoyage : pas de total
    expect((await vueIsaac(kv, NOW)).place).toEqual({ libre: 35 * GO, quand: NOW });
    await kv.hset(CLES_ISAAC.place, 'mesure', 'pas du json');
    expect((await vueIsaac(kv, NOW)).place).toBeNull();
  });

  it('propositions en attente : libellé, taille, impact ; ni cibles, ni chemin, ni id', async () => {
    await prop({ id: 'cache:Cursor' });
    await prop({ id: 'nm:projet', libelle: 'node_modules de projet', quand: NOW - 5 * MIN });
    await prop({ id: 'cache:x', statut: 'oui' });
    await prop({ id: 'cache:y', statut: 'non' });
    const v = await vueIsaac(kv, NOW);
    expect(v.propositions).toEqual([
      { libelle: 'caches de Cursor', taille: 4 * GO, impact: 'Cursor les recrée tout seul.', quand: NOW - MIN },
      { libelle: 'node_modules de projet', taille: 4 * GO, impact: 'Cursor les recrée tout seul.', quand: NOW - 5 * MIN },
    ]);
    const json = JSON.stringify(v);
    expect(json).not.toContain('cibles');
    expect(json).not.toContain('/Users');
    expect(json).not.toContain('cache:');
  });

  it('libéré sur 30 jours : somme et liste, rien au-delà', async () => {
    await prop({ id: 'a', statut: 'faite', libere: 9 * GO, decide: NOW - 2 * JOUR });
    await prop({ id: 'b', libelle: 'simulateurs', statut: 'faite', libere: 3 * GO, decide: NOW - 29 * JOUR });
    await prop({ id: 'c', statut: 'faite', libere: 50 * GO, decide: NOW - 31 * JOUR });
    const v = await vueIsaac(kv, NOW);
    expect(v.liberes.total).toBe(12 * GO);
    expect(v.liberes.liste.map(x => [x.libelle, x.libere])).toEqual([['caches de Cursor', 9 * GO], ['simulateurs', 3 * GO]]);
  });

  it('refus du Mac : la raison n\'est montrée que si c\'est une phrase sans chemin', async () => {
    await prop({ id: 'r1', statut: 'refusee-mac', raison: 'application ouverte', decide: NOW - JOUR });
    await prop({ id: 'r2', libelle: 'autre', statut: 'refusee-mac', raison: 'refus de /Users/moi/Documents/x', decide: NOW - 2 * JOUR });
    const v = await vueIsaac(kv, NOW);
    expect(v.refusees).toEqual([{ libelle: 'caches de Cursor', quand: NOW - JOUR, raison: 'application ouverte' }, { libelle: 'autre', quand: NOW - 2 * JOUR }]);
    expect(JSON.stringify(v)).not.toContain('/Users');
  });

  it('ignore les propositions illisibles', async () => {
    await kv.hset(CLES_ISAAC.propositions, 'z', '{pas du json');
    expect((await vueIsaac(kv, NOW)).propositions).toEqual([]);
  });
});

describe('vueIsaac : relecture finale', () => {
  it('« Libéré » suit la date du nettoyage (faite), pas celle du Oui', async () => {
    await prop({ id: 'a', statut: 'faite', libere: 9 * GO, decide: NOW - 40 * JOUR, faite: NOW - 2 * JOUR });
    const v = await vueIsaac(kv, NOW);
    expect(v.liberes.liste).toEqual([{ libelle: 'caches de Cursor', libere: 9 * GO, quand: NOW - 2 * JOUR }]);
  });
  it('une proposition de plus de 7 jours est marquée expirée ; une expirée n\'est plus en attente', async () => {
    await prop({ id: 'vieille', quand: NOW - 8 * JOUR });
    await prop({ id: 'neuve', libelle: 'node_modules de projet', quand: NOW - JOUR });
    await prop({ id: 'close', statut: 'expiree', quand: NOW - 9 * JOUR });
    const v = await vueIsaac(kv, NOW);
    expect(v.propositions.map(p => [p.libelle, p.expiree ?? false])).toEqual([['node_modules de projet', false], ['caches de Cursor', true]]);
  });
});
