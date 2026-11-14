import { describe, expect, it } from 'vitest';
import { memoire } from '../memoire';
import { CLES_LIGHT, type Ligne, type Releve } from './releve';
import type { MessageJour } from './api';
import { nomAffiche, vueLight } from './vue';

const NOW = Date.parse('2026-11-09T10:00:00Z');
const AUJ = '2026-11-09';
const HIER = '2026-11-08';

const L = (depot: string, etiquette: string, fichier: string, paquet: string, utilisee: string, derniere: string | undefined, ecart: number, genre: Ligne['genre'] = 'app mobile'): Ligne =>
  ({ depot, etiquette, fichier, genre, paquet, utilisee, ...(derniere ? { derniere } : {}), ecart });

const releve = (jour: string, extra: Partial<Releve> = {}): Releve => ({
  jour, quand: Date.parse(`${jour}T07:00:00Z`),
  lignes: [
    L('moi/PROJET_TERRA', 'projet A', 'package.json', 'expo', '58.0.1', '58.0.19', 0),
    L('moi/app_livraison', 'projet B', 'app_livreo/package.json', 'expo', '55.0.12', '58.0.1', 3),
    L('moi/app_livraison', 'projet B', 'app_livreo/package.json', 'node', '20.0.0', undefined, 0),
    L('moi/app_livraison', 'projet B', 'admin_chrono/package.json', 'expo', '55.0.12', '58.0.1', 3),
    L('moi/app_livraison', 'projet B', 'admin_chrono/package.json', 'next', '15.0.0', '16.0.0', 1, 'site'),
    L('moi/app_livraison', 'projet B', 'package.json', 'react', '19.0.0', '19.1.0', 0),
  ],
  alertes: [
    { cle: 'majeure:typescript:7', type: 'majeure', texte: 'x', texteAnonyme: 'typescript 7 est sorti.' },
    { cle: 'fin:nodejs:20', type: 'fin', texte: 'x', texteAnonyme: 'Le support de Node.js 20 se termine le 2026-04-30.' },
    { cle: 'fin:nodejs:18', type: 'fin', texte: 'x', texteAnonyme: 'Le support de Node.js 18 est terminé.' },
  ],
  lectures: [],
  comptesNonLus: ['pro'], nomsInterdits: [],
  resume: 'Un retard sur projet B, rien sur projet A.', choix: [{ titre: 'Expo 58 pour projet B', url: 'https://a.fr/x', pourquoi: 'utile' }],
  ...extra,
});

async function banc(jours: Record<string, Releve>, messages: Record<string, MessageJour> = {}) {
  const kv = memoire();
  for (const [j, r] of Object.entries(jours)) await kv.hset(CLES_LIGHT.releves, j, JSON.stringify(r));
  for (const [j, m] of Object.entries(messages)) await kv.hset(CLES_LIGHT.messages, j, JSON.stringify(m));
  return kv;
}

