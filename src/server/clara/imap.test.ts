import { describe, expect, it, vi } from 'vitest';
import { enPlage, ErreurGmail, essai, ouvrirBoite, type Boite, type ClientImap } from './imap';

const fauxClient = (over: Partial<ClientImap> = {}): ClientImap => ({
  connect: vi.fn(async () => undefined),
  logout: vi.fn(async () => undefined),
  close: vi.fn(() => undefined),
  on: vi.fn(() => undefined),
  list: vi.fn(async () => [
    { path: 'INBOX', specialUse: undefined },
    { path: '[Gmail]/Corbeille', specialUse: '\\Trash' },
    { path: '[Gmail]/Messages envoyés', specialUse: '\\Sent' },
    { path: '[Gmail]/Tous les messages', specialUse: '\\All' },
  ]),
  status: vi.fn(async () => ({ messages: 1234 })),
  getMailboxLock: vi.fn(async () => ({ path: 'X', release: vi.fn() })),
  search: vi.fn(async () => []),
  fetch: vi.fn(async function* () { /* rien */ }),
  messageMove: vi.fn(async () => ({ uidMap: new Map() })),
  capabilities: new Map([['MOVE', true], ['UIDPLUS', true]]),
  ...over,
});

describe('essai', () => {
  it('renvoie les dossiers détectés par attribut, pas par nom anglais', async () => {
    const boite: Pick<Boite, 'dossiers' | 'total'> = {
      dossiers: async () => ({ corbeille: '[Gmail]/Corbeille', envoyes: '[Gmail]/Messages envoyés', tous: '[Gmail]/Tous les messages' }),
      total: async d => (d === '[Gmail]/Tous les messages' ? 42 : 0),
    };
    expect(await essai(boite)).toEqual({ ok: true, corbeille: '[Gmail]/Corbeille', envoyes: '[Gmail]/Messages envoyés', total: 42 });
  });
});

describe('ouvrirBoite', () => {
  it('détecte \\Trash, \\Sent, \\All sur des noms localisés', async () => {
    const b = await ouvrirBoite({ adresse: 'a@gmail.com', motDePasse: 'x' }, () => fauxClient());
    expect(await b.dossiers()).toEqual({ corbeille: '[Gmail]/Corbeille', envoyes: '[Gmail]/Messages envoyés', tous: '[Gmail]/Tous les messages' });
    expect(await b.total('[Gmail]/Tous les messages')).toBe(1234);
  });

  it('retire les espaces du mot de passe d\'application', async () => {
    let recu: unknown;
    await ouvrirBoite({ adresse: 'a@gmail.com', motDePasse: 'abcd efgh ijkl mnop' }, cfg => { recu = cfg; return fauxClient(); });
    expect((recu as { auth: { pass: string } }).auth.pass).toBe('abcdefghijklmnop');
    expect(recu).toMatchObject({ host: 'imap.gmail.com', port: 993, secure: true });
  });

  it('refus d\'authentification : ErreurGmail sans le mot de passe', async () => {
    const client = fauxClient({ connect: async () => { throw Object.assign(new Error('Invalid credentials abcdefghijklmnop'), { authenticationFailed: true }); } });
    const err = await ouvrirBoite({ adresse: 'a@gmail.com', motDePasse: 'abcd efgh ijkl mnop' }, () => client).catch(e => e);
    expect(err).toBeInstanceOf(ErreurGmail);
    expect(err.message).toBe('Gmail refuse la connexion');
    expect(JSON.stringify([err.message, err.stack])).not.toContain('abcdefghijklmnop');
  });

  it('panne réseau : « Gmail injoignable »', async () => {
    const client = fauxClient({ connect: async () => { throw new Error('ETIMEDOUT'); } });
    await expect(ouvrirBoite({ adresse: 'a', motDePasse: 'b' }, () => client)).rejects.toThrow('Gmail injoignable');
  });

  it('fermer() se déconnecte', async () => {
    const client = fauxClient();
    const b = await ouvrirBoite({ adresse: 'a', motDePasse: 'b' }, () => client);
    await b.fermer();
    expect(client.logout).toHaveBeenCalled();
  });

  it('écoute \'error\' : une erreur de socket émise ne plante pas', async () => {
    const { EventEmitter } = await import('node:events');
    const em = new EventEmitter();
    const client = fauxClient({ on: ((ev: 'error', cb: (e: unknown) => void) => em.on(ev, cb)) as ClientImap['on'] });
    await ouvrirBoite({ adresse: 'a', motDePasse: 'b' }, () => client);
    expect(() => em.emit('error', new Error('ECONNRESET'))).not.toThrow();
  });

  it('close() est appelé quand la connexion échoue', async () => {
    const client = fauxClient({ connect: async () => { throw new Error('x'); } });
    await ouvrirBoite({ adresse: 'a', motDePasse: 'b' }, () => client).catch(() => undefined);
    expect(client.close).toHaveBeenCalled();
  });

  it('list()/status() en échec : message fixe, sans le texte du serveur', async () => {
    const b = await ouvrirBoite({ adresse: 'a', motDePasse: 'b' }, () => fauxClient({
      list: async () => { throw new Error('secret serveur'); }, status: async () => { throw new Error('secret serveur'); },
    }));
    for (const p of [b.dossiers(), b.total('X')]) {
      const e = await p.catch(x => x);
      expect(e).toBeInstanceOf(ErreurGmail);
      expect(e.message).toBe('Gmail injoignable');
    }
  });
});

