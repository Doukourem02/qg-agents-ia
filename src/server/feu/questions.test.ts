import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { memoire } from '../memoire';
import { CLES } from '../qg';
import type { Recu } from '../telegram';
import { traiterTelegram, type DepsTelegram } from '../l/webhook';
import { aiguiller } from '../l/routage';
import { routeMission } from '@/sim/routing';
import { bougies, DUREES, fauxMiroir, H, plat } from './aide-test';
import { recevoirCompte } from './actions';
import { CLES_FEU } from './etat';
import { passageFeu } from './passage';
import { commandeFeu, estQuestionFeu, reponseCode, repondreQuestion } from './questions';
import type { Bougie } from './types';

const NOW = Date.UTC(2026, 10, 12, 18, 0); // jeudi 12 novembre, 18:00 : la veille du PPI
const APRES = Date.UTC(2026, 10, 13, 10, 0); // vendredi 13, 10:00 : missions en service
const debut = (now: number, pas: number, n: number) => Math.floor(now / pas) * pas - (n - 1) * pas;
const marche = (now: number): Record<string, Record<string, Bougie[]>> => {
  const paire = (p: number) => ({
    '4h': bougies(plat(p, 40), DUREES['4h'], debut(now, DUREES['4h'], 40)),
    '1h': bougies(plat(p, 60), H, debut(now, H, 60)),
    '15m': bougies(plat(p, 40), DUREES['15m'], debut(now, DUREES['15m'], 40)),
  });
  return { BTCUSDT: paire(71600), ETHUSDT: paire(2010) };
};
async function pret(now = APRES) {
  const kv = memoire();
  await passageFeu(kv, { fetch: fauxMiroir(marche(now)), envoyer: async () => undefined }, now);
  return kv;
}
const txt = (texte: string): Recu => ({ type: 'texte', id: 'm1', de: '1', texte });
const btn = (donnee: string): Recu => ({ type: 'bouton', id: 'c1', de: '1', donnee, chat: 1, message: 2 });
const deps = (envoyes: string[] = []): DepsTelegram => ({
  envoyer: async t => { envoyes.push(t); }, publier: async () => ({ etat: 'inconnu' }), telecharger: async () => ({ contenu: new Uint8Array() }),
});

describe('Feu · les questions du patron', () => {
  it('reconnaît une question de trading (mots-clés), pas le reste', () => {
    for (const t of ['Feu, on en est où ?', 'mon solde Binance ?', 'le BTC monte ?', 'c\'est quoi le trading spot', 'ETH ?']) expect(estQuestionFeu(t), t).toBe(true);
    for (const t of ['vérifie mes sites', 'salut Kuroro', 'ignore Livreo', 'le point du matin', 'le bureau de Léa']) expect(estQuestionFeu(t), t).toBe(false);
  });
  it('Kuroro confie à Feu ce qui parle de trading', () => {
    for (const t of ['surveille le bitcoin', 'prépare-moi un point crypto', 'regarde Binance']) expect(routeMission(t).agent.id, t).toBe('feu');
  });

  it('le code répond tout de suite : statut et ce qui manque, avec le prix et son heure de lecture', async () => {
    const kv = await pret();
    const r = (await reponseCode(kv, 'Feu, on peut acheter du BTC ?', APRES))!;
    expect(r).toContain('BTC/USDT (prix lu 71');
    expect(r).toContain('à 10:00 UTC');
    expect(r).toContain('Statut : Hypothèse');
    expect(r).toContain('On attend.');
    expect(r).not.toContain('ETH/USDT');
    expect(r).toContain('Régime apprentissage');
  });
  it('le solde : « clé pas encore créée » sans clé ; le vrai solde vu à HH:MM avec', async () => {
    const kv = await pret();
    expect(await reponseCode(kv, 'quel est mon solde sur Binance ?', APRES)).toContain('la clé Binance en lecture seule n\'est pas créée');
    await recevoirCompte(kv, { quand: APRES - 10 * 60_000, cle: 'ok', spot: { USDT: { libre: 0.0016, bloque: 0 } }, earn: { USDT: 8.5 }, ouverts: [], executes: [] }, { envoyer: async () => undefined }, APRES);
    expect(await reponseCode(kv, 'quel est mon solde sur Binance ?', APRES)).toContain('Solde vu à 09:50 UTC : Spot 0,00 USDT, Simple Earn 8,50 USDT');
  });
  it('la prochaine annonce et les niveaux surveillés', async () => {
    const kv = await pret(NOW);
    expect(await reponseCode(kv, 'Feu, la prochaine annonce macro ?', NOW)).toContain('PPI américain ven. 13 nov. 13:30 UTC (pas d\'entrée de 12:30 à 14:30)');
    expect(await reponseCode(kv, 'les niveaux de l\'ETH ?', NOW)).toContain('ETH/USDT : support 1 984–2 000');
  });
  it('une explication (« pourquoi », « c\'est quoi ») : une mission pour Feu, faite dans l\'heure', async () => {
    const kv = await pret();
    expect(await reponseCode(kv, 'pourquoi le bitcoin baisse ?', APRES)).toBeNull();
    const r = await repondreQuestion(kv, 'pourquoi le bitcoin baisse ?', APRES);
    expect(r.texte).toContain('Feu a ta question. Il s’en occupe dans l’heure');
    expect(r.mission).toEqual({ agent: 'feu', nom: 'Feu' });
    expect(await kv.lrange(CLES.missions('feu'), 0, -1)).toHaveLength(1);
  });
  it('« ignore BTC » et « reprends Feu » : les alertes de niveau de Feu, rien d\'autre', async () => {
    const kv = await pret();
    expect(await commandeFeu(kv, 'ignorer', 'ignore Livreo', APRES)).toBeNull();
    expect(await commandeFeu(kv, 'ignorer', 'ignore le BTC', APRES)).toContain('plus d\'alerte de niveau sur BTC/USDT');
    expect(Object.keys(await kv.hgetall(CLES_FEU.ignores))).toEqual(['paire:BTCUSDT']);
    expect(await commandeFeu(kv, 'reprendre', 'reprends Feu', APRES)).toContain('C\'est reparti');
  });
});

