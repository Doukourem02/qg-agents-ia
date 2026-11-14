import { beforeEach, describe, expect, it } from 'vitest';
import { memoire, type KV } from './memoire';
import { CLES } from './qg';
import { agentsEnPause, lirePauses, mettreEnPause, reprendre, sauterSiEnPause } from './pause-agents';
import { vuesQG } from './vues';

// La pause d'un vrai agent, décidée par le patron. Jeudi 12 novembre 2026, 15:00 (Abidjan = UTC).
const H = 3_600_000;
const T = Date.UTC(2026, 10, 12, 15, 0);
const LUNDI_16 = Date.UTC(2026, 10, 16);
let kv: KV;
beforeEach(() => { kv = memoire(); });

describe('la pause d’un agent', () => {
  it('pendant la pause, la routine qui démarre un passage reçoit « en pause, rien à faire » ; après, le passage a lieu', async () => {
    await mettreEnPause(kv, 'ye', LUNDI_16, T);
    expect(agentsEnPause(await lirePauses(kv), T + H)).toEqual(['ye']);
    expect(await sauterSiEnPause(kv, 'ye', 'a-comparer', T + H)).toEqual({ agentEnPause: true, jusqua: LUNDI_16, message: 'Ye est en pause (par le patron) : rien à faire, arrête-toi.' });
    // un rapport déjà commencé, un Valider : pas un début de passage
    expect(await sauterSiEnPause(kv, 'ye', 'rapport', T + H)).toBeNull();
    expect(await sauterSiEnPause(kv, 'paul', 'a-documenter', T + H)).toBeNull();
    expect(await sauterSiEnPause(kv, 'ye', 'a-comparer', LUNDI_16)).toBeNull();
    // la pause est dite dans le journal (par le patron), jamais comme un travail de l'agent
    const [e] = (await kv.lrange(CLES.journal, 0, -1)).map(v => JSON.parse(v));
    expect(e).toMatchObject({ agent: 'ye', statut: 'en pause', texte: 'en pause (par toi) jusqu’à lundi 16 à 00:00', origine: 'moi' });
  });
  it('Isaac garde la forme que son relais attend : rien d’accepté, aucune mission, rien de proposé', async () => {
    await mettreEnPause(kv, 'isaac', null, T);
    expect(await sauterSiEnPause(kv, 'isaac', 'a-faire', T + H)).toMatchObject({ agentEnPause: true, acceptees: [], missions: [] });
    expect(await sauterSiEnPause(kv, 'isaac', 'proposer', T + H)).toMatchObject({ proposees: [], enAttente: [], ecartees: [] });
    expect(await sauterSiEnPause(kv, 'isaac', 'rapport', T + H)).toBeNull();
  });
  it('reprendre : la pause finit maintenant ; un agent qui n’était pas en pause → false', async () => {
    expect(await reprendre(kv, 'paul', T)).toBe(false);
    await mettreEnPause(kv, 'paul', null, T);
    expect(await reprendre(kv, 'paul', T + 2 * H)).toBe(true);
    expect(await sauterSiEnPause(kv, 'paul', 'a-documenter', T + 3 * H)).toBeNull();
    expect((await lirePauses(kv)).paul).toEqual([{ depuis: T, jusqua: T + 2 * H }]);
  });
  it('une nouvelle pause pendant une pause la prolonge (même début)', async () => {
    await mettreEnPause(kv, 'clara', T + 2 * H, T);
    await mettreEnPause(kv, 'clara', LUNDI_16, T + H);
    expect((await lirePauses(kv)).clara).toEqual([{ depuis: T, jusqua: LUNDI_16 }]);
  });
});

describe('le calendrier et le bureau : « en pause (par toi) », jamais « raté »', () => {
  it('le passage sauté est « en pause », l’agent n’est pas bloqué, son prochain passage est après la pause', async () => {
    await mettreEnPause(kv, 'ye', LUNDI_16, T);
    const v = await vuesQG(kv, T);
    const vendredi = v.calendrier.creneaux.find(c => c.routine === 'ye-portfolio')!;
    expect(vendredi.etat).toBe('pause');
    const ye = v.agents.find(a => a.agent === 'ye')!;
    expect(ye).toMatchObject({ statut: 'au repos', pause: 'en pause (par toi) jusqu’à lundi 16 à 00:00' });
    expect(ye.prochainPassage?.quand).toBe(Date.UTC(2026, 10, 20, 17, 30));
  });
  it('un passage de ce matin manqué pendant la pause n’est pas raté ; sans pause, il l’est', async () => {
    const sans = await vuesQG(kv, T);
    expect(sans.calendrier.creneaux.find(c => c.routine === 'clara-menage' && c.jour === sans.calendrier.aujourdhui)!.etat).toBe('rate');
    expect(sans.agents.find(a => a.agent === 'clara')!.statut).toBe('bloque');
    await mettreEnPause(kv, 'clara', null, Date.UTC(2026, 10, 12, 8));
    const avec = await vuesQG(kv, T);
    expect(avec.calendrier.creneaux.find(c => c.routine === 'clara-menage' && c.jour === avec.calendrier.aujourdhui)!.etat).toBe('pause');
    expect(avec.agents.find(a => a.agent === 'clara')!).toMatchObject({ statut: 'au repos', pause: 'en pause (par toi) jusqu’à ce que tu la reprennes' });
    expect(avec.taches.alerte?.passages ?? []).not.toContain('Clara · 09:00');
  });
  it('Luffy en pause : ni bloqué ni « ne vérifie plus » ; sa ligne le dit', async () => {
    await mettreEnPause(kv, 'luffy', T + 4 * H, T);
    const v = await vuesQG(kv, T + H);
    expect(v.agents.find(a => a.agent === 'luffy')).toMatchObject({ statut: 'au repos', pause: 'en pause (par toi) jusqu’à aujourd’hui à 19:00' });
    expect(v.calendrier.lignes.find(l => l.agent === 'luffy')!.texte).toBe('Luffy : en pause (par toi) jusqu’à aujourd’hui à 19:00');
  });
});
