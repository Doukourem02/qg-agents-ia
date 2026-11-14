import { lireReponse } from '../accords';
import { entreeVip } from '../clara/actions';
import type { ElementBoite } from './boite';
import type { Recu } from '../telegram';

// Où va chaque chose que j'envoie au bot : accord, choix de sujet, publication, boîte de L, « ignore » et pause des
// alertes (boutons), ou Kuroro : un message libre est une conversation avec lui (ses commandes sont reconnues ensuite,
// par le code : src/server/telegram-commandes.ts). Une note pour L commence par « note : », « idée : » ou « pour L : ».

export type Aiguillage =
  | { vers: 'accord'; texte: string }
  | { vers: 'sujet'; propositionId: string; index: 0 | 1 | 2 }
  | { vers: 'publie'; postId: string }
  | { vers: 'publier'; postId: string; forcer: boolean }
  | { vers: 'boite'; type: ElementBoite['type']; contenu: string }
  | { vers: 'vu-light'; jour: string }
  | { vers: 'clara'; donnee: string }
  /** Le Oui/Non d'Isaac ; l'`id` de la proposition peut contenir des « : » (`cache:cursor`). */
  | { vers: 'isaac'; id: string; oui: boolean }
  /** Le Valider/Refuser de Paul sur une proposition (README.md ou CLAUDE.md d'un projet). */
  | { vers: 'paul'; id: string; valider: boolean }
  /** Ye : Valider/Refuser une fiche (`v`/`r`), Oui/Non à une question de compétence (`o`/`n`). */
  | { vers: 'ye'; id: string; quoi: 'v' | 'r' | 'o' | 'n' | 'a' | 'p' | 'j' }
  /** `entree` : adresse ou `@domaine` normalisé, null si illisible (réponse d'erreur, jamais une note pour L). */
  | { vers: 'clara-vip'; ajout: boolean; entree: string | null }
  | { vers: 'clara-vips'; lignes: { ajout: boolean; entree: string | null }[] }
  /** Le bouton « Ignorer » d'une alerte de Feu (`fei:paire:BTCUSDT`, `fei:macro:<heure>`). */
  | { vers: 'feu-ignorer'; sujet: string }
  /** Les boutons « Ignorer » (`ign:`), « Reprendre » (`rep:`) et la durée d'une pause (`pse:`). */
  | { vers: 'silence'; donnee: string }
  /** Un message libre : une commande reconnue par le code, ou une conversation avec Kuroro. */
  | { vers: 'kuroro'; texte: string }
  | { vers: 'start' }
  | { vers: 'rien' };

export function aiguiller(r: Recu): Aiguillage {
  if (r.type === 'bouton') {
    const [d, ...reste] = r.donnee.split(':');
    if ((d === 'ok' || d === 'non') && reste[0]) return { vers: 'accord', texte: `#${reste[0]} ${d === 'ok' ? 'OK' : 'non'}` };
    if (d === 'sujet' && reste.length === 2 && reste[0] && ['0', '1', '2'].includes(reste[1])) {
      return { vers: 'sujet', propositionId: reste[0], index: Number(reste[1]) as 0 | 1 | 2 };
    }
    if (d === 'publie' && reste[0]) return { vers: 'publie', postId: reste[0] };
    if ((d === 'publier' || d === 'republier') && reste[0]) return { vers: 'publier', postId: reste[0], forcer: d === 'republier' };
    if (d === 'vu-light' && reste[0]) return { vers: 'vu-light', jour: reste[0] };
    if ((d === 'cl1' || d === 'cl2' || d === 'cld') && reste[0]) return { vers: 'clara', donnee: r.donnee };
    if (d === 'isc' && (reste[0] === 'o' || reste[0] === 'n')) {
      const id = reste.slice(1).join(':');
      return id ? { vers: 'isaac', id, oui: reste[0] === 'o' } : { vers: 'rien' };
    }
    if (d === 'ye' && ['v', 'r', 'o', 'n', 'a', 'p', 'j'].includes(reste[0]) && reste.length === 2 && reste[1]) return { vers: 'ye', id: reste[1], quoi: reste[0] as 'v' | 'r' | 'o' | 'n' | 'a' | 'p' | 'j' };
    if (d === 'pau' && (reste[0] === 'v' || reste[0] === 'r') && reste.length === 2 && reste[1]) return { vers: 'paul', id: reste[1], valider: reste[0] === 'v' };
    if ((d === 'ign' || d === 'rep' || d === 'pse') && reste.join(':')) return { vers: 'silence', donnee: r.donnee };
    if (d === 'fei' && reste.join(':')) return { vers: 'feu-ignorer', sujet: reste.join(':') };
    return { vers: 'rien' };
  }
  if (r.type === 'fichier') return { vers: 'boite', type: 'fichier', contenu: `${r.fileId}|${r.nom}` };
  const texte = r.texte.trim();
  if (!texte) return { vers: 'rien' };
  if (/^\/start\b/.test(texte)) return { vers: 'start' };
  // plusieurs « VIP : … » dans un même message, une par ligne
  const lignes = texte.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (lignes.length > 1 && lignes.every(l => /^(plus\s+)?vip\s*:/i.test(l))) {
    return { vers: 'clara-vips', lignes: lignes.map(l => { const m = l.match(/^(plus\s+)?vip\s*:(.*)$/i)!; return { ajout: !m[1], entree: entreeVip(m[2]) }; }) };
  }
  const vip = texte.match(/^(plus\s+)?vip\s*:([\s\S]*)$/i);
  if (vip) return { vers: 'clara-vip', ajout: !vip[1], entree: entreeVip(vip[2]) };
  if (texte.length <= 300 && lireReponse(texte)) return { vers: 'accord', texte };
  if (/https?:\/\/\S+/i.test(texte)) return { vers: 'boite', type: 'lien', contenu: texte };
  const com = texte.match(/^(?:commentaire\b|com\s*:)\s*:?\s*([\s\S]*)$/i);
  if (com && com[1].trim()) return { vers: 'boite', type: 'commentaire', contenu: com[1].trim() };
  const note = texte.match(/^(?:note|id[ée]e|pour l)\s*:\s*([\s\S]*)$/i);
  if (note && note[1].trim()) return { vers: 'boite', type: 'note', contenu: note[1].trim() };
  return { vers: 'kuroro', texte };
}
