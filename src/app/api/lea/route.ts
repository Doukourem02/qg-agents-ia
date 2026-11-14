import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { lireJson, reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { vueLea } from '@/server/lea/vue';
import { ID_CONSTAT } from '@/server/lea/etiquette';
import { marquerVu } from '@/server/lea/relecture';

// La page de Léa. Derrière la protection Vercel du déploiement, comme /api/clara et /api/zoro.
export async function GET() {
  await connection();
  try {
    return Response.json(await vueLea(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}

// { vu: <id d'un constat> } : le bouton « Vu ». Seule écriture possible : le statut du constat.
export async function POST(req: Request) {
  await connection();
  try {
    // le laissez-passer des routines : une routine ne marque jamais un constat « vu », seule ma page le fait
    if (req.headers.has('x-vercel-protection-bypass')) throw new Refus('réservé à la page du QG', 403);
    const corps = await lireJson(req);
    if (typeof corps.vu !== 'string' || !ID_CONSTAT.test(corps.vu)) throw new Refus('« vu » : identifiant de constat invalide');
    const { kv } = getKV();
    if (!(await marquerVu(kv, corps.vu))) throw new Refus('constat introuvable', 404);
    return Response.json(await vueLea(kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
