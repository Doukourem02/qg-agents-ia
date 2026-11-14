import type { KV } from '../memoire';
import { CLES_LUFFY, duree, type EtatSite, type Panne } from './vigie';
import { SITES } from './sites';

// Ce que la page affiche pour Luffy. Aucun détail technique : jamais la raison d'une panne (code, adresse).

export type VueLuffy = {
  sites: { id: string; nom: string; enLigne: boolean; depuis?: number }[];
  pannes7j: { nom: string; debut: number; fin?: number; duree: string }[];
  dernier: number | null;
  /** Aucun passage depuis 20 minutes (la vigie passe toutes les 5). */
  endormi: boolean;
};

const MIN = 60_000, JOUR = 86_400_000;
const ENDORMI_MS = 20 * MIN;

function lire<T>(brut: string | undefined): T | undefined {
  if (!brut) return undefined;
  try { return JSON.parse(brut) as T; } catch { return undefined; }
}

export async function vueLuffy(kv: KV, now = Date.now()): Promise<VueLuffy> {
  const [etats, listePannes, dernierBrut] = await Promise.all([
    kv.hgetall(CLES_LUFFY.etat), kv.lrange(CLES_LUFFY.pannes, 0, -1), kv.hgetall(CLES_LUFFY.dernier),
  ]);
  const sites = SITES.map(s => {
    const e = lire<EtatSite>(etats[s.id]);
    // « en panne » seulement quand la panne a été annoncée (2 échecs de suite)
    return e?.annoncee && typeof e.depuis === 'number' ? { id: s.id, nom: s.nom, enLigne: false, depuis: e.depuis } : { id: s.id, nom: s.nom, enLigne: true };
  });
  const pannes7j = listePannes.flatMap(v => {
    const p = lire<Panne>(v);
    if (!p || typeof p.debut !== 'number' || (p.fin ?? now) < now - 7 * JOUR) return [];
    return [{ nom: p.nom, debut: p.debut, ...(p.fin !== undefined ? { fin: p.fin } : {}), duree: duree((p.fin ?? now) - p.debut) }];
  }).sort((a, b) => b.debut - a.debut);
  const t = Number(dernierBrut.quand);
  const dernier = dernierBrut.quand && Number.isFinite(t) ? t : null;
  return { sites, pannes7j, dernier, endormi: dernier === null || now - dernier >= ENDORMI_MS };
}
