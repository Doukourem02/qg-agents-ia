import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { lireJson, reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { ajouterRegle, lireMemoire, modifierRegle, retirerRegle } from '@/server/l/memoire';

// Ce que L a retenu (ses leçons d'écriture), corrigé par le patron dans le Cerveau. Derrière la protection Vercel,
// comme /api/clara. L continue d'ajouter les siennes par sa routine (POST /api/agents/l/memoire).
const NO_STORE = { 'cache-control': 'no-store' };

function pageSeulement(req: Request) {
  if (req.headers.has('x-vercel-protection-bypass') || req.headers.has('authorization')) throw new Refus('réservé à la page du QG', 403);
}

async function repondre(req: Request, faire: (corps: Record<string, unknown>) => Promise<string[]>, avecCorps = true) {
  await connection();
  try {
    pageSeulement(req);
    const corps = avecCorps ? await lireJson(req) : {};
    return Response.json({ regles: await faire(corps) }, { headers: NO_STORE });
  } catch (e) {
    return reponseErreur(e);
  }
}

const relire = async () => (await lireMemoire(getKV().kv)).regles;

export const GET = (req: Request) => repondre(req, relire, false);
// { regle }
export const POST = (req: Request) => repondre(req, async c => { await ajouterRegle(getKV().kv, c.regle as string); return relire(); });
// { ancienne, regle }
export const PATCH = (req: Request) => repondre(req, c => modifierRegle(getKV().kv, c.ancienne as string, c.regle as string));
// { regle }
export const DELETE = (req: Request) => repondre(req, c => retirerRegle(getKV().kv, c.regle as string));
