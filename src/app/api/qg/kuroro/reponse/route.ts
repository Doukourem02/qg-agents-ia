import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { lireReponse } from '@/server/kuroro-relais';

// La page lit la réponse du Mac à sa demande : { statut: 'attente' | 'prete' | 'expiree', texte?, mission? }. Réservé à la page.
export async function GET(req: Request) {
  await connection();
  try {
    if (req.headers.has('x-vercel-protection-bypass') || req.headers.has('authorization')) throw new Refus('réservé à la page du QG', 403);
    const id = new URL(req.url).searchParams.get('id');
    return Response.json(await lireReponse(getKV().kv, id), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
