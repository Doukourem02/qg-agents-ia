import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from './memoire';
import { CLES } from './qg';
import { SCHEMA_LOCAL, SCHEMA_SANS_MISSION } from '@/sim/kuroro-ia';

vi.mock('server-only', () => ({}));
const { CLES_RELAIS, LIMITE_MS, deposerDemande, ecrireReponse, lireReponse, macDisponible, prochaineDemande, reveiller, signalerAllume, signalerMac } = await import('./kuroro-relais');

let kv: KV;
const T = Date.UTC(2026, 10, 11, 9, 0);
const conv = [{ role: 'moi', texte: 'qui est en charge de mon Mac ?' }];
const missions = async (agent: string) => (await kv.lrange(CLES.missions(agent), 0, -1)).map(v => JSON.parse(v));
beforeEach(() => { kv = memoire(); });

describe('Kuroro par le Mac : le Mac vu', () => {
  it('pas vu : indisponible ; vu il y a moins de 30 s : disponible ; plus : indisponible', async () => {
    expect(await macDisponible(kv, T)).toBe(false);
    await signalerMac(kv, T);
    expect(await macDisponible(kv, T + 5_000)).toBe(true);
    expect(await macDisponible(kv, T + 25_000)).toBe(true);
    expect(await macDisponible(kv, T + 45_000)).toBe(false);
  });
  it('sans Mac vu, la demande n’est pas stockée : la page reprend ses règles', async () => {
    expect(await deposerDemande(kv, { messages: conv }, T)).toEqual({ mac: false });
    expect(await kv.lrange(CLES_RELAIS.demandes, 0, -1)).toEqual([]);
  });
});

describe('Kuroro par le Mac : le réveil', () => {
  it('la page réveille le Mac : au plus un réveil par 30 s, lu par le Mac dans la file', async () => {
    expect(await reveiller(kv, T)).toEqual({ reveil: true });
    expect(await reveiller(kv, T + 10_000)).toEqual({ reveil: false });
    expect(await kv.lrange(CLES_RELAIS.demandes, 0, -1)).toEqual(['eveil']);
    expect(await prochaineDemande(kv, T + 11_000)).toMatchObject({ eveil: true, isaac: false, demande: null });
    expect(await prochaineDemande(kv, T + 12_000)).toEqual({ eveil: false, isaac: false, demande: null });
    expect(await reveiller(kv, T + 31_000)).toEqual({ reveil: true });
  });
  it('le réveil apporte le prompt à lire à l’avance : le début exact de celui de la demande qui suivra (l’humeur en plus, à la fin)', async () => {
    await signalerMac(kv, T);
    await reveiller(kv, T);
    const r = await prochaineDemande(kv, T + 1_000);
    expect(r.prechauffage).toMatchObject({ modele: 'qwen3:8b' });
    await deposerDemande(kv, { messages: conv }, T + 2_000);
    const { demande } = await prochaineDemande(kv, T + 3_000);
    expect(demande!.systeme.startsWith(r.prechauffage!.systeme)).toBe(true);
    // « qui est en charge de mon Mac ? » : les faits d'Isaac redits, puis l'humeur
    expect(demande!.systeme.slice(r.prechauffage!.systeme.length)).toMatch(/^\n\nLes faits utiles à son message [^\n]*\nIsaac : [^\n]+\n\nhumeur_de_patron \(son dernier message\) : \S+/);
  });
  it('le réveil puis une demande : le Mac reçoit les deux d’un coup', async () => {
    await signalerMac(kv, T);
    await reveiller(kv, T);
    const { id } = await deposerDemande(kv, { messages: conv }, T) as { id: string };
    expect(await prochaineDemande(kv, T + 500)).toMatchObject({ eveil: true, demande: { id } });
  });
});

