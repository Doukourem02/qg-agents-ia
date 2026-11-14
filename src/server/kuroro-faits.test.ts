import { beforeEach, describe, expect, it } from 'vitest';
import { memoire, type KV } from './memoire';
import { CLES } from './qg';
import { ROUTINES, vuesQG } from './vues';
import { OU, aProposDe, aujourdhui, controleDe, corrigerHeures, heures, moment, ouArrive } from './kuroro-faits';
import { faitsKuroro, sansRoutines } from './kuroro';
import FICHIER from '@/data/connaissances.json';

// Jeudi 12 novembre 2026, 07:53 à Abidjan (= UTC) : le matin où le patron attendait le point de Mafe sur Telegram.
const JEUDI = Date.UTC(2026, 10, 12, 7, 53);
let kv: KV;
beforeEach(() => { kv = memoire(); });
const entree = (agent: string, quand: number, texte: string) =>
  kv.lpush(CLES.journal, JSON.stringify({ quand, agent, type: 'etat', statut: 'termine', texte, origine: 'agent' }));
const agentDe = (f: ReturnType<typeof faitsKuroro>, id: string) => f.agents.find(a => a.id === id) as Record<string, unknown>;

describe('Les faits rédigés pour Kuroro', () => {
  it('jeudi 07:53 : Mafe a fait son point à 07:38, dans la page ; sur Telegram, c’est le mardi et le vendredi', async () => {
    await entree('mafe', Date.UTC(2026, 10, 12, 7, 38), 'point du matin');
    const vues = await vuesQG(kv, JEUDI);
    expect(aujourdhui('mafe', vues, JEUDI)).toEqual([
      'Point du matin : fait aujourd’hui à 07:38, dans la page (son bureau), pas sur Telegram.',
      'Prochain passage : Point du matin, demain vendredi à 07:30.',
    ]);
    expect(ouArrive('mafe', JEUDI)).toEqual([
      'Point du matin : du lundi au vendredi à 07:30, dans la page (son bureau), pas sur Telegram.',
      'Où tu t\'es arrêté : le mardi à 10:00, sur Telegram.',
      'Bilan de la semaine : le vendredi à 17:00, sur Telegram.',
    ]);
    expect(aujourdhui('light', vues, JEUDI)).toEqual(['Relevé des versions : pas encore passé aujourd’hui, prévu à 08:00, dans la page ; sur Telegram seulement s’il y a une alerte.']);
    // le compte rendu du matin de Kuroro : mis en service ce jeudi à 11:30, le premier part demain
    expect(aujourdhui('kuroro', vues, JEUDI)).toEqual(['Compte rendu du matin : pas aujourd’hui (pas encore en service à 08:15) ; le premier : demain vendredi à 08:15.']);
    expect(moment(JEUDI)).toBe('il est 07:53, jeudi matin (12 novembre 2026)');
  });

  it('dans les faits donnés au modèle : des phrases prêtes, jamais « devrait », et le dernier passage n’est pas répété', async () => {
    await entree('mafe', Date.UTC(2026, 10, 12, 7, 38), 'point du matin');
    const f = faitsKuroro(await vuesQG(kv, JEUDI), JEUDI);
    const mafe = agentDe(f, 'mafe');
    // la journée de chacun vient à part, juste avant l'heure (la fin du prompt)
    expect(Object.keys(f).slice(-3)).toEqual(['ce_qui_t_attend', 'aujourd_hui', 'heure_abidjan']);
    expect(f.ce_qui_t_attend).toEqual(['Rien ne t’attend.']);
    expect(f.aujourd_hui.Mafe).toContain('Point du matin : fait aujourd’hui à 07:38, dans la page (son bureau), pas sur Telegram.');
    expect(f.aujourd_hui['Kuroro (toi)']).toEqual(['Compte rendu du matin : pas aujourd’hui (pas encore en service à 08:15) ; le premier : demain vendredi à 08:15.']);
    expect(f.aujourd_hui).not.toHaveProperty('Luffy');
    expect(mafe).toMatchObject({ elle: true, ou_arrive: expect.arrayContaining(['Bilan de la semaine : le vendredi à 17:00, sur Telegram.']) });
    expect(mafe.dernier_passage).toBeUndefined();
    expect(agentDe(f, 'kuroro')).toMatchObject({ c_est_toi: true, ou_arrive: [
      'Compte rendu du matin : chaque jour à 08:15, sur Telegram, un seul message, même si tout va bien (pas encore en service).',
      'QG · missions : chaque jour toutes les heures de 08:00 à 20:00, sur Telegram, le résultat de chaque mission ; seulement s’il y a des missions en attente (pas encore en service).',
    ] });
    expect(agentDe(f, 'isaac')).toMatchObject({ en_service: true, lit_les_missions_de_la_barre: true });
    expect(agentDe(f, 'clara').lit_les_missions_de_la_barre).toBeUndefined();
    // les agents simulés : seulement leur rôle
    expect(agentDe(f, 'malenia')).toEqual({ id: 'malenia', nom: 'Malenia', role: expect.any(String), en_service: false });
    expect(f.heure_abidjan).toBe('il est 07:53, jeudi matin (12 novembre 2026)');
    expect(JSON.stringify(f)).not.toMatch(/devrait/i);
  });

  it('pendant l’heure du passage : « pas encore fini » ; une heure après sans rien : « raté »', async () => {
    const pendant = Date.UTC(2026, 10, 13, 7, 45), apres = Date.UTC(2026, 10, 13, 9, 30); // vendredi 13
    expect(aujourdhui('mafe', await vuesQG(kv, pendant), pendant)[0]).toBe('Point du matin : prévu à 07:30, pas encore fini (compté raté s’il n’a rien envoyé à 08:30).');
    const v = await vuesQG(kv, apres);
    expect(aujourdhui('mafe', v, apres)).toEqual([
      'Point du matin : raté aujourd’hui (prévu à 07:30, rien n’est arrivé).',
      'Bilan de la semaine : pas encore passé aujourd’hui, prévu à 17:00, sur Telegram.',
    ]);
    expect(aujourdhui('kuroro', v, apres)[0]).toBe('Compte rendu du matin : raté aujourd’hui (prévu à 08:15, rien n’est arrivé).');
  });

  it('un jour sans passage, une routine en pause', async () => {
    const samedi = Date.UTC(2026, 10, 14, 10, 0);
    const v = await vuesQG(kv, samedi);
    expect(aujourdhui('mafe', v, samedi)).toEqual(['Rien de prévu aujourd’hui (samedi) ; prochain passage : Point du matin, lundi 16 à 07:30.']);
    const v2 = await vuesQG(kv, JEUDI);
    expect(aujourdhui('L', v2, JEUDI)[0]).toBe('Rédige un brouillon de post : en pause par le patron (prévu à 06:00, rien n’est fait pour l’instant).');
    expect(ouArrive('L', JEUDI)).toContain('Rédige un brouillon de post : le mardi et le jeudi à 06:00, sur Telegram, pour ton accord (en pause pour l’instant).');
  });

  it('chaque routine dit où arrive son travail', () => {
    for (const r of ROUTINES) expect(OU[r.id], r.id).toBeTruthy();
  });

  it('le moment de la journée', () => {
    expect(moment(Date.UTC(2026, 10, 12, 2, 5))).toBe('il est 02:05, jeudi dans la nuit (12 novembre 2026)');
    expect(moment(Date.UTC(2026, 10, 12, 12, 30))).toContain('jeudi midi');
    expect(moment(Date.UTC(2026, 10, 12, 15, 0))).toContain('jeudi après-midi');
    expect(moment(Date.UTC(2026, 10, 12, 19, 0))).toContain('jeudi soir');
  });

  it('la routine de la fiche (Notion) est retirée pour les agents dont le code donne les horaires', () => {
    const c = sansRoutines(FICHIER as Parameters<typeof sansRoutines>[0]);
    expect(c.personnages.find(p => p.id === 'mafe')!.routine).toBeUndefined();
    expect(c.personnages.find(p => p.id === 'kuroro')!.routine).toBeUndefined();
    expect(c.personnages.find(p => p.id === 'mafe')).toMatchObject({ statut: expect.any(String) });
  });

  it('les heures exactes, pas de compte en minutes : rien ne change d’une minute à l’autre, sauf l’heure', async () => {
    await entree('mafe', Date.UTC(2026, 10, 12, 7, 38), 'point du matin');
    const vues = await vuesQG(kv, JEUDI);
    const sans = (f: object) => JSON.stringify({ ...f, heure_abidjan: undefined });
    expect(sans(faitsKuroro(vues, JEUDI + 60_000))).toBe(sans(faitsKuroro(vues, JEUDI)));
  });

  it('les faits utiles au message sont redits à la fin : l’agent dont il parle, ou ce qui l’attend', async () => {
    await entree('mafe', Date.UTC(2026, 10, 12, 7, 38), 'point du matin');
    const f = faitsKuroro(await vuesQG(kv, JEUDI), JEUDI);
    const matin = aProposDe('ca va le point du matin n\'est pas encore arrivé sur mon telegram c\'est normal ?', f);
    expect(matin).toMatch(/^Les faits utiles à son message/);
    expect(matin).toContain('Mafe : Point du matin : fait aujourd’hui à 07:38, dans la page (son bureau), pas sur Telegram.');
    expect(matin).toContain('Bilan de la semaine : le vendredi à 17:00, sur Telegram.');
    // « telegram » : le compte rendu du matin de Kuroro aussi
    expect(matin).toContain('Kuroro (toi) : Compte rendu du matin');
    expect(aProposDe('vite fait, y a un truc urgent ?', f)).toContain('Ce qui t\'attend : ');
    expect(aProposDe('et L ?', f)).toContain('L : ');
    // « l'a » n'est pas L ; une salutation ne parle de personne
    expect(aProposDe('il l\'a fait ?', f)).not.toContain('\nL : ');
    expect(aProposDe('salut', f)).toBe('');
  });

  it('le filet : une heure que les faits ne donnent pas est retirée, la journée de l’agent redite mot pour mot', async () => {
    await entree('mafe', Date.UTC(2026, 10, 12, 7, 38), 'point du matin');
    await entree('paul', Date.UTC(2026, 10, 12, 0, 24), 'a relu la semaine');
    const c = controleDe(faitsKuroro(await vuesQG(kv, JEUDI), JEUDI));
    expect(heures('à 7h37, 7 h 38, 08:15 et 8 h')).toEqual(['07:37', '07:38', '08:15', '08:00']);
    // juste : rien ne change
    const juste = 'Pardon frère : Mafe a fait son point à 07:38, mais le jeudi elle le met dans la page ; sur Telegram, c’est le mardi à 10:00 et le vendredi à 17:00.';
    expect(corrigerHeures(juste, c)).toBe(juste);
    // 07:37 (recopié d'un exemple) : la phrase part, la vraie revient
    expect(corrigerHeures('Pardon patron. Mafe a fait son point à 07:37, dans la page. Tu veux que je te le résume ?', c))
      .toBe('Pardon patron. Tu veux que je te le résume ? Mafe : Point du matin : fait aujourd’hui à 07:38, dans la page (son bureau), pas sur Telegram.');
    // « elle » : l'agent de la phrase d'avant
    expect(corrigerHeures('Mafe est passée. Elle l’a fait à 7h20.', c)).toBe('Mafe est passée. Mafe : Point du matin : fait aujourd’hui à 07:38, dans la page (son bureau), pas sur Telegram.');
    // « fait à 18:00 » quand 18:00 n'est que prévu
    expect(corrigerHeures('Paul a fait son passage à 18:00.', c)).toBe('Paul : README et CLAUDE.md : pas encore passé aujourd’hui, prévu à 18:00, sur Telegram (Valider/Refuser).');
    expect(corrigerHeures('Paul passe à 18:00, sur Telegram.', c)).toBe('Paul passe à 18:00, sur Telegram.');
    // une heure sans agent nommé, connue nulle part : retirée ; rien d'autre à dire : ''
    expect(corrigerHeures('Tout a été fait à 06:12.', c)).toBe('');
    expect(corrigerHeures('Je t’envoie le compte rendu chaque matin à 08:15 sur Telegram.', c)).toBe('Je t’envoie le compte rendu chaque matin à 08:15 sur Telegram.');
  });
});
