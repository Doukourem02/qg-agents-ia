import { ImapFlow } from 'imapflow';

// La couche IMAP de Clara : une fine interface injectable au-dessus d'imapflow (les tests passent un faux).

export class ErreurGmail extends Error {
  constructor(message: 'Gmail refuse la connexion' | 'Gmail injoignable') { super(message); this.name = 'ErreurGmail'; }
}

export type Dossiers = { corbeille: string; envoyes: string; tous: string };
/** Les en-têtes d'un mail (jamais le corps). `a` / `cc` : adresses brutes, à normaliser. `date` en ms. */
export type Entete = {
  uid: number; de: { adresse: string; nom?: string }; a: string[]; cc: string[]; date: number; vu: boolean;
  objet?: string; listUnsubscribe?: string; listUnsubscribePost?: string;
};
export type Boite = {
  dossiers(): Promise<Dossiers>;
  /** Nombre de mails d'un dossier. */
  total(dossier: string): Promise<number>;
  /**
   * Les en-têtes des `max` premiers mails d'UID > `uidDepuis` (ou, avec `derniers`, des `max` plus récents),
   * par UID croissant (lecture seule, sans marquer lu).
   */
  lireEntetes(dossier: string, uidDepuis: number, max: number, options?: { derniers?: boolean }): Promise<Entete[]>;
  /** UID des mails qui répondent à une recherche Gmail `X-GM-RAW` (ex. `category:promotions`), éventuellement bornée. */
  chercherGmail(dossier: string, requete: string, plage?: { de: number; a: number }): Promise<number[]>;
};
/** Ce qui sert à mettre à la corbeille : recherche par expéditeur, relecture du From, `UID MOVE` vers \Trash. */
export type Corbeille = {
  /** UID (croissants) des mails dont l'en-tête From contient `adresse` (recherche IMAP `FROM`, sous-chaîne), d'UID > `apresUid`. */
  chercherDe(dossier: string, adresse: string, apresUid?: number): Promise<number[]>;
  /** L'adresse From (brute) de chacun de ces mails, relue juste avant le déplacement (en-tête seulement). */
  expediteurs(dossier: string, uids: number[]): Promise<Map<number, string>>;
  /** `UID MOVE` de ces mails vers le dossier qui a l'attribut \Trash (jamais d'EXPUNGE) ; renvoie le nombre déplacé. */
  corbeille(dossier: string, uids: number[]): Promise<number>;
};
export type BoiteOuverte = Boite & Corbeille & { fermer(): Promise<void> };

/** Le sous-ensemble d'imapflow utilisé ici (permet un faux dans les tests). */
export type ClientImap = {
  connect(): Promise<unknown>;
  logout(): Promise<unknown>;
  close(): void;
  on(ev: 'error', cb: (e: unknown) => void): unknown;
  list(): Promise<{ path: string; specialUse?: string }[]>;
  status(chemin: string, requete: { messages: true }): Promise<{ messages?: number }>;
  getMailboxLock(chemin: string, options: { readOnly: boolean }): Promise<{ release(): void }>;
  search(requete: { uid?: string; gmraw?: string; from?: string }, options: { uid: true }): Promise<number[] | false | undefined>;
  fetch(plage: string, requete: typeof CHAMPS | typeof CHAMPS_DE, options: { uid: true }): AsyncIterable<MessageBrut>;
  messageMove(plage: string, destination: string, options: { uid: true }): Promise<{ uidMap?: Map<number, number> } | false | undefined>;
  capabilities: Map<string, unknown>;
};
type Adresse = { name?: string; address?: string };
type MessageBrut = {
  uid: number; flags?: Set<string>; internalDate?: Date | string; headers?: Buffer;
  envelope?: { date?: Date | string; subject?: string; from?: Adresse[]; to?: Adresse[]; cc?: Adresse[] };
};
// En-têtes seulement : jamais `source` ni `bodyParts` (le corps des mails n'est pas lu).
const CHAMPS = { uid: true, flags: true, envelope: true, internalDate: true, headers: ['list-unsubscribe', 'list-unsubscribe-post'] };
const CHAMPS_DE = { uid: true, envelope: true };
type ConfigClient = { host: string; port: number; secure: boolean; auth: { user: string; pass: string }; logger: false; connectionTimeout: number; greetingTimeout: number; socketTimeout: number };

