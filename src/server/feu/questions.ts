// Les questions du patron à Feu (Telegram, barre de mission) : reconnues par le code (mots du trading), et répondues
// tout de suite par le code quand elles portent sur ce que le QG sait déjà (solde, statut d'une paire, ce qui manque,
// prix lu, prochaine annonce, niveaux). Sinon, une mission pour Feu, faite dans l'heure par « QG · missions ».
// Jamais le modèle pour un chiffre : chaque prix vient du dernier passage, avec son heure de lecture.
import type { KV } from '../memoire';
import { deposerMission } from '../qg';
import { norme } from '@/data/silence';
import { phraseDelai } from '@/data/missions';
import { soldes } from './compte';
import { lireCompte, lireEtatSeul, lirePassageFeu } from './etat';
import { hhmm, jourHeure, nomPaire, prixFr, usdt } from './indicateurs';
import { ligneStatut, TETE } from './messages';
import { situation, reprendreFeu, ignorerSujet } from './passage';
import { PAIRES, type Paire } from './types';

const MIN = 60_000;
/** Les mots qui font d'un message une question pour Feu. */
const MOTS_FEU = /\b(trading|trade[rsz]?|trader|binance|crypto\w*|btc|eth|bitcoin|ethereum|usdt|feu)\b/;
/** « Pourquoi », « explique », « c'est quoi » : une explication, faite par la routine (jamais un chiffre inventé). */
const EXPLICATION = /^(pourquoi|comment|explique|c est quoi|qu est ce|que veut dire|que signifie|est ce que je devrais|tu penses|ton avis)\b/;

export const estQuestionFeu = (texte: string) => MOTS_FEU.test(norme(texte));

const INTENTIONS: [string, RegExp][] = [
  ['solde', /\b(solde|capital|argent|fonds|combien j ai|mes usdt|earn|portefeuille|wallet)\b/],
  ['statut', /\b(statut|signal|acheter|achete|achat|on attend|manque|surveillance|hypothese|opportunite|on peut|je peux|plan)\b/],
  ['annonce', /\b(annonces?|cpi|ppi|nfp|fomc|fed|macro|calendrier|inflation)\b/],
  ['niveaux', /\b(niveaux?|supports?|resistances?|alertes?|zones?|jalons?)\b/],
  ['prix', /\b(prix|cours|combien vaut|a combien|ou en est)\b/],
];

/** La paire nommée dans le message, ou les deux. */
function pairesDe(t: string): Paire[] {
  const btc = /\b(btc|bitcoin)\b/.test(t), eth = /\b(eth|ethereum)\b/.test(t);
  return btc && !eth ? ['BTCUSDT'] : eth && !btc ? ['ETHUSDT'] : [...PAIRES];
}

