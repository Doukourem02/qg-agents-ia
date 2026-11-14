import { getKV } from '@/server/kv';
import { reponseErreur, verifierAgent } from '@/server/auth';
import { MAX_CONNAISSANCES, enregistrerConnaissances } from '@/server/connaissances';
import { Refus } from '@/server/qg';

// La routine hebdomadaire de Kuroro (scripts/connaissances.mjs envoyer) : ce qu'il sait du projet et des personnages,
// reconstruit depuis Notion. Exige la preuve d'agent ; le corps a la forme de src/data/connaissances.json.
export async function POST(req: Request) {
  try {
    verifierAgent(req);
    const brut = await req.text();
    // une marge pour les espaces : la taille réelle est vérifiée après nettoyage
    if (brut.length > MAX_CONNAISSANCES * 2) throw new Refus(`trop long (${MAX_CONNAISSANCES} caractères au plus)`, 413);
    let corps: unknown;
    try { corps = JSON.parse(brut); } catch { throw new Refus('corps JSON attendu'); }
    return Response.json(await enregistrerConnaissances(getKV().kv, corps));
  } catch (e) {
    return reponseErreur(e);
  }
}