describe('Kuroro par le Mac : la demande', () => {
  beforeEach(async () => { await signalerMac(kv, T); });

  it('valide la conversation comme la route de Claude (12 tours, 300 caractères, le dernier de moi)', async () => {
    await expect(deposerDemande(kv, { messages: [{ role: 'moi', texte: 'x'.repeat(301) }] }, T)).rejects.toMatchObject({ code: 400 });
    await expect(deposerDemande(kv, { messages: [{ role: 'kuroro', texte: 'salut' }] }, T)).rejects.toMatchObject({ code: 400 });
    await expect(deposerDemande(kv, {}, T)).rejects.toMatchObject({ code: 400 });
  });

  it('stockée puis remise au Mac (la plus ancienne d’abord), avec le prompt et les faits construits par le serveur', async () => {
    const a = await deposerDemande(kv, { messages: conv }, T) as { id: string };
    const b = await deposerDemande(kv, { messages: [{ role: 'moi', texte: 'salut' }] }, T + 1) as { id: string };
    expect(a.id).toMatch(/^[a-z0-9-]+$/);
    expect(await lireReponse(kv, a.id, T + 2)).toEqual({ statut: 'attente' });
    const s = await prochaineDemande(kv, T + 1_000);
    expect(s.demande).toMatchObject({ id: a.id, messages: conv, modele: 'qwen3:8b', format: { type: 'object' } });
    expect(s.demande!.systeme).toContain('Isaac lit ses missions tout de suite');
    expect(s.demande!.systeme).toContain('"connaissances"');
    expect(s.demande!.reste_ms).toBe(LIMITE_MS - 1_000);
    expect((await prochaineDemande(kv, T + 1_000)).demande?.id).toBe(b.id);
    expect((await prochaineDemande(kv, T + 1_000)).demande).toBeNull();
  });

  it('le Mac ne se signale que quand il le demande (vu, allume) ; sans ça, une seule commande : la file', async () => {
    const kv2 = memoire();
    const appels: string[] = [];
    const espion = new Proxy(kv2, { get: (k, nom) => { appels.push(String(nom)); return Reflect.get(k, nom); } });
    expect(await prochaineDemande(espion, T)).toEqual({ eveil: false, isaac: false, demande: null });
    expect(appels).toEqual(['rpop']);
    expect(await macDisponible(kv2, T + 1_000)).toBe(false);
    await prochaineDemande(kv2, T, { vu: true });
    expect(await macDisponible(kv2, T + 1_000)).toBe(true);
  });

  it('allumé (battement de 5 min) : disponible pendant 10 min au plus', async () => {
    const kv2 = memoire();
    await prochaineDemande(kv2, T, { allume: true });
    expect(await macDisponible(kv2, T + 4 * 60_000)).toBe(true);
    expect(await macDisponible(kv2, T + 9 * 60_000)).toBe(true);
    expect(await macDisponible(kv2, T + 11 * 60_000)).toBe(false);
    await signalerAllume(kv2, T + 11 * 60_000);
    expect(await macDisponible(kv2, T + 12 * 60_000)).toBe(true);
  });

  it('une demande trop vieille n’est pas remise (la page a déjà repris ses règles)', async () => {
    await deposerDemande(kv, { messages: conv }, T);
    expect((await prochaineDemande(kv, T + LIMITE_MS - 1_000)).demande).toBeNull();
  });
});

