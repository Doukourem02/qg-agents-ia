import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur } from '@/server/auth';
import { vueIsaac } from '@/server/isaac/vue';

// La page d'Isaac. Derrière la protection Vercel du déploiement, comme /api/luffy.
export async function GET() {
  await connection();
  try {
    return Response.json(await vueIsaac(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
