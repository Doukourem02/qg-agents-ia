import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { lireJson, reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { comptesRendus, marquerVisite } from '@/server/comptes-rendus';

// Les comptes rendus de l'arrivée. Derrière la protection Vercel du déploiement, comme /api/luffy.
export async function GET() {
  await connection();
  try {
    return Response.json(await comptesRendus(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}

// { vu: true, jusqua } : `jusqua` est l'heure de la liste vue (renvoyée par GET) ; le patron a fermé le menu, la visite est enregistrée.
export async function POST(req: Request) {
  await connection();
  try {
    // le laissez-passer des routines : seule la page du QG marque une visite
    if (req.headers.has('x-vercel-protection-bypass') || req.headers.has('authorization')) throw new Refus('réservé à la page du QG', 403);
    const corps = await lireJson(req);
    if (corps.vu !== true) throw new Refus('« vu: true » attendu');
    const jusqua = typeof corps.jusqua === 'number' ? corps.jusqua : undefined;
    await marquerVisite(getKV().kv, Date.now(), jusqua);
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
