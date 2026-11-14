import { fauxGitHub, memoireEspionne, type FauxDepot } from '../paul/faux-github-test';
import type { DepsYe } from './lot';

// Aide de test : un faux Sanity (requêtes et un patch avec ifRevisionID, comme l'API HTTP) branché à côté du faux
// GitHub de Paul, sans réseau.

export const JETON_SANITY = 'cle' + '-sanity-' + 'editor';
export type FauxDoc = {
  _id: string; _rev: string; title: string; kind?: string; kindEn?: string; status?: string; description?: string; descriptionEn?: string;
  liveUrl?: string; githubUrl?: string; technologies?: { _key: string; _ref: string }[]; mainImage?: unknown; order?: number;
};
export type Mutation = { corps: { mutations: { patch: { id: string; ifRevisionID: string; set: Record<string, unknown> } }[] }; jeton: string };
export type Creation = { doc: Record<string, unknown>; jeton: string };

export function fauxSanity(fiches: FauxDoc[], competences: { _id: string; name: string }[], brouillons: string[] = []) {
  /** `versions` : des documents de release « versions.<release>.<id> » en cours. */
  const etat = {
    fiches, competences, brouillons: new Set(brouillons), versions: new Set<string>(), panne: false, mutations: [] as Mutation[], rev: 0,
    /** Les documents créés (`create`), les images reçues, et une création dont la réponse se perd (`perdre`). */
    crees: [] as Creation[], images: [] as { nom: string; taille: number; jeton: string }[], perdre: false,
  };
  const f = async (url: string, init?: RequestInit): Promise<Response> => {
    if (etat.panne) return new Response('', { status: 503 });
    const h = (init?.headers ?? {}) as Record<string, string>;
    const u = new URL(url);
    if (u.pathname.includes('/data/query/')) {
      const q = u.searchParams.get('query') ?? '';
      if (q.includes('"o"')) {
        const o = etat.fiches.filter(d => typeof d.order === 'number' && !d._id.startsWith('drafts.')).map(d => d.order as number);
        return Response.json({ result: { o: o.length ? Math.max(...o) : null } });
      }
      if (q.includes('"d"')) {
        const ids = [u.searchParams.get('$id'), u.searchParams.get('$brouillon')].map(x => JSON.parse(x ?? 'null') as string);
        const d = [...etat.fiches, ...etat.crees.map(c => c.doc as FauxDoc)].find(x => ids.includes(x._id));
        return Response.json({ result: { d: d ? { title: d.title } : null } });
      }
      if (q.includes('"fiches"')) {
        // le filtre de la requête : ni brouillons ni versions (perspective raw)
        const filtre = q.includes('!(_id in path("versions.**"))');
        return Response.json({ result: {
          fiches: etat.fiches.filter(d => !filtre || !d._id.startsWith('versions.')).map(d => ({ ...d, technologies: d.technologies ?? [] })),
          competences: etat.competences,
          brouillons: [...etat.brouillons].map(id => `drafts.${id}`),
        } });
      }
      const id = JSON.parse(u.searchParams.get('$id') ?? 'null') as string;
      const v = JSON.parse(u.searchParams.get('$versions') ?? 'null') as string | null;
      const brut = id.replace(/^drafts\./, '');
      const version = v && q.includes('path($versions)') ? [...etat.versions].find(x => x.endsWith(`.${brut}`)) : undefined;
      return Response.json({ result: { id: etat.brouillons.has(brut) ? id : version ? `versions.${version}` : null } });
    }
    if (u.pathname.includes('/assets/images/')) {
      const taille = (init?.body as ArrayBuffer).byteLength;
      etat.images.push({ nom: u.searchParams.get('filename') ?? '', taille, jeton: (h.Authorization ?? '').replace(/^Bearer /, '') });
      return Response.json({ document: { _id: `image-${etat.images.length}` } });
    }
    if (u.pathname.includes('/data/mutate/') && String(init?.body).includes('"create"')) {
      const doc = (JSON.parse(String(init?.body)) as { mutations: { create: Record<string, unknown> }[] }).mutations[0].create;
      const id = String(doc._id).replace(/^drafts\./, '');
      if ([...etat.fiches, ...etat.crees.map(c => c.doc as FauxDoc)].some(d => d._id === id || d._id === `drafts.${id}`)) return Response.json({ error: {} }, { status: 409 });
      etat.crees.push({ doc, jeton: (h.Authorization ?? '').replace(/^Bearer /, '') });
      if (etat.perdre) { etat.perdre = false; return new Response('', { status: 504 }); }
      return Response.json({ transactionId: 't', results: [{ id: doc._id, operation: 'create' }] });
    }
    if (u.pathname.includes('/data/mutate/')) {
      const corps = JSON.parse(String(init?.body)) as Mutation['corps'];
      etat.mutations.push({ corps, jeton: (h.Authorization ?? '').replace(/^Bearer /, '') });
      const { id, ifRevisionID, set } = corps.mutations[0].patch;
      const d = etat.fiches.find(x => x._id === id);
      if (!d || d._rev !== ifRevisionID) return Response.json({ error: { description: 'revision mismatch' } }, { status: 409 });
      Object.assign(d, set, { _rev: `rev-${++etat.rev}` });
      return Response.json({ transactionId: 't', results: [{ id, operation: 'update' }] });
    }
    return new Response('', { status: 404 });
  };
  return { etat, fetch: f };
}

export type Message = { texte: string; boutons?: { texte: string; donnee: string }[][] };

/** GitHub (dépôts) + Sanity (fiches, compétences), une mémoire espionne et un Telegram qui note tout. */
export function bancYe(depots: FauxDepot[], fiches: FauxDoc[], competences: { _id: string; name: string }[], brouillons: string[] = []) {
  const { kv, ecrits } = memoireEspionne();
  const gh = fauxGitHub(depots);
  const sanity = fauxSanity(fiches, competences, brouillons);
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => (String(url).includes('api.sanity.io') ? sanity.fetch(String(url), init) : gh.fetch(url, init))) as unknown as typeof globalThis.fetch;
  const messages: Message[] = [];
  const deps: DepsYe = { fetch, envoyer: async (texte, boutons) => { messages.push({ texte, boutons }); }, jeton: 'jeton-lecture', sanity: JETON_SANITY, echeance: 5_000 };
  return { kv, ecrits, gh, sanity, messages, deps, depots, publication: { fetch, jeton: JETON_SANITY }, creation: { fetch, jeton: JETON_SANITY, github: 'jeton-lecture' } };
}
