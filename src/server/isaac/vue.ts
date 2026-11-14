import type { KV } from '../memoire';
import { CLES } from '../qg';
import { CLES_ISAAC, JOURS_VALIDITE, type Proposition } from './api';

// Ce que la page affiche pour Isaac. Aucun détail technique : jamais `cibles`, jamais un chemin (ni l'id d'une proposition).

export type VueIsaac = {
  /** Le Mac a donné signe depuis moins de 15 min ; `vu` = dernier passage du relais (null : jamais). */
  mac: { enLigne: boolean; vu: number | null };
  /** La dernière mesure (octets) ; `total` peut manquer (le relais ne le renvoie pas après un nettoyage). */
  place: { libre: number; total?: number; quand: number } | null;
  /** Les propositions qui attendent mon Oui ou mon Non (plus récentes d'abord). */
  propositions: { libelle: string; taille: number; impact: string; quand: number; expiree?: true }[];
  /** Ce qui a été libéré ces 30 derniers jours. */
  liberes: { total: number; liste: { libelle: string; libere: number; quand: number }[] };
  /** Ce que le Mac a refusé de supprimer (7 derniers jours) ; `raison` seulement si c'est une phrase sans chemin. */
  refusees: { libelle: string; quand: number; raison?: string }[];
  /** Les missions déposées que le relais n'a pas encore prises. */
  missionsEnAttente: number;
};

const MIN = 60_000, JOUR = 86_400_000;
/** Le relais passe toutes les 5 min (a-faire) : 15 min sans signe, le Mac est éteint. */
export const MAC_ETEINT_MS = 15 * MIN;
const GO = 1024 ** 3;
/** Octets → Go entiers (« 26 Go »). */
export const goEntier = (octets: number) => Math.round(octets / GO);

function lire<T>(brut: string | undefined): T | undefined {
  if (!brut) return undefined;
  try { return JSON.parse(brut) as T; } catch { return undefined; }
}
const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

export async function vueIsaac(kv: KV, now = Date.now()): Promise<VueIsaac> {
  const [placeBrute, vuBrut, brutes, missions] = await Promise.all([
    kv.hgetall(CLES_ISAAC.place), kv.hgetall(CLES_ISAAC.vu), kv.hgetall(CLES_ISAAC.propositions), kv.lrange(CLES.missions('isaac'), 0, -1),
  ]);
  const t = Number(vuBrut.relais);
  const vu = vuBrut.relais && Number.isFinite(t) ? t : null;
  const mesure = lire<{ libre?: unknown; total?: unknown; quand?: unknown }>(placeBrute.mesure);
  const libre = nombre(mesure?.libre), quandMesure = nombre(mesure?.quand), total = nombre(mesure?.total);
  const place = libre !== undefined && quandMesure !== undefined ? { libre, ...(total !== undefined && total >= libre ? { total } : {}), quand: quandMesure } : null;

  const toutes = Object.values(brutes).flatMap(v => { const p = lire<Proposition>(v); return p && typeof p.libelle === 'string' && typeof p.quand === 'number' ? [p] : []; });
  const propositions = toutes.filter(p => p.statut === 'proposee')
    .sort((a, b) => b.quand - a.quand)
    .map(p => ({
      libelle: p.libelle, taille: nombre(p.taille) ?? 0, impact: typeof p.impact === 'string' ? p.impact : '', quand: p.quand,
      // plus de 7 jours : un Oui ne sera plus exécuté (Isaac en refera une à jour)
      ...(now - p.quand > JOURS_VALIDITE * JOUR ? { expiree: true as const } : {}),
    }));
  const fin = (p: Proposition) => nombre(p.faite) ?? p.decide ?? p.quand;
  const liste = toutes.filter(p => p.statut === 'faite' && nombre(p.libere) !== undefined && now - fin(p) < 30 * JOUR)
    .map(p => ({ libelle: p.libelle, libere: p.libere as number, quand: fin(p) }))
    .sort((a, b) => b.quand - a.quand);
  const refusees = toutes.filter(p => p.statut === 'refusee-mac' && now - fin(p) < 7 * JOUR)
    .sort((a, b) => fin(b) - fin(a))
    .map(p => ({
      libelle: p.libelle, quand: fin(p),
      // une phrase du Mac : montrée seulement si elle ne contient aucun chemin
      ...(typeof p.raison === 'string' && p.raison.trim() && !/[/\\~]/.test(p.raison) ? { raison: p.raison.trim() } : {}),
    }));
  return {
    mac: { enLigne: vu !== null && now - vu < MAC_ETEINT_MS, vu },
    place, propositions,
    liberes: { total: liste.reduce((s, x) => s + x.libere, 0), liste },
    refusees,
    missionsEnAttente: missions.length,
  };
}
