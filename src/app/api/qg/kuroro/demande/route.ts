import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { lireJson, reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { deposerDemande } from '@/server/kuroro-relais';

// La page demande à Kuroro de répondre par le modèle local du Mac (mac/kuroro.mjs). Réservé à la page du QG.
// { messages } → { id } (la page lit ensuite /api/qg/kuroro/reponse?id=) ou { mac: false } (le Mac n'est pas là : règles).
export async function POST(req: Request) {
  await connection();
  try {
    if (req.headers.has('x-vercel-protection-bypass') || req.headers.has('authorization')) throw new Refus('réservé à la page du QG', 403);
    return Response.json(await deposerDemande(getKV().kv, await lireJson(req)), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
