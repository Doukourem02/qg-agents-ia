import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur } from '@/server/auth';
import { vuesQG } from '@/server/vues';

// Les onglets Tâches, Calendrier et Cerveau : seulement des données réelles, jamais de secret.
// Derrière la protection Vercel du déploiement, comme /api/l ; jamais lu depuis /demo.
export async function GET() {
  await connection();
  try {
    return Response.json(await vuesQG(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
