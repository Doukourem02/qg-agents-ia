import type { KV } from '../memoire';
import { Refus } from '../qg';

// La mémoire de L : règles apprises, autorisations par projet, posts déjà publiés.
// Tout est stocké en JSON dans les champs du hash `l:memoire`.

export type Visibilite = 'nomme' | 'anonyme' | 'jamais';
export type Publie = { id: string; sujet: string; quand: number };
export type MemoireL = { regles: string[]; autorisations: Record<string, Visibilite>; publies: Publie[] };

export const CLE_MEMOIRE_L = 'l:memoire';
// Projets et expériences du CV (spec § 7) : seul le QG est nommé par défaut ; Huawei, Arnio et Nugo, seulement avec accord.
export const CATALOGUE_PROJETS = [
  'livreo', 'terra', 'boutique stores', 'studio deco', 'solidar', 'app_pro', 'proweb', 'bottrading', 'qg',
  'huawei', 'arnio', 'nugo',
];

const MAX_REGLE = 200;
const MAX_REGLES = 100;

/** Minuscules, sans accents, espaces nettoyés. */
const normaliser = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

function lireJson<T>(brut: string | undefined, defaut: T): T {
  if (!brut) return defaut;
  try { return JSON.parse(brut) as T; } catch { return defaut; }
}

export async function lireMemoire(kv: KV): Promise<MemoireL> {
  const h = await kv.hgetall(CLE_MEMOIRE_L);
  return {
    regles: lireJson<string[]>(h.regles, []),
    autorisations: { qg: 'nomme', ...lireJson<Record<string, Visibilite>>(h.autorisations, {}) },
    publies: lireJson<Publie[]>(h.publies, []),
  };
}

export async function ajouterRegle(kv: KV, regle: string): Promise<void> {
  const t = typeof regle === 'string' ? regle.trim() : '';
  if (!t) throw new Refus('« regle » manquant');
  if (t.length > MAX_REGLE) throw new Refus(`« regle » trop long (${MAX_REGLE} caractères au plus)`);
  const { regles } = await lireMemoire(kv);
  if (regles.includes(t)) return;
  const suite = [...regles, t].slice(-MAX_REGLES);
  await kv.hset(CLE_MEMOIRE_L, 'regles', JSON.stringify(suite));
}

/** Remplace une leçon de L (par son texte exact) ; si la nouvelle existe déjà, l'ancienne est seulement retirée. */
export async function modifierRegle(kv: KV, ancienne: string, regle: string): Promise<string[]> {
  const t = typeof regle === 'string' ? regle.trim() : '';
  if (!t) throw new Refus('« regle » manquant');
  if (t.length > MAX_REGLE) throw new Refus(`« regle » trop long (${MAX_REGLE} caractères au plus)`);
  const { regles } = await lireMemoire(kv);
  const i = typeof ancienne === 'string' ? regles.indexOf(ancienne) : -1;
  if (i < 0) throw new Refus('règle inconnue', 404);
  const suite = regles.includes(t) && regles[i] !== t ? regles.filter((_, j) => j !== i) : regles.map((r, j) => (j === i ? t : r));
  await kv.hset(CLE_MEMOIRE_L, 'regles', JSON.stringify(suite));
  return suite;
}

/** Retire une leçon de L (par son texte exact). */
export async function retirerRegle(kv: KV, regle: string): Promise<string[]> {
  const { regles } = await lireMemoire(kv);
  if (typeof regle !== 'string' || !regles.includes(regle)) throw new Refus('règle inconnue', 404);
  const suite = regles.filter(r => r !== regle);
  await kv.hset(CLE_MEMOIRE_L, 'regles', JSON.stringify(suite));
  return suite;
}

export async function autoriser(kv: KV, projet: string, v: Visibilite): Promise<void> {
  if (!['nomme', 'anonyme', 'jamais'].includes(v)) throw new Refus('visibilité inconnue');
  const nom = normaliser(typeof projet === 'string' ? projet : '');
  if (!nom) throw new Refus('« projet » manquant');
  const { autorisations } = await lireMemoire(kv);
  await kv.hset(CLE_MEMOIRE_L, 'autorisations', JSON.stringify({ ...autorisations, [nom]: v }));
}

export async function noterPublie(kv: KV, p: Publie): Promise<void> {
  const { publies } = await lireMemoire(kv);
  if (publies.some(x => x.id === p.id)) return;
  await kv.hset(CLE_MEMOIRE_L, 'publies', JSON.stringify([...publies, p]));
}

const echapper = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Forme compacte : sans espaces, « _ » ni « - » (« Boutique Stores » → « boutiquestores »). */
const compacte = (t: string) => normaliser(t).replace(/[\s_-]+/g, '');

/** Le projet est-il cité ? Toujours avec des frontières de mot ; les noms en plusieurs mots acceptent aussi
 *  leurs parties collées ou reliées (#BoutiqueStores, boutique-stores) ; un nom long d'un seul mot (6 lettres
 *  ou plus) est aussi reconnu en début de mot collé (#SOLIDARCI). Les noms courts restent stricts. */
function cite(t: string, nom: string): boolean {
  const n = normaliser(nom);
  const parties = n.split(/[\s_-]+/).filter(Boolean);
  if (new RegExp(`(^|[^a-z0-9])${echapper(n)}($|[^a-z0-9])`).test(t)) return true;
  // Un nom écrit avec des espaces (« boutique stores ») accepte espaces, « _ », « - » ou rien entre ses parties ;
  // un identifiant (« app_pro ») seulement « _ » ou rien, pour ne pas refuser la phrase « a app pro ».
  const lien = /\s/.test(n) ? '[\\s_-]*' : '_?';
  if (parties.length > 1) return new RegExp(`(^|[^a-z0-9])${parties.map(echapper).join(lien)}($|[^a-z0-9])`).test(t);
  return n.length >= 6 && new RegExp(`(^|[^a-z0-9])${echapper(n)}`).test(t);
}

/** Projets du catalogue cités dans le texte dont la visibilité n'est pas « nomme » (défaut : anonyme).
 *  L'autorisation est cherchée sous la forme compacte des deux côtés. */
export function projetsInterdits(m: MemoireL, texte: string, catalogue: string[]): string[] {
  const t = normaliser(texte);
  const visibilite = (nom: string) => {
    const c = compacte(nom);
    const cle = Object.keys(m.autorisations).find(k => compacte(k) === c);
    return cle ? m.autorisations[cle] : 'anonyme';
  };
  return catalogue.filter(p => cite(t, p) && visibilite(p) !== 'nomme');
}
