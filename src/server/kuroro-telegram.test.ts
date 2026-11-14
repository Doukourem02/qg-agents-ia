import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from './memoire';
import { CLES } from './qg';
import type { Recu } from './telegram';
import type { DepsTelegram } from './l/webhook';
import type { ClientKuroro } from './kuroro';

vi.mock('server-only', () => ({}));
const { CLES_RELAIS, LIMITE_TELEGRAM_MS, ecrireReponse, prochaineDemande, signalerMac } = await import('./kuroro-relais');
const { MAC_ETEINT, MAC_MUET, PAS_SU, UN_A_LA_FOIS, livrerTelegram, lireEtatKT, parlerAKuroro, redonnerGarde, suivreKuroroTelegram } = await import('./kuroro-telegram');
const { traiterTelegram } = await import('./l/webhook');

// Parler au QG sur Telegram : un message libre va à Kuroro (même cerveau que la barre de mission), la réponse part sur
// Telegram ; Mac éteint : une réponse honnête du code et la question gardée. Jeudi 12 novembre 2026, 15:00.

const T = Date.UTC(2026, 10, 12, 15, 0);
let kv: KV;
let recus: string[];
const envoyer = async (t: string) => { recus.push(t); };
beforeEach(() => { kv = memoire(); recus = []; });

/** Le Mac : prend la demande, répond (ou échoue), puis la route livre la réponse sur Telegram. */
async function macRepond(now: number, reponse: { texte: string; mission?: unknown } | { echec: true }) {
  const { demande } = await prochaineDemande(kv, now);
  if (!demande) return null;
  try { await ecrireReponse(kv, { id: demande.id, ...reponse }, now + 1_000); } catch { /* refusée : vaut échec */ }
  await livrerTelegram(kv, demande.id, { envoyer }, now + 1_000);
  return demande;
}

describe('un message libre → Kuroro → la réponse sur Telegram', () => {
  it('par le Mac : rien tout de suite, puis la réponse ; la conversation garde les tours', async () => {
    await signalerMac(kv, T);
    expect(await parlerAKuroro(kv, 'Livreo est revenu ?', { envoyer }, T)).toBeNull();
    const d = await macRepond(T + 2_000, { texte: 'Non, l’API Livreo est toujours en panne.' });
    expect(d?.messages).toEqual([{ role: 'moi', texte: 'Livreo est revenu ?' }]);
    expect(d?.reste_ms).toBe(LIMITE_TELEGRAM_MS - 2_000);
    expect(recus).toEqual(['Non, l’API Livreo est toujours en panne.']);
    // le tour suivant reprend la conversation, comme la page
    await signalerMac(kv, T + 10_000);
    await parlerAKuroro(kv, 'et Portfolio ?', { envoyer }, T + 10_000);
    const d2 = await macRepond(T + 11_000, { texte: 'Portfolio est en ligne.' });
    expect(d2?.messages.map(m => m.texte)).toEqual(['Livreo est revenu ?', 'Non, l’API Livreo est toujours en panne.', 'et Portfolio ?']);
  });

  it('une mission : déposée par le serveur, phrase « qui / statut / c\'est noté » écrite par le code', async () => {
    await signalerMac(kv, T);
    await parlerAKuroro(kv, 'vide le cache de mon Mac', { envoyer }, T);
    await macRepond(T + 2_000, { texte: 'D’accord, patron.', mission: { agent: 'isaac', mission: 'vider le cache du Mac' } });
    expect(recus[0]).toMatch(/^D’accord, patron\. C’est Isaac qui s’en occupe/);
    expect(recus[0]).toMatch(/[Cc]’est noté/);
    expect((await kv.lrange(CLES.missions('isaac'), 0, -1)).map(v => JSON.parse(v).texte)).toEqual(['vider le cache du Mac']);
  });

  it('le Mac échoue : « je n\'ai pas su », jamais un silence', async () => {
    await signalerMac(kv, T);
    await parlerAKuroro(kv, 'salut', { envoyer }, T);
    await macRepond(T + 2_000, { echec: true });
    expect(recus).toEqual([PAS_SU]);
    expect((await lireEtatKT(kv)).encours).toBeNull();
  });

  it('un seul échange à la fois', async () => {
    await signalerMac(kv, T);
    await parlerAKuroro(kv, 'Livreo est revenu ?', { envoyer }, T);
    expect(await parlerAKuroro(kv, 'et Portfolio ?', { envoyer }, T + 3_000)).toBe(UN_A_LA_FOIS);
  });

  it('Claude si la clé existe : la réponse revient tout de suite', async () => {
    const client: ClientKuroro = { messages: { create: vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'L’API Livreo est toujours en panne.' }] }) as never) } };
    expect(await parlerAKuroro(kv, 'Livreo est revenu ?', { envoyer, client }, T)).toBe('L’API Livreo est toujours en panne.');
  });
});

