import { getKV } from '@/server/kv';
import { lireJson, reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { choisirSujet } from '@/server/l/posts';

// Le choix d'un des trois sujets depuis la page : { propositionId, index }.
export async function POST(req: Request) {
  try {
    const { propositionId, index } = await lireJson(req);
    if (typeof propositionId !== 'string' || !propositionId.trim()) throw new Refus('« propositionId » manquant');
    if (index !== 0 && index !== 1 && index !== 2) throw new Refus('« index » doit valoir 0, 1 ou 2');
    return Response.json({ proposition: await choisirSujet(getKV().kv, propositionId, index) });
  } catch (e) {
    return reponseErreur(e);
  }
}
