import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoire } from '@/server/memoire';

// La porte du webhook : le clic est accusé AVANT le travail (le bouton ne tourne pas pendant une longue corbeille).
const ordre: string[] = [];
const kv = memoire();
vi.mock('server-only', () => ({}));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));
vi.mock('@/server/telegram', () => ({
  secretValide: (s: string | null) => s === 'ok',
  lireMiseAJour: (u: unknown) => u,
  accuserClic: vi.fn(async () => { ordre.push('accuser'); }),
  retirerBoutons: vi.fn(async () => { ordre.push('retirer'); }),
  envoyerTelegram: vi.fn(async (t: string) => { ordre.push(`envoyer:${t}`); }),
  envoyerImage: vi.fn(), envoyerFichier: vi.fn(), telechargerFichier: vi.fn(),
}));
vi.mock('@/server/l/webhook', () => ({ traiterTelegram: vi.fn(async () => { ordre.push('travail'); return 'Fait.'; }) }));
vi.mock('@/server/linkedin/api', () => ({ creerPost: vi.fn(), televerser: vi.fn() }));
vi.mock('@/server/linkedin/connexion', () => ({ lireConnexion: vi.fn() }));
vi.mock('@/server/l/publication', () => ({ publierPost: vi.fn() }));
vi.mock('@/server/l/visuels', () => ({ rendreVisuel: vi.fn() }));
vi.mock('@/server/clara/imap', () => ({ ErreurGmail: class extends Error {}, ouvrirBoite: vi.fn() }));
vi.mock('@/server/kuroro', () => ({ clientKuroro: () => null }));

const { POST } = await import('./route');
const requete = (u: unknown) => new Request('http://x/api/telegram', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'ok' }, body: JSON.stringify(u) });

beforeEach(() => { ordre.length = 0; process.env.TELEGRAM_CHAT_ID = '42'; });

describe('POST /api/telegram', () => {
  it('F9 : bouton → accusé de réception d\'abord, puis le travail, puis boutons retirés et texte final', async () => {
    await POST(requete({ type: 'bouton', id: 'cQ1', de: '42', donnee: 'cl1:abc:o', chat: 42, message: 5 }));
    expect(ordre).toEqual(['accuser', 'travail', 'retirer', 'envoyer:Fait.']);
  });
  it('Isaac et Paul : un clic garde les autres rangées du message (pas de retrait des boutons)', async () => {
    for (const donnee of ['isc:o:cache:cursor', 'pau:v:abcdef0123', 'pau:r:abcdef0123', 'ye:v:abcdef0123', 'ye:o:abcdef0124', 'ign:site:api-livreo', 'rep:zoro']) {
      ordre.length = 0;
      await POST(requete({ type: 'bouton', id: `c${donnee}`, de: '42', donnee, chat: 42, message: 5 }));
      expect(ordre).toEqual(['accuser', 'travail', 'envoyer:Fait.']);
    }
  });
  it('un chat inconnu est ignoré : aucun travail, aucun envoi, aucune trace', async () => {
    const log = vi.spyOn(console, 'error');
    await POST(requete({ type: 'texte', id: 'm77', de: '666', texte: 'ignore Livreo' }));
    await POST(requete({ type: 'bouton', id: 'c77', de: '666', donnee: 'ign:site:api-livreo', chat: 666, message: 1 }));
    expect(ordre).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('sans TELEGRAM_CHAT_ID, le bot n\'écoute personne', async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    await POST(requete({ type: 'texte', id: 'm78', de: '42', texte: 'salut' }));
    expect(ordre).toEqual([]);
  });
  it('message texte : pas d\'accusé de clic', async () => {
    await POST(requete({ type: 'texte', id: 'm9', de: '42', texte: 'bonjour' }));
    expect(ordre).toEqual(['travail', 'envoyer:Fait.']);
  });
});
