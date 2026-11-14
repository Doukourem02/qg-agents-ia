import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { reveiller } from '@/server/kuroro-relais';

// La page ouvre la conversation avec Kuroro : le Mac (mac/kuroro.mjs) se réveille et relit la file toutes les 1,5 s.
// Au plus un réveil par 30 s. Réservé à la page du QG.
export async function POST(req: Request) {
  await connection();
  try {
    if (req.headers.has('x-vercel-protection-bypass') || req.headers.has('authorization')) throw new Refus('réservé à la page du QG', 403);
    return Response.json(await reveiller(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
