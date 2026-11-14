import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { lireJson, reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { debannir, majVip, vueClara } from '@/server/clara/vue';

// La page de Clara. Derrière la protection Vercel du déploiement, comme /api/l.
export async function GET() {
  await connection();
  try {
    return Response.json(await vueClara(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}

const ID = /^[a-z0-9]{1,16}$/;

// { vip: string, ajout: boolean } ou { debannir: id }
export async function POST(req: Request) {
  await connection();
  try {
    // le laissez-passer des routines : une routine ne change jamais les VIP ni les bannis, seule ma page le fait
    if (req.headers.has('x-vercel-protection-bypass')) throw new Refus('réservé à la page du QG', 403);
    const corps = await lireJson(req);
    const { kv } = getKV();
    if (corps.debannir !== undefined) {
      if (typeof corps.debannir !== 'string' || !ID.test(corps.debannir)) throw new Refus('« debannir » : identifiant invalide');
      await debannir(kv, corps.debannir);
    } else if (typeof corps.vip === 'string' && typeof corps.ajout === 'boolean') {
      await majVip(kv, corps.vip, corps.ajout);
    } else {
      throw new Refus('« vip » et « ajout », ou « debannir », attendus');
    }
    return Response.json(await vueClara(kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
