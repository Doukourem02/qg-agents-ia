import { Refus } from '../qg';

// Le client HTTP de LinkedIn : connexion (OAuth), téléversement d'images et de documents, création de posts.
// Sans état : il reçoit le jeton et renvoie ce que LinkedIn répond. Aucun message d'erreur ne contient de corps
// de réponse, de jeton ni de secret : seulement le statut HTTP.

export const VERSION_LINKEDIN = '202610';
export const REDIRECTION = 'https://mon-qg.vercel.app/api/linkedin/retour';
export const PORTEE = 'openid profile w_member_social';
export const LIMITE_COMMENTAIRE = 3000;

export type Fetch = typeof fetch;

const AUTORISATION = 'https://www.linkedin.com/oauth/v2/authorization';
const JETON = 'https://www.linkedin.com/oauth/v2/accessToken';
const API = 'https://api.linkedin.com';
/** Délais au-delà desquels on abandonne l'appel : un post qui n'a pas répondu compte comme incertain. */
const DELAI_MS = 30_000;
const DELAI_POST_MS = 60_000;

const entetesRest = (jeton: string) => ({
  authorization: `Bearer ${jeton}`,
  'LinkedIn-Version': VERSION_LINKEDIN,
  'X-Restli-Protocol-Version': '2.0.0',
});

/** L'adresse où envoyer la personne pour qu'elle autorise le QG. */
export function urlAutorisation(clientId: string, etat: string) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECTION, state: etat, scope: PORTEE });
  return `${AUTORISATION}?${q}`;
}

/** Échange le code reçu au retour contre un jeton. */
export async function echangerCode(code: string, app: { clientId: string; secret: string }, f: Fetch = fetch) {
  let r: Response;
  try {
    r = await f(JETON, {
      method: 'POST',
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECTION, client_id: app.clientId, client_secret: app.secret }).toString(),
    });
  } catch { throw new Refus('LinkedIn injoignable (échange du code)', 502); }
  if (!r.ok) throw new Refus(`LinkedIn a refusé l'échange du code (${r.status})`, 502);
  const d = await r.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
  if (typeof d?.access_token !== 'string' || typeof d.expires_in !== 'number') throw new Refus('LinkedIn : réponse inattendue (jeton)', 502);
  return { jeton: d.access_token, expireDans: d.expires_in };
}

/** Qui est connecté : l'identifiant d'auteur (URN) et le nom. */
export async function lireProfil(jeton: string, f: Fetch = fetch) {
  let r: Response;
  try { r = await f(`${API}/v2/userinfo`, { headers: { authorization: `Bearer ${jeton}` }, signal: AbortSignal.timeout(DELAI_MS) }); }
  catch { throw new Refus('LinkedIn injoignable (profil)', 502); }
  if (!r.ok) throw new Refus(`LinkedIn a refusé la lecture du profil (${r.status})`, 502);
  const d = await r.json().catch(() => null) as { sub?: unknown; name?: unknown } | null;
  if (typeof d?.sub !== 'string' || !d.sub) throw new Refus('LinkedIn : réponse inattendue (profil)', 502);
  return { auteur: `urn:li:person:${d.sub}`, nom: typeof d.name === 'string' ? d.name : '' };
}

/** Le jeton ne part que vers LinkedIn : https, et un hôte linkedin.com ou licdn.com (sous-domaines compris). */
function adresseLinkedIn(adresse: string) {
  try {
    const u = new URL(adresse);
    return u.protocol === 'https:' && /(^|\.)(linkedin\.com|licdn\.com)$/.test(u.hostname);
  } catch { return false; }
}

/** Un refus de LinkedIn. `nonConnecte` : le jeton n'est plus accepté (401 ou 403, par exemple révoqué avant
 *  son expiration) ; il faut refaire la connexion. */
export class RefusLinkedIn extends Refus {
  constructor(message: string, readonly nonConnecte = false) { super(message, 502); }
}
const jetonRejete = (status: number) => status === 401 || status === 403;
/** Vrai si l'erreur dit que LinkedIn ne reconnaît plus le jeton. */
export const jetonRefuse = (e: unknown) => e instanceof RefusLinkedIn && e.nonConnecte;