describe('Kuroro par le Mac : la réponse', () => {
  let id: string;
  const ordre = [{ role: 'moi', texte: 'vide le cache de mon Mac' }];
  beforeEach(async () => {
    await signalerMac(kv, T);
    id = (await deposerDemande(kv, { messages: ordre }, T) as { id: string }).id;
  });

  it('le filet : une heure fausse dans la réponse est remplacée par la phrase exacte du QG', async () => {
    await kv.lpush(CLES.journal, JSON.stringify({ quand: Date.UTC(2026, 10, 11, 7, 40), agent: 'mafe', type: 'etat', statut: 'termine', texte: 'point du matin', origine: 'agent' }));
    const i = (await deposerDemande(kv, { messages: [{ role: 'moi', texte: 'Mafe a fait le point ?' }] }, T) as { id: string }).id;
    await prochaineDemande(kv, T + 500); // l'ordre du beforeEach
    expect((await prochaineDemande(kv, T + 1_000)).demande!.id).toBe(i);
    await ecrireReponse(kv, { id: i, texte: 'Oui, Mafe l’a fait à 07:12, dans la page.', mission: null }, T + 2_000);
    expect(await lireReponse(kv, i, T + 2_100)).toEqual({ statut: 'prete', texte: 'Mafe : Point du matin : fait aujourd’hui à 07:40, dans la page (son bureau), pas sur Telegram.' });
  });

  it('une question ou un reproche : le format ne permet aucune mission, et le serveur refuse celle qui viendrait quand même', async () => {
    const question = (await deposerDemande(kv, { messages: conv }, T) as { id: string }).id;
    const reproche = (await deposerDemande(kv, { messages: [{ role: 'moi', texte: 'fais gaffe, la prochaine fois je ne tolérerai plus les retards' }] }, T) as { id: string }).id;
    // la file rend la plus ancienne d'abord : l'ordre, puis la question, puis le reproche
    const formats = [];
    for (let i = 0; i < 3; i++) formats.push((await prochaineDemande(kv, T + 1_000)).demande!);
    expect(formats.map(d => d.format)).toEqual([SCHEMA_LOCAL, SCHEMA_SANS_MISSION, SCHEMA_SANS_MISSION]);
    expect(formats[0].systeme).not.toContain('pas un ordre');
    expect(formats[1].systeme.endsWith('Son dernier message n\'est pas un ordre : aucune mission (« mission » vaut null).')).toBe(true);
    for (const i of [question, reproche]) {
      await expect(ecrireReponse(kv, { id: i, texte: 'Je lui rappelle.', mission: { agent: 'mafe', mission: 'Envoyer le point' } }, T + 2_000)).rejects.toMatchObject({ code: 400 });
      expect(await lireReponse(kv, i, T + 2_100)).toEqual({ statut: 'expiree' });
    }
    expect(await missions('mafe')).toEqual([]);
  });

  it('une réponse sans mission : prête pour la page, rien n’est déposé', async () => {
    expect(await ecrireReponse(kv, { id, texte: '  C’est Isaac,   le concierge Mac.  ', mission: null }, T + 3_000)).toEqual({ ok: true });
    expect(await lireReponse(kv, id, T + 3_500)).toEqual({ statut: 'prete', texte: 'C’est Isaac, le concierge Mac.' });
    expect(await missions('isaac')).toEqual([]);
  });

  it('une mission valide : le serveur la dépose et écrit lui-même la confirmation honnête', async () => {
    expect(await ecrireReponse(kv, { id, texte: 'C’est fait, Isaac a vidé le cache !', mission: { agent: 'isaac', mission: 'Vider le cache du Mac' } }, T + 3_000))
      .toEqual({ ok: true, mission: { agent: 'isaac', nom: 'Isaac' } });
    const r = await lireReponse(kv, id, T + 3_500);
    // l'accroche du modèle annonçait la mission faite : remplacée par « Entendu. » ; le reste est écrit par le code
    expect(r).toEqual({ statut: 'prete', texte: 'Entendu. C’est Isaac qui s’en occupe (Mac & Outils). C’est noté, je me charge de l’informer. Il te répond sur Telegram dans une minute environ, si ton Mac est allumé.', mission: { agent: 'isaac', nom: 'Isaac' } });
    expect(JSON.stringify(r)).not.toContain('vidé');
    expect((await missions('isaac')).map(m => m.texte)).toEqual(['Vider le cache du Mac']);
    // pour Clara, avant la mise en service des missions : notée sur sa fiche, sans délai promis
    const id2 = (await deposerDemande(kv, { messages: [{ role: 'moi', texte: 'trie mes mails' }] }, T) as { id: string }).id;
    await ecrireReponse(kv, { id: id2, texte: 'ok', mission: { agent: 'clara', mission: 'Trier les mails' } }, T + 3_000);
    expect(JSON.stringify(await lireReponse(kv, id2, T + 3_100))).toContain('pas encore en service : elle la verra sur sa fiche');
  });

  it('une demande : qui s’en occupe, son statut réel (gardé avec la demande, jamais écrit par le modèle), « c’est noté », mission déposée', async () => {
    const i = (await deposerDemande(kv, { messages: [{ role: 'moi', texte: 'bonsoir' }, { role: 'kuroro', texte: 'Bonsoir patron.' }, { role: 'moi', texte: 'dis à Clara de trier mes mails' }] }, T) as { id: string }).id;
    await prochaineDemande(kv, T + 500); // l'ordre du beforeEach
    expect((await prochaineDemande(kv, T + 1_000)).demande!.id).toBe(i);
    const { statutsMission } = await import('./kuroro');
    const { vuesQG } = await import('./vues');
    const statut = statutsMission(await vuesQG(kv, T + 1_000), T + 1_000).clara;
    expect(statut).toBeTruthy();
    await ecrireReponse(kv, { id: i, texte: 'D’accord, patron.', mission: { agent: 'clara', mission: 'Trier les mails' } }, T + 2_000);
    expect(await lireReponse(kv, i, T + 2_100)).toEqual({ statut: 'prete', mission: { agent: 'clara', nom: 'Clara' },
      texte: `D’accord, patron. C’est Clara qui s’en occupe (Mac & Outils). ${statut} C’est noté, je me charge de l’informer. Le passage des missions n’est pas encore en service : elle la verra sur sa fiche, et elle sera faite dès sa mise en service.` });
    expect((await missions('clara')).map(m => m.texte)).toEqual(['Trier les mails']);
  });
  it('une mission invalide (agent inconnu, Kuroro, vide, trop longue) : 400, rien n’est déposé, la page reprend ses règles', async () => {
    for (const mission of [{ agent: 'bob', mission: 'x' }, { agent: 'kuroro', mission: 'x' }, { agent: 'isaac', mission: '' }, { agent: 'isaac', mission: 'x'.repeat(301) }]) {
      const i = (await deposerDemande(kv, { messages: conv }, T) as { id: string }).id;
      await expect(ecrireReponse(kv, { id: i, texte: 'ok', mission }, T + 1_000)).rejects.toMatchObject({ code: 400 });
      expect(await lireReponse(kv, i, T + 1_100)).toEqual({ statut: 'expiree' });
    }
    expect(await missions('isaac')).toEqual([]);
    expect(await missions('kuroro')).toEqual([]);
  });

  it('un texte vide ou trop long : 400', async () => {
    await expect(ecrireReponse(kv, { id, texte: '  ' }, T + 1_000)).rejects.toMatchObject({ code: 400 });
    const i = (await deposerDemande(kv, { messages: conv }, T) as { id: string }).id;
    await expect(ecrireReponse(kv, { id: i, texte: 'a'.repeat(401) }, T + 1_000)).rejects.toMatchObject({ code: 400 });
  });

  it('le Mac n’a pas su répondre (« echec ») : la page reprend ses règles tout de suite', async () => {
    expect(await ecrireReponse(kv, { id, echec: true }, T + 1_000)).toEqual({ ok: true });
    expect(await lireReponse(kv, id, T + 1_100)).toEqual({ statut: 'expiree' });
  });

  it('une seule réponse par demande (jamais deux dépôts)', async () => {
    await ecrireReponse(kv, { id, texte: 'ok', mission: { agent: 'isaac', mission: 'Vider le cache' } }, T + 1_000);
    await expect(ecrireReponse(kv, { id, texte: 'ok', mission: { agent: 'isaac', mission: 'Vider le cache' } }, T + 1_100)).rejects.toMatchObject({ code: 409 });
    expect(await missions('isaac')).toHaveLength(1);
  });

  it('identifiant inconnu ou mal formé : refusé', async () => {
    await expect(ecrireReponse(kv, { id: 'inconnu', texte: 'ok' }, T)).rejects.toMatchObject({ code: 404 });
    await expect(ecrireReponse(kv, { id: '../x', texte: 'ok' }, T)).rejects.toMatchObject({ code: 400 });
    expect(await lireReponse(kv, 'inconnu', T)).toEqual({ statut: 'expiree' });
    await expect(lireReponse(kv, '../x', T)).rejects.toMatchObject({ code: 400 });
  });

  it('expiration : passé le délai, la page lit « expiree » et une réponse tardive est refusée (rien n’est déposé)', async () => {
    expect(await lireReponse(kv, id, T + LIMITE_MS - 1)).toEqual({ statut: 'attente' });
    expect(await lireReponse(kv, id, T + LIMITE_MS + 1)).toEqual({ statut: 'expiree' });
    await expect(ecrireReponse(kv, { id, texte: 'ok', mission: { agent: 'isaac', mission: 'Vider le cache' } }, T + LIMITE_MS + 2)).rejects.toMatchObject({ code: 409 });
    expect(await missions('isaac')).toEqual([]);
  });
});

