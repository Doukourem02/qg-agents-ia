// Paul : tout texte qui part ou qui arrive passe ici. Le repérage des clés de Léa (formes connues, clés privées),
// plus les secrets génériques d'un texte libre (affectations `…_KEY=valeur`, adresses avec mot de passe).
import { contientSecretGenerique, masquerSecretsGeneriques } from '../lea/cles';
import { masquerTexte, repererTexte } from '../lea/rapport';

/** Le texte avec chaque secret reconnu masqué (même nombre de lignes). */
export const masquerPaul = (texte: string): string => masquerSecretsGeneriques(masquerTexte(texte));

/** Vrai si le texte contient un secret reconnu (clé connue, clé privée, affectation à vraie valeur, adresse avec mot de passe). */
export const contientSecret = (texte: string): boolean => repererTexte(texte).length > 0 || contientSecretGenerique(texte);

/** Un masque posé par le QG (« [clé GitHub masquée] », « [secret masqué] »…). */
export const MASQUE = /\[[^\]\n]{1,40} masquée?\]/g;