/** Téléverse une image ou un document (PDF) ; renvoie son URN, à joindre au post. */
export async function televerser(jeton: string, auteur: string, genre: 'image' | 'document', contenu: Uint8Array, f: Fetch = fetch) {
  const chemin = genre === 'image' ? 'images' : 'documents';
  let r: Response;
  try {
    r = await f(`${API}/rest/${chemin}?action=initializeUpload`, {
      method: 'POST',
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { ...entetesRest(jeton), 'content-type': 'application/json' },
      body: JSON.stringify({ initializeUploadRequest: { owner: auteur } }),
    });
  } catch { throw new Refus(`LinkedIn injoignable (préparation du ${genre})`, 502); }
  if (!r.ok) throw new RefusLinkedIn(`LinkedIn a refusé la préparation du ${genre} (${r.status})`, jetonRejete(r.status));
  const d = await r.json().catch(() => null) as { value?: { uploadUrl?: unknown; image?: unknown; document?: unknown } } | null;
  const url = d?.value?.uploadUrl, urn = d?.value?.[genre];
  if (typeof url !== 'string' || typeof urn !== 'string') throw new Refus(`LinkedIn : réponse inattendue (${genre})`, 502);
  if (!adresseLinkedIn(url)) throw new Refus(`LinkedIn : adresse de téléversement refusée (${genre})`, 502);
  let p: Response;
  try { p = await f(url, { method: 'PUT', signal: AbortSignal.timeout(DELAI_MS), headers: { authorization: `Bearer ${jeton}` }, body: contenu as Uint8Array<ArrayBuffer> }); }
  catch { throw new Refus(`LinkedIn injoignable (envoi du ${genre})`, 502); }
  if (!p.ok) throw new RefusLinkedIn(`LinkedIn a refusé l'envoi du ${genre} (${p.status})`, jetonRejete(p.status));
  return urn;
}

/** Une publication qui a échoué. `incertain` : le post est peut-être parti malgré tout (ne pas réessayer à l'aveugle). */
export class ErreurPublication extends RefusLinkedIn {
  constructor(message: string, readonly incertain: boolean, nonConnecte = false) { super(message, nonConnecte); }
}

/** Publie le post ; renvoie son URN. */
export async function creerPost(jeton: string, p: { auteur: string; commentaire: string; media?: { id: string; titre?: string } }, f: Fetch = fetch) {
  const corps = {
    author: p.auteur,
    commentary: p.commentaire,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
    ...(p.media ? { content: { media: { id: p.media.id, ...(p.media.titre ? { title: p.media.titre } : {}) } } } : {}),
  };
  let r: Response;
  try {
    r = await f(`${API}/rest/posts`, {
      method: 'POST', signal: AbortSignal.timeout(DELAI_POST_MS),
      headers: { ...entetesRest(jeton), 'content-type': 'application/json' }, body: JSON.stringify(corps),
    });
  } catch { throw new ErreurPublication('LinkedIn injoignable : le post est peut-être parti', true); }
  // un 401/403 est un refus net : le jeton n'est plus accepté, rien n'est parti
  if (!r.ok) throw new ErreurPublication(`LinkedIn a refusé le post (${r.status})`, r.status >= 500 || r.status === 408, jetonRejete(r.status));
  const id = r.headers.get('x-restli-id');
  if (!id) throw new ErreurPublication('LinkedIn n’a pas confirmé le post : il est peut-être parti', true);
  return id;
}

/** Le texte d'un post : LinkedIn lit ces caractères comme du balisage, il faut les protéger (le `\` d'abord). */
const escaper = (t: string) => t.replace(/[\\|{}@[\]()<>#*_~]/g, c => `\\${c}`);

/** Le commentaire final : le texte échappé, puis les hashtags au format de balisage de LinkedIn. */
export function commentaireLinkedIn(texte: string, hashtags: string[]) {
  const tags = hashtags.map(h => h.replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean).map(h => `{hashtag|\\#|${h}}`);
  return tags.length ? `${escaper(texte)}\n\n${tags.join(' ')}` : escaper(texte);
}
