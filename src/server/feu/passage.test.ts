import { describe, expect, it } from 'vitest';
import { memoire } from '../memoire';
import { lireEtat } from '../qg';
import { CLES_SILENCE, mettrePause } from '../silence';
import { bougies, DUREES, fauxMiroir, H, MIN, plat } from './aide-test';
import { CLES_FEU, lireCompte, lireEtatFeu, lireEtatSeul, lirePassageFeu } from './etat';
import { recevoirCompte } from './actions';
import { MIROIR } from './marche';
import { ALERTES_PAR_JOUR, ignorerSujet, lireMessages, passageFeu, reprendreFeu, situation } from './passage';
import type { Bougie } from './types';

const NOW = Date.UTC(2026, 10, 16, 10, 5); // lundi 16 novembre, après le PPI du 13
const debut = (now: number, pas: number, n: number) => Math.floor(now / pas) * pas - (n - 1) * pas;

/** Le marché à `now` : BTC autour de 72 000, ETH autour de 2 010 ; `derniere1h` : la clôture de la dernière bougie 1h terminée. */
function marche(now: number, derniere1h: { BTCUSDT?: number; ETHUSDT?: number } = {}): Record<string, Record<string, Bougie[]>> {
  const paire = (p: number, d?: number) => {
    const s1 = [...plat(p, 58), ...(d ? [[p, Math.max(p, d) + 5, Math.min(p, d) - 5, d, 10] as [number, number, number, number, number]] : plat(p, 1)), [d ?? p, (d ?? p) + 1, (d ?? p) - 1, d ?? p, 1] as [number, number, number, number, number]];
    return {
      '4h': bougies(plat(p, 40), DUREES['4h'], debut(now, DUREES['4h'], 40)),
      '1h': bougies(s1, H, debut(now, H, s1.length)),
      '15m': bougies(plat(d ?? p, 40), DUREES['15m'], debut(now, DUREES['15m'], 40)),
    };
  };
  return { BTCUSDT: paire(72000, derniere1h.BTCUSDT), ETHUSDT: paire(2010, derniere1h.ETHUSDT) };
}

function banc() {
  const kv = memoire();
  const envois: { texte: string; boutons?: unknown }[] = [];
  const appels: string[] = [];
  const deps = (m: Record<string, Record<string, Bougie[]>>) => ({ fetch: fauxMiroir(m, appels), envoyer: async (texte: string, boutons?: unknown) => { envois.push({ texte, boutons }); } });
  return { kv, envois, appels, deps };
}