describe('Kuroro par le Mac : la conversation du 12 novembre (17:01)', () => {
  const T2 = Date.UTC(2026, 10, 12, 17, 1);
  const repondre = async (messages: { role: string; texte: string }[], texte: string) => {
    await signalerMac(kv, T2);
    const i = (await deposerDemande(kv, { messages }, T2) as { id: string }).id;
    expect((await prochaineDemande(kv, T2 + 500)).demande!.id).toBe(i);
    await ecrireReponse(kv, { id: i, texte, mission: null }, T2 + 2_000);
    return lireReponse(kv, i, T2 + 2_100);
  };
  const SALUT = 'Salut frère, ça va ? J’ai pas vu ton message, mais j’espère que tu t’es bien réveillé. Tu veux que je te résume ce qui t’attend ?';

  it('« Salut ca va ? » : il répond à la salutation (Bonjour, l’heure réelle), puis demande ce qu’il attend de lui ; ni « frère », ni réveil', async () => {
    expect(await repondre([{ role: 'moi', texte: 'Salut ca va ?' }], SALUT))
      .toEqual({ statut: 'prete', texte: 'Bonjour patron, je vais bien, merci. Qu’est-ce que je peux faire pour toi ?' });
  });

  it('« je suis pas ton frere mais ton patron imbecile » : une excuse franche sur ce qui a cloché, sans faits collés, puis la question', async () => {
    const conv = [{ role: 'moi', texte: 'Salut ca va ?' }, { role: 'kuroro', texte: SALUT }, { role: 'moi', texte: 'je suis pas ton frere mais ton patron imbecile' }];
    // le prompt le sait : ce qui a cloché, et que ce n'est pas un ordre
    await signalerMac(kv, T2);
    await deposerDemande(kv, { messages: conv }, T2);
    const { demande } = await prochaineDemande(kv, T2 + 500);
    expect(demande!.systeme).toContain('Ce qui a cloché dans l\'échange : tu l’as appelé « frère », alors qu’il est ton patron.');
    expect(demande!.format).toBe(SCHEMA_SANS_MISSION);
    expect(await repondre(conv, 'Pardon patron, j’aurais dû te le dire : aujourd’hui, L a rien fait sur Telegram, et Luffy a 1 site en panne. Tu veux que je te résume ici ?'))
      .toEqual({ statut: 'prete', texte: 'Pardon patron, je t’ai appelé frère, ça ne se reproduira pas. Qu’est-ce que je peux faire pour toi ?' });
  });
});

describe('Kuroro par le Mac : une mission pour Isaac le lance tout de suite', () => {
  it('une mission confiée à Isaac glisse une marque dans la file : le Mac la lit (isaac: true), une seule fois', async () => {
    const { deposerMission } = await import('./qg');
    await deposerMission(kv, { texte: 'vide le cache', agent: 'isaac' }, T);
    expect(await prochaineDemande(kv, T + 1_000)).toEqual({ eveil: false, isaac: true, demande: null });
    expect(await prochaineDemande(kv, T + 2_000)).toEqual({ eveil: false, isaac: false, demande: null });
  });
  it('une mission pour un autre agent ne lance rien', async () => {
    const { deposerMission } = await import('./qg');
    await deposerMission(kv, { texte: 'trie mes mails', agent: 'clara' }, T);
    expect(await kv.lrange(CLES_RELAIS.demandes, 0, -1)).toEqual([]);
  });
});
