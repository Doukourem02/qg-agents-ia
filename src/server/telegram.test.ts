import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { lireMiseAJour, secretValide, telechargerFichier } = await import('./telegram');

describe('le webhook Telegram', () => {
  it('n’accepte que le bon secret', () => {
    process.env.TELEGRAM_SECRET = 'mot-secret';
    expect(secretValide('mot-secret')).toBe(true);
    expect(secretValide('mot-secreT')).toBe(false);
    expect(secretValide(null)).toBe(false);
  });
  it('lit un message texte et un clic sur un bouton', () => {
    expect(lireMiseAJour({ update_id: 7, message: { message_id: 1, from: { id: 42 }, text: 'modifie : plus court' } }))
      .toEqual({ type: 'texte', id: 'm7', de: '42', texte: 'modifie : plus court' });
    expect(lireMiseAJour({ update_id: 8, callback_query: { id: 'q1', from: { id: 42 }, data: 'ok:ab12', message: { message_id: 5, chat: { id: 42 } } } }))
      .toEqual({ type: 'bouton', id: 'cq1', de: '42', donnee: 'ok:ab12', chat: 42, message: 5 });
    expect(lireMiseAJour({ update_id: 9, edited_message: {} })).toBeNull();
  });
  it('lit un document, ignore une photo seule', () => {
    expect(lireMiseAJour({ update_id: 10, message: { message_id: 1, from: { id: 42 }, document: { file_id: 'F1', file_name: 'a.pdf' } } }))
      .toEqual({ type: 'fichier', id: 'm10', de: '42', fileId: 'F1', nom: 'a.pdf' });
    expect(lireMiseAJour({ update_id: 11, message: { message_id: 1, from: { id: 42 }, photo: [{ file_id: 'P' }] } })).toBeNull();
  });

  describe('telechargerFichier', () => {
    const reponse = (corps: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => corps });
    it('enchaîne getFile puis le téléchargement', async () => {
      process.env.TELEGRAM_TOKEN = 'JETON';
      const urls: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        urls.push(url);
        if (url.endsWith('/getFile')) return reponse({ ok: true, result: { file_path: 'documents/s.xlsx', file_size: 3 } });
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
      }));
      const r = await telechargerFichier('F1');
      expect(Array.from(r.contenu)).toEqual([1, 2, 3]);
      expect(urls).toEqual(['https://api.telegram.org/botJETON/getFile', 'https://api.telegram.org/file/botJETON/documents/s.xlsx']);
      vi.unstubAllGlobals();
    });
    it('refuse au-delà de 5 Mo sans télécharger', async () => {
      process.env.TELEGRAM_TOKEN = 'JETON';
      const f = vi.fn(async () => reponse({ ok: true, result: { file_path: 'd/g.xlsx', file_size: 6 * 1024 * 1024 } }));
      vi.stubGlobal('fetch', f);
      await expect(telechargerFichier('F1')).rejects.toMatchObject({ code: 413 });
      expect(f).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });
    it('un échec réseau ne montre jamais le jeton', async () => {
      process.env.TELEGRAM_TOKEN = 'JETON';
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.endsWith('/getFile')) return reponse({ ok: true, result: { file_path: 'd/s.xlsx', file_size: 3 } });
        throw new Error('échec ' + url);
      }));
      const e = await telechargerFichier('F1').then(() => null, x => x as Error);
      expect(e).toMatchObject({ code: 502 });
      expect(e?.message).not.toContain('JETON');
      vi.unstubAllGlobals();
    });
  });
});

describe('appels Telegram : une erreur réseau ne montre jamais le jeton', () => {
  it('getFile qui échoue au réseau donne « Telegram injoignable »', async () => {
    const avant = { ...process.env };
    process.env.TELEGRAM_TOKEN = 'JETON-SECRET-123';
    const f = globalThis.fetch;
    globalThis.fetch = (async (u: string) => { throw new Error(`échec vers ${u}`); }) as typeof fetch;
    try {
      const e = await telechargerFichier('abc').catch(x => x);
      expect(String(e?.message)).toBe('Telegram injoignable');
      expect(String(e?.message)).not.toContain('JETON-SECRET-123');
    } finally { globalThis.fetch = f; process.env = avant; }
  });
});

describe('relecture finale', () => {
  it('F4 : Telegram 429 → Refus 429 (pour s\'arrêter proprement), sans le jeton', async () => {
    process.env.TELEGRAM_TOKEN = 'JETON'; process.env.TELEGRAM_CHAT_ID = '42';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 3 } }) })));
    const { envoyerTelegram } = await import('./telegram');
    const e = await envoyerTelegram('x').catch(x => x as { code: number; message: string });
    expect(e).toMatchObject({ code: 429 });
    expect(e.message).not.toContain('JETON');
    vi.unstubAllGlobals();
  });
  it('F9 : accuserClic et retirerBoutons sont deux appels séparés', async () => {
    process.env.TELEGRAM_TOKEN = 'JETON';
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) }; }));
    const { accuserClic, retirerBoutons } = await import('./telegram');
    await accuserClic('q1');
    expect(urls).toEqual(['https://api.telegram.org/botJETON/answerCallbackQuery']);
    await retirerBoutons(42, 5);
    expect(urls[1]).toBe('https://api.telegram.org/botJETON/editMessageReplyMarkup');
    vi.unstubAllGlobals();
  });
});

describe('envoyerTelegram : rangées de boutons', () => {
  const envoyer = async (boutons?: Parameters<typeof import('./telegram').envoyerTelegram>[1]) => {
    process.env.TELEGRAM_TOKEN = 'JETON'; process.env.TELEGRAM_CHAT_ID = '42';
    let corps: { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } } = {};
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { corps = JSON.parse(String(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) }; }));
    const { envoyerTelegram } = await import('./telegram');
    await envoyerTelegram('x', boutons);
    vi.unstubAllGlobals();
    return corps;
  };
  it('une rangée (appels existants) reste une rangée', async () => {
    expect((await envoyer([{ texte: 'A', donnee: 'a' }, { texte: 'B', donnee: 'b' }])).reply_markup!.inline_keyboard)
      .toEqual([[{ text: 'A', callback_data: 'a' }, { text: 'B', callback_data: 'b' }]]);
  });
  it('plusieurs rangées : une ligne chacune', async () => {
    expect((await envoyer([[{ texte: 'A', donnee: 'a' }], [{ texte: 'B', donnee: 'b' }]])).reply_markup!.inline_keyboard)
      .toEqual([[{ text: 'A', callback_data: 'a' }], [{ text: 'B', callback_data: 'b' }]]);
  });
  it('sans boutons : pas de clavier', async () => {
    expect((await envoyer()).reply_markup).toBeUndefined();
  });
});