/** La réponse du code, ou null (une explication, ou rien que le code sache : une mission). */
export async function reponseCode(kv: KV, texte: string, now: number): Promise<string | null> {
  const t = norme(texte);
  if (EXPLICATION.test(t)) return null;
  const voulu = INTENTIONS.filter(([, r]) => r.test(t)).map(([k]) => k);
  if (!voulu.length) return null;
  const [etat, passage, compte] = await Promise.all([lireEtatSeul(kv), lirePassageFeu(kv), lireCompte(kv)]);
  const paires = pairesDe(t);
  const lignes: string[] = [];
  const statuts = (passage?.statuts ?? []).filter(s => paires.includes(s.paire));
  const vieux = passage && now - passage.quand > 30 * MIN ? ` (dernière lecture il y a ${Math.round((now - passage.quand) / MIN)} min : le marché a bougé depuis)` : '';
  const prix = Object.fromEntries((passage?.statuts ?? []).map(s => [s.paire, s.prix]));

  if (voulu.includes('solde')) {
    if (!compte || compte.cle === 'absente') lignes.push(`Je ne vois pas encore ton solde : la clé Binance en lecture seule n'est pas créée. Les calculs partent des ${usdt(etat?.capitalDeclare.montant ?? 8.5)} que tu as déclarés.${etat?.points[0] ? ` À éclaircir : ${etat.points[0]}` : ''}`);
    else if (compte.cle === 'droits') lignes.push('Ta clé Binance a des droits en trop : je refuse de m\'en servir, je ne lis rien. Recrée-la en lecture seule.');
    else if (compte.cle === 'erreur') lignes.push('Je n\'ai pas pu lire ton compte au dernier passage du Mac.');
    else {
      const s = soldes(compte, prix);
      lignes.push(`Solde vu à ${hhmm(compte.quand)} UTC : Spot ${usdt(s.spotUsdt)}, Simple Earn ${usdt(s.earnUsdt)}${s.crypto > 0 ? `, BTC/ETH ${usdt(s.crypto)}` : ''} ; total ${usdt(s.total)}.`);
    }
  }
  if (voulu.includes('statut') || voulu.includes('prix')) {
    if (!statuts.length) lignes.push('Je n\'ai pas encore lu le marché : rien à dire sans prix frais.');
    for (const s of statuts) {
      lignes.push(voulu.includes('statut')
        ? `${nomPaire(s.paire)} (prix lu ${prixFr(s.prix)} à ${hhmm(s.lu)} UTC${vieux}) : ${ligneStatut(s)}`
        : `${nomPaire(s.paire)} : ${prixFr(s.prix)}, lu à ${hhmm(s.lu)} UTC${vieux}.`);
    }
    if (voulu.includes('statut') && etat && passage) {
      const sit = situation(etat, compte, prix, now);
      lignes.push(`Régime ${sit.regime} (${usdt(sit.capital.montant)} ${sit.capital.source === 'compte' ? 'lus sur ton compte' : 'déclarés'}).${sit.interdit ? ` Aucune entrée maintenant : ${sit.interdit}.` : ''}`);
    }
  }
  if (voulu.includes('annonce')) {
    const a = (etat?.annonces ?? []).filter(x => x.quand >= now - 60 * MIN).slice(0, 3);
    lignes.push(a.length ? `Prochaines annonces : ${a.map(x => `${x.nom} ${x.aConfirmer ? `le ${new Date(x.quand).toISOString().slice(8, 10)}/${new Date(x.quand).toISOString().slice(5, 7)}` : `${jourHeure(x.quand)} UTC (pas d'entrée de ${hhmm(x.quand - 60 * MIN)} à ${hhmm(x.quand + 60 * MIN)})`}`).join(' ; ')}.` : 'Aucune annonce connue dans mon calendrier.');
  }
  if (voulu.includes('niveaux') && etat) {
    for (const p of paires) {
      const n = etat.niveaux[p];
      lignes.push(`${nomPaire(p)} : support ${n.supports.map(z => `${prixFr(z.bas)}–${prixFr(z.haut)}`).join(', ') || 'aucun'} ; résistances ${n.resistances.map(z => (z.bas === z.haut ? prixFr(z.bas) : `${prixFr(z.bas)}–${prixFr(z.haut)}`)).join(', ')} ; je préviens à la clôture 1h ${n.surveilles.map(x => `${x.sens === 'haut' ? 'au-dessus de' : 'sous'} ${prixFr(x.prix)}`).join(', ')}.`);
    }
  }
  return lignes.length ? lignes.join('\n') : null;
}

/** Ce que le patron lit : la réponse du code, ou la mission déposée pour Feu et sa vraie suite. */
export async function repondreQuestion(kv: KV, texte: string, now: number): Promise<{ texte: string; mission?: { agent: 'feu'; nom: 'Feu' } }> {
  const r = await reponseCode(kv, texte, now);
  if (r) return { texte: `${TETE} · ${r}` };
  await deposerMission(kv, { texte: texte.slice(0, 300), agent: 'feu' }, now);
  return { texte: `${TETE} a ta question. ${phraseDelai('Il', now)}`, mission: { agent: 'feu', nom: 'Feu' } };
}

/** « ignore Feu », « ignore BTC » (alertes de niveau) ; « reprends Feu ». null : ce n'est pas pour Feu. */
export async function commandeFeu(kv: KV, type: 'ignorer' | 'reprendre', texte: string, now: number): Promise<string | null> {
  const t = norme(texte);
  if (!/\b(feu|btc|eth|bitcoin|ethereum|trading)\b/.test(t)) return null;
  if (type === 'reprendre') {
    const n = await reprendreFeu(kv);
    return n ? 'C\'est reparti : Feu te reparle de ses alertes de niveaux et d\'annonces.' : 'Feu n\'ignorait rien.';
  }
  const paires = pairesDe(t);
  for (const p of paires) await ignorerSujet(kv, `paire:${p}`, now);
  return `D'accord : plus d'alerte de niveau sur ${paires.map(nomPaire).join(' et ')} pendant 24 h, ou jusqu'à ce que le statut change. Un Signal te sera toujours envoyé. Écris « reprends Feu » pour annuler.`;
}
