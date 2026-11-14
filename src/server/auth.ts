import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { Refus } from './qg';

/**
 * Les entrées réservées aux agents exigent une preuve (voir verifierAgent).
 * Les secrets vivent dans les réglages de Vercel, de claude.ai et du trousseau du Mac, jamais dans le code.
 */
const egal = (recue: string, attendue?: string) => {
  if (!attendue || !recue) return false;
  const a = Buffer.from(recue), b = Buffer.from(attendue);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Deux façons équivalentes de prouver qu'on est un agent :
 * - la clé des agents : « Authorization: Bearer <QG_CLE_AGENTS> » (agents du Mac) ;
 * - le laissez-passer de la protection Vercel : « x-vercel-protection-bypass » (routines Claude Code, où
 *   claude.ai n'accepte qu'un secret réseau par adresse). Sa copie côté serveur est QG_PASSE_AGENTS ;
 *   il est aussi secret que la clé.
 */
export function verifierAgent(req: Request) {
  // QG_PASSE_AGENTS : notre laissez-passer (VERCEL_AUTOMATION_BYPASS_SECRET peut désigner un autre laissez-passer du projet)
  const cle = process.env.QG_CLE_AGENTS, passe = process.env.QG_PASSE_AGENTS;
  if (!cle && !passe) throw new Refus('clé des agents non configurée sur le serveur', 503);
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const bypass = req.headers.get('x-vercel-protection-bypass') ?? '';
  if (!egal(bearer, cle) && !egal(bypass, passe)) throw new Refus('clé invalide', 401);
  // Une clé par agent (facultative) : si QG_CLE_AGENT_<NOM> existe, la porte /api/agents/<nom>/… exige en plus cette clé
  // dans l'en-tête « x-qg-agent-cle ». Un agent piégé par un texte qu'il lit ne peut alors plus parler au nom d'un autre.
  const propre = cleDeLAgent(agentDeLaRoute(req.url));
  if (propre && !egal(req.headers.get('x-qg-agent-cle') ?? '', propre)) throw new Refus('clé de cet agent invalide', 401);
}

/** « /api/agents/lea/rapport » → « lea » ; null hors des portes des agents. */
export function agentDeLaRoute(url: string): string | null {
  const m = /^\/api\/agents\/([a-z0-9-]+)(?:\/|$)/i.exec(new URL(url).pathname);
  return m ? m[1].toLowerCase() : null;
}
const cleDeLAgent = (agent: string | null) => (agent ? process.env[`QG_CLE_AGENT_${agent.toUpperCase().replace(/-/g, '_')}`] : undefined);

/** Transforme une erreur en réponse JSON propre (jamais de détail interne). */
/**
 * Les entrées de ma page (lire l'état, déposer une mission, choisir un sujet…) sont réservées à mon navigateur, connecté
 * par Vercel. Le laissez-passer des routines et la clé des agents traversent cette connexion : ici, ils sont refusés.
 * Un agent ne parle au QG que par /api/agents/… ; il ne lit pas les bureaux des autres et ne donne pas de mission à ma place.
 */
export function pageSeulement(req: Request): Response | null {
  if (req.headers.has('x-vercel-protection-bypass') || req.headers.has('authorization') || new URL(req.url).searchParams.has('x-vercel-protection-bypass')) {
    return Response.json({ erreur: 'réservé à la page du QG' }, { status: 403 });
  }
  return null;
}

export function reponseErreur(e: unknown) {
  if (e instanceof Refus) return Response.json({ erreur: e.message }, { status: e.code });
  console.error(e);
  return Response.json({ erreur: 'erreur interne' }, { status: 500 });
}

export async function lireJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* corps illisible */ }
  throw new Refus('corps JSON attendu');
}
