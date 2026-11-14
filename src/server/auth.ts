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
}

/** Transforme une erreur en réponse JSON propre (jamais de détail interne). */
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
