import { beforeEach, describe, expect, it } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES_LUFFY, type EtatSite, type Panne } from './vigie';
import { SITES } from './sites';
import { vueLuffy } from './vue';

const MIN = 60_000, JOUR = 86_400_000;
const NOW = Date.UTC(2026, 10, 10, 14, 0);
let kv: KV;
beforeEach(() => { kv = memoire(); });

const etat = (id: string, e: EtatSite) => kv.hset(CLES_LUFFY.etat, id, JSON.stringify(e));
const panne = (p: Panne) => kv.lpush(CLES_LUFFY.pannes, JSON.stringify(p));

describe('vueLuffy', () => {
  it('sans état : tous en ligne, jamais vérifié, endormi', async () => {
    const v = await vueLuffy(kv, NOW);
    expect(v.sites.map(s => s.id)).toEqual(SITES.map(s => s.id));
    expect(v.sites.every(s => s.enLigne && s.depuis === undefined)).toBe(true);
    expect(v).toMatchObject({ pannes7j: [], dernier: null, endormi: true });
  });

  it('panne annoncée : hors ligne depuis le début ; un seul échec : encore en ligne', async () => {
    await etat('boutique', { echecs: 2, depuis: NOW - 30 * MIN, annoncee: true, raison: 'erreur 503', vu: NOW });
    await etat('portfolio', { echecs: 1, depuis: NOW, raison: 'délai dépassé', vu: NOW });
    const v = await vueLuffy(kv, NOW);
    expect(v.sites.find(s => s.id === 'boutique')).toMatchObject({ nom: 'Boutique Stores', enLigne: false, depuis: NOW - 30 * MIN });
    expect(v.sites.find(s => s.id === 'portfolio')!.enLigne).toBe(true);
  });

  it('pannes des 7 derniers jours seulement, durée en mots, panne en cours sans fin', async () => {
    await panne({ site: 'bella', nom: 'studio-deco', debut: NOW - 9 * JOUR, fin: NOW - 8 * JOUR });
    await panne({ site: 'boutique', nom: 'Boutique Stores', debut: NOW - 3 * JOUR, fin: NOW - 3 * JOUR + 130 * MIN });
    await panne({ site: 'api-livreo', nom: 'API Livreo', debut: NOW - 25 * MIN });
    const v = await vueLuffy(kv, NOW);
    expect(v.pannes7j).toEqual([
      { nom: 'API Livreo', debut: NOW - 25 * MIN, duree: '25 min' },
      { nom: 'Boutique Stores', debut: NOW - 3 * JOUR, fin: NOW - 3 * JOUR + 130 * MIN, duree: '2 h 10' },
    ]);
  });

  it('endormi : vrai à 21 min, faux à 19 min', async () => {
    await kv.hset(CLES_LUFFY.dernier, 'quand', String(NOW - 21 * MIN));
    expect(await vueLuffy(kv, NOW)).toMatchObject({ dernier: NOW - 21 * MIN, endormi: true });
    await kv.hset(CLES_LUFFY.dernier, 'quand', String(NOW - 19 * MIN));
    expect((await vueLuffy(kv, NOW)).endormi).toBe(false);
  });

  it('aucun détail technique : pas de raison dans la vue', async () => {
    await etat('boutique', { echecs: 2, depuis: NOW - 30 * MIN, annoncee: true, raison: 'erreur 503', vu: NOW });
    await panne({ site: 'boutique', nom: 'Boutique Stores', debut: NOW - 30 * MIN });
    const texte = JSON.stringify(await vueLuffy(kv, NOW));
    expect(texte).not.toContain('raison');
    expect(texte).not.toContain('503');
  });

  it('état abîmé : comme s\'il n\'y en avait pas', async () => {
    await kv.hset(CLES_LUFFY.etat, 'boutique', '{pas du json');
    await kv.hset(CLES_LUFFY.dernier, 'quand', 'abc');
    const v = await vueLuffy(kv, NOW);
    expect(v.sites.every(s => s.enLigne)).toBe(true);
    expect(v.dernier).toBeNull();
  });
});