describe('vueLight', () => {
  it('les noms sont groupés et montrés, jamais le dépôt ni le chemin', async () => {
    const v = await vueLight(await banc({ [AUJ]: releve(AUJ) }), NOW);
    expect(v.projets.map(p => p.nom).sort()).toEqual(['Livreo', 'Terra']);
    const json = JSON.stringify(v);
    for (const cache of ['moi/', 'package.json', 'retard:', 'fin:nodejs']) expect(json).not.toContain(cache);
  });

  it('noms d\'affichage : table (sans casse) puis règle par défaut', () => {
    expect(nomAffiche('x/PROJET_TERRA')).toBe('Terra');
    expect(nomAffiche('x/BOUTIQUE-Shop')).toBe('Boutique Shop');
    expect(nomAffiche('x/duolingo_clone')).toBe('Duolingo (clone)');
    expect(nomAffiche('x/mon_portfolio')).toBe('Portfolio');
    expect(nomAffiche('x/QG')).toBe('QG');
    expect(nomAffiche('x/projet_mon-super_truc')).toBe('Mon Super Truc');
    expect(nomAffiche('x/app_gestion')).toBe('Gestion');
  });

  it('regroupe par projet, fusionne les lignes identiques et garde le sous-dossier', async () => {
    const v = await vueLight(await banc({ [AUJ]: releve(AUJ) }), NOW);
    const k = v.projets.find(p => p.nom === 'Livreo')!;
    expect(k.genres.sort()).toEqual(['app mobile', 'site']);
    const expo = k.outils.filter(o => o.paquet === 'expo');
    expect(expo).toEqual([{ paquet: 'expo', utilisee: '55.0.12', derniere: '58.0.1', ecart: 3, ou: 'app_livreo, admin_chrono' }]);
    expect(k.outils.find(o => o.paquet === 'react')).toEqual({ paquet: 'react', utilisee: '19.0.0', derniere: '19.1.0', ecart: 0 });
    expect(k.outils).toHaveLength(4);
  });

  it('sous-dossier simple d\'un monorepo', async () => {
    const r = releve(AUJ, { lignes: [L('moi/app_livraison', 'projet A', 'app_livreo/package.json', 'expo', '55.0.0', '58.0.0', 3)] });
    const v = await vueLight(await banc({ [AUJ]: r }), NOW);
    expect(v.projets[0].outils[0].ou).toBe('app_livreo');
    expect(v.projets[0].alertes).toEqual(['Expo 55 → 58 (3 versions de retard)']);
  });

  it('alertes de retard (écart ≥ 2) et de fin rattachées au bon projet', async () => {
    const v = await vueLight(await banc({ [AUJ]: releve(AUJ) }), NOW);
    const k = v.projets.find(p => p.nom === 'Livreo')!;
    expect(k.alertes).toEqual([
      'Expo 55 → 58 (3 versions de retard) dans app_livreo, admin_chrono',
      'Le support de Node.js 20 se termine le 2026-04-30',
    ]);
    expect(v.projets.find(p => p.nom === 'Terra')!.alertes).toEqual([]);
  });

  it('général : majeures dédupliquées', async () => {
    const r = releve(AUJ);
    r.alertes.push({ cle: 'majeure:typescript:7', type: 'majeure', texte: 'x', texteAnonyme: 'typescript 7 est sorti.' });
    const v = await vueLight(await banc({ [AUJ]: r }), NOW);
    expect(v.general).toEqual(['TypeScript 7 est sorti']);
  });

  it('tri : plus d\'alertes d\'abord, puis par nom', async () => {
    const r = releve(AUJ, { lignes: [
      L('x/zebre', 'projet A', 'package.json', 'react', '19.0.0', '19.1.0', 0),
      L('x/alpha', 'projet B', 'package.json', 'react', '19.0.0', '19.1.0', 0),
      L('x/app_livraison', 'projet C', 'package.json', 'expo', '55.0.0', '58.0.0', 3),
    ], alertes: [] });
    const v = await vueLight(await banc({ [AUJ]: r }), NOW);
    expect(v.projets.map(p => p.nom)).toEqual(['Livreo', 'Alpha', 'Zebre']);
  });

  it('résumé et lectures : « projet B » devient « Livreo »', async () => {
    const v = await vueLight(await banc({ [AUJ]: releve(AUJ) }), NOW);
    expect(v.resume).toBe('Un retard sur Livreo, rien sur Terra.');
    expect(v.lectures).toEqual([{ titre: 'Expo 58 pour Livreo', url: 'https://a.fr/x', pourquoi: 'utile' }]);
  });

  it('résumé : les articles suivent (« Le projet B » → « Livreo », « du projet A » → « de Terra »)', async () => {
    const v = await vueLight(await banc({ [AUJ]: releve(AUJ, { resume: 'Le projet B traîne. Rien du projet A, tout au projet B.' }) }), NOW);
    expect(v.resume).toBe('Livreo traîne. Rien de Terra, tout à Livreo.');
  });

  it('une lecture dont l\'adresse ne commence pas par https est écartée', async () => {
    const kv = await banc({ [AUJ]: releve(AUJ, { choix: [
      { titre: 'Piège', url: 'javascript:alert(1)', pourquoi: 'ok' },
      { titre: 'Clair', url: 'http://a.fr', pourquoi: 'ok' },
      { titre: 'Expo', url: 'https://b.fr', pourquoi: 'ok' },
    ] }) });
    const v = await vueLight(kv, NOW);
    expect(v.lectures.map(l => l.url)).toEqual(['https://b.fr']);
  });

  it('sans relevé du jour : celui de la veille, aJour false', async () => {
    const kv = await banc({ [HIER]: releve(HIER) });
    const v = await vueLight(kv, NOW);
    expect(v.aJour).toBe(false);
    expect(v.jour).toBe(HIER);
    expect(v.projets).toHaveLength(2);
  });

  it('aucun relevé : vue vide', async () => {
    const v = await vueLight(await banc({}), NOW);
    expect(v).toMatchObject({ jour: null, aJour: false, projets: [], general: [], lectures: [], historique: [], message: { etat: 'rien' } });
  });

  it('état du message : rien, envoyé, relancé, vu', async () => {
    const m = (extra: Partial<MessageJour>): MessageJour => ({ jour: AUJ, texte: 'texte avec terra', cles: ['a'], relances: [], ...extra });
    const etat = async (msg?: MessageJour) => (await vueLight(await banc({ [AUJ]: releve(AUJ) }, msg ? { [AUJ]: msg } : {}), NOW)).message;
    expect(await etat()).toEqual({ etat: 'rien' });
    expect(await etat(m({ envoye: 100 }))).toEqual({ etat: 'envoye', heure: 100 });
    expect(await etat(m({ envoye: 100, relances: [200, 300] }))).toEqual({ etat: 'relance', heure: 300 });
    expect(await etat(m({ envoye: 100, relances: [200], vu: 400 }))).toEqual({ etat: 'vu', heure: 400 });
  });

  it('historique : 7 jours au plus, alertes du message envoyé sinon du relevé, vu', async () => {
    const jours: Record<string, Releve> = {};
    for (let d = 1; d <= 9; d++) jours[`2026-11-0${d}`] = releve(`2026-11-0${d}`);
    const kv = await banc(jours, { [AUJ]: { jour: AUJ, texte: 't', cles: ['a', 'b'], envoye: 1, vu: 2, relances: [] } });
    const v = await vueLight(kv, NOW);
    expect(v.historique).toHaveLength(7);
    expect(v.historique[0]).toEqual({ jour: AUJ, alertes: 2, vu: true });
    expect(v.historique[1]).toEqual({ jour: HIER, alertes: 3, vu: false });
    expect(v.comptesNonLus).toEqual(['pro']);
  });
});
