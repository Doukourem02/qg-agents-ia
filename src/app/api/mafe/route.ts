import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur, pageSeulement } from '@/server/auth';
import { vueMafe } from '@/server/mafe/vue';

// La page de Mafe. Derrière la protection Vercel du déploiement, comme /api/clara.
export async function GET(req: Request) {
  const refus = pageSeulement(req);
  if (refus) return refus;
  await connection();
  try {
    return Response.json(await vueMafe(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
