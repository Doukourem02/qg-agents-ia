import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur, pageSeulement } from '@/server/auth';
import { vueL } from '@/server/l/vue';

// La page de L : tout ce qu'elle affiche. Derrière la protection Vercel du déploiement, comme /api/missions.
export async function GET(req: Request) {
  const refus = pageSeulement(req);
  if (refus) return refus;
  await connection();
  try {
    return Response.json(await vueL(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
