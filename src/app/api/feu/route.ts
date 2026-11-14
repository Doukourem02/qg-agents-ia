import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur } from '@/server/auth';
import { vueFeu } from '@/server/feu/vue';

// La page de Feu (lecture seule). Derrière la protection Vercel du déploiement, comme /api/ye. Jamais dans /demo :
// aucun chiffre ni montant réel en public. Aucune action : Feu ne passe jamais un ordre.
export async function GET() {
  await connection();
  try {
    return Response.json(await vueFeu(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