describe('Mac éteint : une réponse honnête, la question gardée', () => {
  it('« Mon cerveau est sur ton Mac, il est éteint » ; le Mac revient : la question lui est remise, la réponse part', async () => {
    expect(await parlerAKuroro(kv, 'Livreo est revenu ?', { envoyer }, T)).toBe('Mon cerveau est sur ton Mac, il est éteint : je te réponds dès qu\'il revient.');
    expect(MAC_ETEINT).toBe('Mon cerveau est sur ton Mac, il est éteint : je te réponds dès qu\'il revient.');
    expect((await lireEtatKT(kv)).garde).toMatchObject({ texte: 'Livreo est revenu ?' });
    // le Mac se rallume une heure plus tard (son premier passage le signale)
    const plusTard = T + 3_600_000;
    await prochaineDemande(kv, plusTard, { allume: true });
    expect(await redonnerGarde(kv, plusTard)).toBe(true);
    await macRepond(plusTard + 20_000, { texte: 'Non, toujours en panne.' });
    expect(recus).toEqual(['Ta question de 15:00 (« Livreo est revenu ? ») :\nNon, toujours en panne.']);
  });

  it('le Mac ne prend pas la question à temps : le QG le dit une fois et la garde', async () => {
    await signalerMac(kv, T);
    await parlerAKuroro(kv, 'Livreo est revenu ?', { envoyer }, T);
    const id = (await lireEtatKT(kv)).encours!.id;
    await suivreKuroroTelegram(kv, { envoyer }, T + 60_000);
    expect(recus).toEqual([]);
    await suivreKuroroTelegram(kv, { envoyer }, T + LIMITE_TELEGRAM_MS + 5_000);
    expect(recus).toEqual([MAC_MUET]);
    await suivreKuroroTelegram(kv, { envoyer }, T + LIMITE_TELEGRAM_MS + 300_000);
    expect(recus).toHaveLength(1);
    expect((await lireEtatKT(kv)).garde).toMatchObject({ texte: 'Livreo est revenu ?', quand: T });
    // une réponse tardive du Mac est refusée (la prise est posée), et rien de plus ne part
    expect(await kv.get(CLES_RELAIS.prise(id))).toBe('expiree');
    await expect(ecrireReponse(kv, { id, texte: 'trop tard' }, T + LIMITE_TELEGRAM_MS + 6_000)).rejects.toMatchObject({ code: 409 });
    expect(await livrerTelegram(kv, id, { envoyer }, T + LIMITE_TELEGRAM_MS + 6_000)).toBe(false);
  });
});

describe('le webhook : message libre → Kuroro, commandes reconnues par le code', () => {
  const deps = { envoyer: async (t: string) => { recus.push(t); }, lire: async () => ({ sujets: [], illisibles: [] }) } as unknown as DepsTelegram;
  const msg = (texte: string): Recu => ({ type: 'texte', id: 'm1', de: '42', texte });
  it('« salut Kuroro », Mac éteint → la réponse honnête', async () => {
    expect(await traiterTelegram(kv, msg('salut Kuroro'), deps, T)).toBe(MAC_ETEINT);
  });
  it('« ignore Livreo » n\'arrive jamais au modèle, même si le Mac est là', async () => {
    await signalerMac(kv, T);
    expect(await traiterTelegram(kv, msg('ignore Livreo'), deps, T)).toBe('Je ne vois rien d\'ouvert pour « livreo » en ce moment : rien à ignorer.');
    expect(await kv.lrange(CLES_RELAIS.demandes, 0, -1)).toEqual([]);
  });
});