describe('Feu · le passage (QStash toutes les 15 min)', () => {
  it('premier passage : l\'état est rangé depuis le bloc de reprise ; aucun vieux niveau annoncé ; seulement le miroir public, en GET', async () => {
    const { kv, envois, appels, deps } = banc();
    const r = await passageFeu(kv, deps(marche(NOW)), NOW) as { ok: boolean; statuts: { statut: string }[] };
    expect(r.ok).toBe(true);
    expect(r.statuts.map(s => s.statut)).toEqual(['Hypothèse', 'Hypothèse']);
    const etat = await lireEtatSeul(kv);
    expect(etat?.capitalDeclare.montant).toBe(8.5);
    expect(etat?.niveaux.BTCUSDT.contexte?.prix).toBe(74810);
    expect(etat?.annonces[0]).toMatchObject({ nom: 'PPI américain', quand: Date.UTC(2026, 10, 13, 13, 30) });
    expect(envois).toHaveLength(0);
    expect(appels.every(a => a.startsWith(`GET ${MIROIR}/api/v3/klines`) || a === `GET ${MIROIR}/api/v3/exchangeInfo`)).toBe(true);
    const p = await lirePassageFeu(kv);
    expect(p?.statuts[0].lu).toBe(NOW);
    // l'état en direct, sans entrée dans le journal (un passage tranquille ne chasse pas l'historique des autres)
    const { etats, journal } = await lireEtat(kv);
    expect(etats.feu?.tache).toContain('lit le marché');
    expect(journal.filter(e => e.agent === 'feu')).toHaveLength(0);
  });

  it('une bougie 1h qui clôture au-dessus d\'un niveau surveillé : une alerte, avec l\'heure de lecture et le bouton « Ignorer »', async () => {
    const { kv, envois, deps } = banc();
    await passageFeu(kv, deps(marche(NOW)), NOW);
    const t = NOW + H;
    await passageFeu(kv, deps(marche(t, { BTCUSDT: 72905 })), t);
    expect(envois).toHaveLength(1);
    expect(envois[0].texte).toContain('clôturé au-dessus de 72 730 (premier jalon)');
    expect(envois[0].texte).toMatch(/prix lu .* à 11:05 UTC/);
    expect(envois[0].texte).toContain('Pour comprendre');
    expect(envois[0].boutons).toEqual([[{ texte: 'Ignorer BTC/USDT', donnee: 'fei:paire:BTCUSDT' }]]);
    // le même passage rejoué : pas de doublon
    await passageFeu(kv, deps(marche(t, { BTCUSDT: 72905 })), t + MIN);
    expect(envois).toHaveLength(1);
    expect((await lireEtat(kv)).journal.some(e => e.agent === 'feu' && e.texte.startsWith('prévient'))).toBe(true);
  });

  it('« Ignorer » : plus d\'alerte de niveau pour cette paire (gardée dans la page) ; « reprends Feu » la rend', async () => {
    const { kv, envois, deps } = banc();
    await passageFeu(kv, deps(marche(NOW)), NOW);
    expect(await ignorerSujet(kv, 'paire:BTCUSDT', NOW)).toContain('Un Signal te sera toujours envoyé');
    await passageFeu(kv, deps(marche(NOW + H, { BTCUSDT: 72905 })), NOW + H);
    expect(envois).toHaveLength(0);
    expect((await lireMessages(kv))[0]).toMatchObject({ envoye: false, raison: 'ignoré par toi' });
    expect(await reprendreFeu(kv)).toBe(1);
    await passageFeu(kv, deps(marche(NOW + 2 * H, { BTCUSDT: 71100 })), NOW + 2 * H);
    expect(envois).toHaveLength(1);
    expect(envois[0].texte).toContain('en dessous de 71 250');
    expect(await ignorerSujet(kv, 'paire:DOGEUSDT', NOW)).toBe('Je ne sais pas quoi ignorer.');
  });

  it('plafond : 6 messages d\'alerte par jour, le reste est gardé dans la page', async () => {
    const { kv, envois, deps } = banc();
    await passageFeu(kv, deps(marche(NOW)), NOW);
    await kv.hset(CLES_FEU.alertes, `jour:${new Date(NOW).toISOString().slice(0, 10)}`, String(ALERTES_PAR_JOUR));
    await passageFeu(kv, deps(marche(NOW + H, { ETHUSDT: 2035 })), NOW + H);
    expect(envois).toHaveLength(0);
    expect((await lireMessages(kv))[0].raison).toContain('plafond');
  });

  it('pause générale des alertes : rien ne part, l\'alerte est gardée pour la fin de la pause', async () => {
    const { kv, envois, deps } = banc();
    await passageFeu(kv, deps(marche(NOW)), NOW);
    await mettrePause(kv, NOW + 5 * H, NOW);
    await passageFeu(kv, deps(marche(NOW + H, { ETHUSDT: 2035 })), NOW + H);
    expect(envois).toHaveLength(0);
    expect((await kv.lrange(CLES_SILENCE.attente, 0, -1))[0]).toContain('2 030');
  });

  it('annonce macro : la veille, puis une heure avant, une seule fois chacune', async () => {
    const { kv, envois, deps } = banc();
    const ppi = Date.UTC(2026, 10, 13, 13, 30);
    const veille = ppi - 20 * H;
    await passageFeu(kv, deps(marche(veille)), veille);
    await passageFeu(kv, deps(marche(veille + 15 * MIN)), veille + 15 * MIN);
    expect(envois).toHaveLength(1);
    expect(envois[0].texte).toContain('PPI américain');
    expect(envois[0].texte).toContain('Pas d\'entrée de 12:30 à 14:30');
    await passageFeu(kv, deps(marche(ppi - H)), ppi - H);
    expect(envois).toHaveLength(2);
    expect(envois[1].texte).toContain('dans une heure');
    expect(envois[1].boutons).toEqual([[{ texte: 'Ignorer cette annonce', donnee: `fei:macro:${ppi}` }]]);
  });

  it('marché illisible : rien n\'est inventé, le dernier statut reste avec son heure et l\'erreur est notée', async () => {
    const { kv, deps } = banc();
    await passageFeu(kv, deps(marche(NOW)), NOW);
    const r = await passageFeu(kv, deps({}), NOW + 15 * MIN) as { ok: boolean };
    expect(r.ok).toBe(false);
    const p = await lirePassageFeu(kv);
    expect(p?.quand).toBe(NOW);
    expect(p?.erreur).toContain('Binance');
    expect((await lireEtat(kv)).etats.feu?.statut).toBe('erreur');
  });

  it('un passage à la fois', async () => {
    const { kv, deps } = banc();
    await kv.setnx(CLES_FEU.verrou, 'x', 60);
    expect(await passageFeu(kv, deps(marche(NOW)), NOW)).toEqual({ occupe: true });
  });
});