const DELAI = 20_000;

/** « Nom: valeur » des lignes d'en-tête demandées (lignes repliées dépliées), nom en minuscules. */
function entetes(brut?: Buffer): Record<string, string> {
  const o: Record<string, string> = {};
  for (const l of (brut?.toString('utf8') ?? '').replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = l.indexOf(':');
    if (i > 0) o[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return o;
}
/** UID → ensemble IMAP compact (« 1:3,7,9:10 »). */
export function enPlage(uids: number[]): string {
  const t = [...new Set(uids)].sort((x, y) => x - y), out: string[] = [];
  for (let i = 0; i < t.length; i++) {
    let j = i;
    while (j + 1 < t.length && t[j + 1] === t[j] + 1) j++;
    out.push(i === j ? String(t[i]) : `${t[i]}:${t[j]}`);
    i = j;
  }
  return out.join(',');
}
const enMs = (d?: Date | string) => { const t = d ? new Date(d).getTime() : NaN; return Number.isFinite(t) ? t : 0; };
const adresses = (l?: Adresse[]) => (l ?? []).map(x => x.address ?? '').filter(Boolean);

function versEntete(m: MessageBrut): Entete {
  const de = m.envelope?.from?.[0], h = entetes(m.headers);
  const e: Entete = {
    uid: m.uid, de: { adresse: de?.address ?? '' }, a: adresses(m.envelope?.to), cc: adresses(m.envelope?.cc),
    date: enMs(m.internalDate) || enMs(m.envelope?.date), vu: m.flags?.has('\\Seen') ?? false,
  };
  if (de?.name) e.de.nom = de.name;
  if (m.envelope?.subject) e.objet = m.envelope.subject;
  if (h['list-unsubscribe']) e.listUnsubscribe = h['list-unsubscribe'];
  if (h['list-unsubscribe-post']) e.listUnsubscribePost = h['list-unsubscribe-post'];
  return e;
}
const creerClient = (cfg: ConfigClient): ClientImap => new ImapFlow(cfg) as unknown as ClientImap;

export async function ouvrirBoite(
  cfg: { adresse: string; motDePasse: string }, creer: (c: ConfigClient) => ClientImap = creerClient,
): Promise<BoiteOuverte> {
  const client = creer({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: cfg.adresse, pass: cfg.motDePasse.replace(/\s+/g, '') },
    logger: false, connectionTimeout: DELAI, greetingTimeout: DELAI, socketTimeout: DELAI,
  });
  // imapflow émet 'error' sur les coupures de socket : sans écouteur, c'est une exception non rattrapée.
  // L'erreur est portée par le rejet de la commande en cours.
  client.on('error', () => undefined);
  try {
    await client.connect();
  } catch (e) {
    try { client.close(); } catch { /* déjà fermé */ }
    // Messages fixes : l'erreur d'origine peut citer des identifiants.
    throw new ErreurGmail((e as { authenticationFailed?: boolean })?.authenticationFailed ? 'Gmail refuse la connexion' : 'Gmail injoignable');
  }
  /** Ouvre le dossier (EXAMINE par défaut, SELECT pour déplacer), relâche toujours le verrou ; erreurs en message fixe. */
  async function dansDossier<T>(dossier: string, f: () => Promise<T>, lectureSeule = true): Promise<T> {
    const lock = await client.getMailboxLock(dossier, { readOnly: lectureSeule }).catch(() => { throw new ErreurGmail('Gmail injoignable'); });
    try {
      return await f();
    } catch {
      throw new ErreurGmail('Gmail injoignable');
    } finally {
      lock.release();
    }
  }
  async function dossiers(): Promise<Dossiers> {
    const liste = await client.list().catch(() => { throw new ErreurGmail('Gmail injoignable'); });
    const par = (attr: string) => {
      const d = liste.find(x => x.specialUse === attr);
      if (!d) throw new ErreurGmail('Gmail injoignable');
      return d.path;
    };
    return { corbeille: par('\\Trash'), envoyes: par('\\Sent'), tous: par('\\All') };
  }
  return {
    dossiers,
    async total(dossier) {
      const r = await client.status(dossier, { messages: true }).catch(() => { throw new ErreurGmail('Gmail injoignable'); });
      return r.messages ?? 0;
    },
    async lireEntetes(dossier, uidDepuis, max, options) {
      return dansDossier(dossier, async () => {
        // « n:* » renvoie toujours le dernier mail, même d'UID < n : on refiltre.
        const tous = ((await client.search({ uid: `${uidDepuis + 1}:*` }, { uid: true })) || [])
          .filter(u => u > uidDepuis).sort((x, y) => x - y);
        const uids = options?.derniers ? tous.slice(-max) : tous.slice(0, max);
        if (!uids.length) return [];
        const voulus = new Set(uids), out: Entete[] = [];
        for await (const m of client.fetch(`${uids[0]}:${uids[uids.length - 1]}`, CHAMPS, { uid: true })) {
          if (voulus.has(m.uid)) out.push(versEntete(m));
        }
        return out.sort((x, y) => x.uid - y.uid);
      });
    },
    async chercherGmail(dossier, requete, plage) {
      return dansDossier(dossier, async () => {
        const q: { gmraw: string; uid?: string } = { gmraw: requete };
        if (plage) q.uid = `${plage.de}:${plage.a}`;
        return (await client.search(q, { uid: true })) || [];
      });
    },
    async chercherDe(dossier, adresse, apresUid = 0) {
      return dansDossier(dossier, async () => {
        const q: { from: string; uid?: string } = { from: adresse };
        if (apresUid > 0) q.uid = `${apresUid + 1}:*`;
        // « n:* » renvoie toujours le dernier mail, même d'UID < n : on refiltre.
        return ((await client.search(q, { uid: true })) || []).filter(u => u > apresUid).sort((x, y) => x - y);
      });
    },
    async expediteurs(dossier, uids) {
      const out = new Map<number, string>();
      if (!uids.length) return out;
      return dansDossier(dossier, async () => {
        const voulus = new Set(uids);
        for await (const m of client.fetch(enPlage(uids), CHAMPS_DE, { uid: true })) {
          if (voulus.has(m.uid)) out.set(m.uid, m.envelope?.from?.[0]?.address ?? '');
        }
        return out;
      });
    },
    async corbeille(dossier, uids) {
      if (!uids.length) return 0;
      const d = await dossiers();
      // jamais depuis la corbeille elle-même, et jamais l'émulation COPY + \Deleted + EXPUNGE d'imapflow sans MOVE
      if (dossier === d.corbeille || !client.capabilities?.has('MOVE')) throw new ErreurGmail('Gmail injoignable');
      return dansDossier(dossier, async () => {
        const r = await client.messageMove(enPlage(uids), d.corbeille, { uid: true });
        if (!r) throw new Error('MOVE refusé');
        return r.uidMap?.size ?? uids.length;
      }, false);
    },
    async fermer() {
      try { await client.logout(); } catch { try { client.close(); } catch { /* rien */ } }
    },
  };
}

export async function essai(boite: Pick<Boite, 'dossiers' | 'total'>): Promise<{ ok: true; corbeille: string; envoyes: string; total: number }> {
  const d = await boite.dossiers();
  return { ok: true, corbeille: d.corbeille, envoyes: d.envoyes, total: await boite.total(d.tous) };
}