describe('lireEntetes / chercherGmail', () => {
  const brut = (uid: number, over: Record<string, unknown> = {}) => ({
    seq: uid, uid, flags: new Set(uid % 2 ? ['\\Seen'] : []), internalDate: new Date(1_700_000_000_000 + uid),
    envelope: { subject: `Objet ${uid}`, from: [{ name: 'Marque X', address: 'News@X.com' }], to: [{ address: 'moi@gmail.com' }], cc: [{ name: 'B', address: 'b@b.com' }] },
    headers: Buffer.from('List-Unsubscribe: <mailto:u@x.com>,\r\n <https://x.com/u>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\r\n'),
    ...over,
  });

  it('verrou en lecture seule, UID > curseur, au plus max, en-têtes seulement, verrou relâché', async () => {
    const release = vi.fn();
    const recu: { lock?: unknown[]; search?: unknown[]; fetch?: unknown[] } = {};
    const client = fauxClient({
      getMailboxLock: vi.fn(async (...a: unknown[]) => { recu.lock = a; return { path: 'X', release }; }),
      // « 11:* » renvoie le dernier mail même s'il n'y a rien après : à filtrer
      search: vi.fn(async (...a: unknown[]) => { recu.search = a; return [10, 11, 12, 14, 15]; }),
      fetch: vi.fn(async function* (...a: unknown[]) { recu.fetch = a; yield brut(12); yield brut(11, { headers: undefined, envelope: { from: [] } }); yield brut(14); }),
    });
    const b = await ouvrirBoite({ adresse: 'a', motDePasse: 'b' }, () => client);
    const r = await b.lireEntetes('[Gmail]/Tous les messages', 10, 3);
    expect(recu.lock).toEqual(['[Gmail]/Tous les messages', { readOnly: true }]);
    expect(recu.search).toEqual([{ uid: '11:*' }, { uid: true }]);
    expect(recu.fetch?.[0]).toBe('11:14');
    expect(recu.fetch?.[1]).toEqual({ uid: true, flags: true, envelope: true, internalDate: true, headers: ['list-unsubscribe', 'list-unsubscribe-post'] });
    expect(recu.fetch?.[1]).not.toHaveProperty('source');
    expect(recu.fetch?.[2]).toEqual({ uid: true });
    expect(release).toHaveBeenCalledTimes(1);
    expect(r.map(m => m.uid)).toEqual([11, 12, 14]);
    expect(r[1]).toEqual({
      uid: 12, de: { adresse: 'News@X.com', nom: 'Marque X' }, a: ['moi@gmail.com'], cc: ['b@b.com'], date: 1_700_000_000_012, vu: false,
      objet: 'Objet 12', listUnsubscribe: '<mailto:u@x.com>, <https://x.com/u>', listUnsubscribePost: 'List-Unsubscribe=One-Click',
    });
    expect(r[0]).toMatchObject({ uid: 11, de: { adresse: '' }, vu: true });
    expect(r[0].listUnsubscribe).toBeUndefined();
  });

  it('option derniers : les max UID les plus hauts', async () => {
    let plage: unknown;
    const client = fauxClient({
      search: vi.fn(async () => [3, 1, 7, 5, 9]),
      fetch: vi.fn(async function* (p: unknown) { plage = p; yield brut(7); yield brut(9); }),
    });
    const b = await ouvrirBoite({ adresse: 'a', motDePasse: 'b' }, () => client);
    expect((await b.lireEntetes('S', 0, 2, { derniers: true })).map(m => m.uid)).toEqual([7, 9]);
    expect(plage).toBe('7:9');
  });

  it('rien après le curseur : pas de fetch', async () => {
    const client = fauxClient({ search: vi.fn(async () => [10]) });
    const b = await ouvrirBoite({ adresse: 'a', motDePasse: 'b' }, () => client);
    expect(await b.lireEntetes('A', 10, 2000)).toEqual([]);
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('chercherGmail : X-GM-RAW borné à une plage d\'UID', async () => {
    const release = vi.fn();
    const search = vi.fn(async () => [3, 5]);
    const b = await ouvrirBoite({ adresse: 'a', motDePasse: 'b' }, () => fauxClient({ search, getMailboxLock: vi.fn(async () => ({ path: 'X', release })) }));
    expect(await b.chercherGmail('A', 'category:promotions', { de: 1, a: 9 })).toEqual([3, 5]);
    expect(search).toHaveBeenCalledWith({ gmraw: 'category:promotions', uid: '1:9' }, { uid: true });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('erreur pendant la lecture : message fixe, verrou relâché', async () => {
    const release = vi.fn();
    const b = await ouvrirBoite({ adresse: 'a', motDePasse: 'b' }, () => fauxClient({
      getMailboxLock: vi.fn(async () => ({ path: 'X', release })),
      search: vi.fn(async () => { throw new Error('secret serveur'); }),
    }));
    for (const p of [b.lireEntetes('A', 0, 10), b.chercherGmail('A', 'category:social')]) {
      const e = await p.catch(x => x);
      expect(e).toBeInstanceOf(ErreurGmail);
      expect(e.message).toBe('Gmail injoignable');
    }
    expect(release).toHaveBeenCalledTimes(2);
  });
});

describe('corbeille : chercherDe / expediteurs / corbeille', () => {
  const ouvrir = (over: Partial<ClientImap>) => ouvrirBoite({ adresse: 'a', motDePasse: 'b' }, () => fauxClient(over));

  it('enPlage compresse les UID', () => {
    expect(enPlage([9, 1, 2, 3, 7, 10, 3])).toBe('1:3,7,9:10');
    expect(enPlage([5])).toBe('5');
  });

  it('chercherDe : FROM en lecture seule, UID > apresUid, croissant', async () => {
    const getMailboxLock = vi.fn(async () => ({ release: vi.fn() }));
    const search = vi.fn(async () => [30, 21, 20]);
    const b = await ouvrir({ search, getMailboxLock });
    expect(await b.chercherDe('A', 'news@x.com', 20)).toEqual([21, 30]);
    expect(search).toHaveBeenCalledWith({ from: 'news@x.com', uid: '21:*' }, { uid: true });
    expect(getMailboxLock).toHaveBeenCalledWith('A', { readOnly: true });
    await b.chercherDe('A', 'news@x.com');
    expect(search).toHaveBeenLastCalledWith({ from: 'news@x.com' }, { uid: true });
  });

  it('expediteurs : enveloppe seulement, jamais le corps', async () => {
    let champs: unknown;
    const b = await ouvrir({
      fetch: vi.fn(async function* (_p: unknown, c: unknown) {
        champs = c;
        yield { uid: 1, envelope: { from: [{ address: 'News@X.com' }] } };
        yield { uid: 2, envelope: {} };
        yield { uid: 99, envelope: { from: [{ address: 'autre@y.com' }] } };
      }),
    });
    const r = await b.expediteurs('A', [1, 2]);
    expect([...r]).toEqual([[1, 'News@X.com'], [2, '']]);
    expect(champs).toEqual({ uid: true, envelope: true });
  });

  it('corbeille : UID MOVE vers le dossier \\Trash, verrou en écriture relâché', async () => {
    const release = vi.fn();
    const getMailboxLock = vi.fn(async () => ({ release }));
    const messageMove = vi.fn(async () => ({ uidMap: new Map([[1, 101], [2, 102], [3, 103]]) }));
    const b = await ouvrir({ getMailboxLock, messageMove });
    expect(await b.corbeille('[Gmail]/Tous les messages', [3, 1, 2])).toBe(3);
    expect(messageMove).toHaveBeenCalledWith('1:3', '[Gmail]/Corbeille', { uid: true });
    expect(getMailboxLock).toHaveBeenCalledWith('[Gmail]/Tous les messages', { readOnly: false });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('corbeille : sans MOVE, rien (pas de COPY + EXPUNGE)', async () => {
    const messageMove = vi.fn(async () => ({ uidMap: new Map() }));
    const b = await ouvrir({ messageMove, capabilities: new Map() });
    await expect(b.corbeille('A', [1])).rejects.toThrow('Gmail injoignable');
    expect(messageMove).not.toHaveBeenCalled();
  });

  it('corbeille : jamais depuis la corbeille elle-même ; liste vide : rien', async () => {
    const messageMove = vi.fn(async () => ({ uidMap: new Map() }));
    const b = await ouvrir({ messageMove });
    await expect(b.corbeille('[Gmail]/Corbeille', [1])).rejects.toThrow(ErreurGmail);
    expect(await b.corbeille('A', [])).toBe(0);
    expect(messageMove).not.toHaveBeenCalled();
  });

  it('corbeille : MOVE refusé (false) → erreur fixe', async () => {
    const b = await ouvrir({ messageMove: vi.fn(async () => false as const) });
    const e = await b.corbeille('A', [1]).catch(x => x);
    expect(e).toBeInstanceOf(ErreurGmail);
    expect(e.message).toBe('Gmail injoignable');
  });
});
