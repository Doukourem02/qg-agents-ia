// Ce que la page et le serveur partagent pour Feu : aucun import de valeur serveur (la page n'embarque aucun code serveur).
import type { VueFeu } from './vue';

export type { VueFeu };

/**
 * Mise en service de Feu (planification QStash de la lecture du marché, routine « Feu · marché » activée après un essai
 * réel) : fixé à la mise en service. D'ici là, ses créneaux du Calendrier sont « pas encore actifs » et il n'est jamais
 * « bloqué ».
 */
export const ACTIVATION_FEU: number = Number.POSITIVE_INFINITY; // fixé à la mise en service
export const feuEnService = (now: number) => now >= ACTIVATION_FEU;
/** Feu lit le marché toutes les 15 min : sans lecture depuis 35 min, il ne lit plus. */
export const FEU_VEILLE_MS = 35 * 60_000;

/** La phrase de Feu dans le Cerveau et le compte rendu du matin : « BTC et ETH en Hypothèse, on attend ; PPI à 13:30 ». */
export function phraseFeu(v: VueFeu | null, now: number): string {
  if (!v?.passage?.statuts.length) return 'Pas encore de lecture du marché.';
  const st = v.passage.statuts;
  const nom = (p: string) => p.replace(/USDT$/, '');
  const memes = st.every(s => s.statut === st[0].statut);
  const statuts = memes
    ? `${st.map(s => nom(s.paire)).join(' et ')} en ${st[0].statut}`
    : st.map(s => `${nom(s.paire)} en ${s.statut}`).join(', ');
  const signal = st.some(s => s.statut === 'Signal');
  const annonce = v.annonces.find(a => !a.aConfirmer && a.quand > now && a.quand - now < 36 * 3_600_000);
  const quand = annonce ? `${new Date(annonce.quand).toISOString().slice(11, 16)}${new Date(annonce.quand).toISOString().slice(0, 10) !== new Date(now).toISOString().slice(0, 10) ? ' demain' : ''}` : '';
  return `${statuts}${signal ? ' : un plan d\'ordres t\'attend sur Telegram' : ', on attend'}${annonce ? ` ; ${annonce.nom} à ${quand}` : ''}${v.pause ? ` ; pause : ${v.pause.raison}` : ''}.`;
}