describe('Feu sur Telegram', () => {
  it('une question → la réponse du code ; une explication → une mission ; le bouton « Ignorer » de ses alertes', async () => {
    const kv = await pret();
    expect(await traiterTelegram(kv, txt('Feu, il manque quoi sur ETH ?'), deps(), APRES)).toContain('🔥 Feu · ETH/USDT (prix lu');
    expect(await traiterTelegram(kv, txt('c\'est quoi un OCO sur Binance ?'), deps(), APRES)).toContain('Feu a ta question');
    expect(aiguiller(btn('fei:paire:ETHUSDT'))).toEqual({ vers: 'feu-ignorer', sujet: 'paire:ETHUSDT' });
    expect(await traiterTelegram(kv, btn('fei:paire:ETHUSDT'), deps(), APRES)).toContain('plus d\'alerte de niveau sur ETH/USDT');
    expect(await traiterTelegram(kv, txt('ignore ETH'), deps(), APRES)).toContain('ETH/USDT');
  });
});

describe('Feu dans « QG · missions »', () => {
  it('sa mission est remise avec ses consignes et son bureau ; une réponse qui pousse à agir est refusée', async () => {
    const { aFaire, rendreRapport } = await import('../missions/file');
    const { bureauDe } = await import('../missions/bureaux');
    const kv = await pret();
    await repondreQuestion(kv, 'c\'est quoi un stop-limit sur Binance ?', APRES);
    const r = await aFaire(kv, { envoyer: async () => undefined, bureau: a => bureauDe(kv, a) }, APRES) as { missions: { id: string; agent: string; consignes: string; bureau: { passage: unknown } }[] };
    expect(r.missions[0]).toMatchObject({ agent: 'feu', consignes: 'agents/Feu/CONSIGNES.md' });
    expect(r.missions[0].bureau.passage).not.toBeNull();
    const envois: string[] = [];
    await expect(rendreRapport(kv, { id: r.missions[0].id, statut: 'fait', texte: 'Fonce, c\'est maintenant ou jamais.' }, { envoyer: async t => { envois.push(t); } }, APRES)).rejects.toThrow(/pousse jamais/);
    expect(await rendreRapport(kv, { id: r.missions[0].id, statut: 'fait', texte: 'Un stop-limit se déclenche à un prix, puis vend à une limite un peu en dessous.' }, { envoyer: async t => { envois.push(t); } }, APRES)).toMatchObject({ ok: true });
    expect(envois[0]).toContain('Feu · ta mission');
  });
});
