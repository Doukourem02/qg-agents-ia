import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { lireJson, reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { ajouterRegleQG, lireRegles, modifierRegleQG, retirerRegleQG, type RegleQG } from '@/server/regles';

// « Mes règles », écrites par le patron dans le Cerveau. Derrière la protection Vercel du déploiement, comme /api/clara.
// Seule la page les lit et les change ici : les agents les lisent sur /api/agents/regles.
const NO_STORE = { 'cache-control': 'no-store' };

function pageSeulement(req: Request) {
  // le laissez-passer des routines ou la clé des agents : jamais une routine ne touche à mes règles
  if (req.headers.has('x-vercel-protection-bypass') || req.headers.has('authorization')) throw new Refus('réservé à la page du QG', 403);
}

async function repondre(req: Request, faire: (corps: Record<string, unknown>) => Promise<RegleQG[]>, avecCorps = true) {
  await connection();
  try {
    pageSeulement(req);
    const corps = avecCorps ? await lireJson(req) : {};
    return Response.json({ regles: await faire(corps) }, { headers: NO_STORE });
  } catch (e) {
    return reponseErreur(e);
  }
}

export const GET = (req: Request) => repondre(req, () => lireRegles(getKV().kv), false);
// { texte }
export const POST = (req: Request) => repondre(req, c => ajouterRegleQG(getKV().kv, c.texte));
// { id, texte }
export const PATCH = (req: Request) => repondre(req, c => modifierRegleQG(getKV().kv, c.id, c.texte));
// { id }
export const DELETE = (req: Request) => repondre(req, c => retirerRegleQG(getKV().kv, c.id));