describe('Feu · le compte reçu du Mac', () => {
  const corps = (o: Record<string, unknown> = {}) => ({
    quand: NOW, cle: 'ok', spot: { USDT: { libre: 0.0016, bloque: 0 } }, earn: { USDT: 8.5 }, ouverts: [],
    executes: [{ paire: 'BTCUSDT', id: 1, ordre: 9, cote: 'BUY', prix: 76983.33, quantite: 0.0001, montant: 7.69, frais: 0.0000001, fraisActif: 'BTC', quand: NOW - 86_400_000 * 10 }], ...o,
  });
  it('rangé ; le capital devient le vrai solde (Spot + Earn) ; un achat d\'avant le copilote n\'est pas une opération', async () => {
    const { kv, envois } = banc();
    expect(await recevoirCompte(kv, corps(), { envoyer: async t => { envois.push({ texte: t }); } }, NOW)).toEqual({ ok: true, cle: 'ok' });
    const c = (await lireCompte(kv))!;
    const etat = await lireEtatFeu(kv, NOW);
    const s = situation(etat, c, { BTCUSDT: 72000, ETHUSDT: 2000 }, NOW);
    expect(s.capital).toMatchObject({ source: 'compte' });
    expect(s.capital.montant).toBeCloseTo(8.5016, 4);
    expect(s.operations).toHaveLength(0);
    expect(envois).toHaveLength(0);
  });
  it('refuse un champ inconnu, une clé ou un secret, un nombre faux', async () => {
    const { kv } = banc();
    const d = { envoyer: async () => undefined };
    await expect(recevoirCompte(kv, corps({ apiKey: 'x' }), d, NOW)).rejects.toThrow(/non autorisé/);
    await expect(recevoirCompte(kv, corps({ raison: 'ghp_' + 'a'.repeat(36) }), d, NOW)).rejects.toThrow(/secret/);
    await expect(recevoirCompte(kv, corps({ earn: { USDT: -1 } }), d, NOW)).rejects.toThrow(/positif/);
    expect(await lireCompte(kv)).toBeNull();
  });
  it('une clé avec des droits en trop : Le patron le sait une fois, rien d\'autre n\'est gardé', async () => {
    const { kv, envois } = banc();
    const d = { envoyer: async (t: string) => { envois.push({ texte: t }); } };
    await recevoirCompte(kv, { quand: NOW, cle: 'droits', droits: ['enableSpotAndMarginTrading'] }, d, NOW);
    await recevoirCompte(kv, { quand: NOW + MIN, cle: 'droits', droits: ['enableSpotAndMarginTrading'] }, d, NOW + MIN);
    expect(envois).toHaveLength(1);
    expect(envois[0].texte).toContain('je refuse de m\'en servir');
    expect((await lireCompte(kv))?.cle).toBe('droits');
  });
  it('une lecture ratée ne remplace pas le dernier compte lu', async () => {
    const { kv } = banc();
    const d = { envoyer: async () => undefined };
    await recevoirCompte(kv, corps(), d, NOW);
    expect(await recevoirCompte(kv, { quand: NOW + MIN, cle: 'erreur', raison: 'Binance a répondu 401' }, d, NOW + MIN)).toMatchObject({ garde: 'dernier compte lu' });
    expect((await lireCompte(kv))?.cle).toBe('ok');
  });
});
