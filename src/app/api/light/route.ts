import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur, pageSeulement } from '@/server/auth';
import { vueLight } from '@/server/light/vue';

// La page de Light : le relevé regroupé par projet, avec les vrais noms (page privée, derrière la protection Vercel ; panneau absent de /demo).
export async function GET(req: Request) {
  const refus = pageSeulement(req);
  if (refus) return refus;
  await connection();
  try {
    return Response.json(await vueLight(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
