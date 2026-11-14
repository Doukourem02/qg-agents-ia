// Ce que Feu ne dit jamais, partagé par l'analyse de la routine et les réponses de mission (code pur).

/**
 * Hors périmètre : jamais proposés (expliqués seulement si le patron le demande). Une actualité peut les nommer comme
 * cause (« des liquidations de positions à levier ») ; une phrase qui les suggère est refusée.
 */
export const HORS_PERIMETRE = /(?<!\p{L})(futures?|perp(?:etuel)?s?|levier|leverage|effet de levier|margin|trading sur marge|compte (?:sur|de) marge|copy[- ]?trad\w*|bots? de trading|trading bots?|robots? de trading|memecoins?|meme ?coins?|airdrops?|nft|defi)(?!\p{L})/iu;
/** Pousser à agir, à déposer plus, à se refaire : refusé. */
export const PRESSION = /(?<!\p{L})(d[ée]pose[rsz]? (?:plus|encore|davantage)|ajoute[rsz]? des fonds|recharge[rsz]?|rattrape[rsz]? (?:ta|tes|la) perte|fonce[rsz]?|maintenant ou jamais|ne (?:le )?rate pas|derni[èe]re chance|ach[eè]te[rsz]? (?:maintenant|vite|tout de suite))(?!\p{L})/iu;
/** Une prédiction présentée comme certaine. */
export const CERTITUDE = /(?<!\p{L})(va (?:forcément|certainement|sûrement|obligatoirement)|c['’]est s[ûu]r|garanti[es]?|à coup s[ûu]r|sans risque|ne peut que (?:monter|baisser))(?!\p{L})/iu;
/** Ce que toute réponse de Feu respecte, même hors analyse (missions) : jamais de pression, jamais de certitude. */
export const refusFeu = (t: string): string | null => (PRESSION.test(t) ? 'Feu ne pousse jamais à agir, à déposer plus ni à se refaire' : CERTITUDE.test(t) ? 'Feu ne présente jamais une prédiction comme certaine' : null);
/** Une suggestion (« tu pourrais », « utilise », « avec un levier », « x3 ») : avec un mot hors périmètre, c'est une proposition. */
export const SUGGESTION = /(?<!\p{L})(utilise[rz]?|prends?|prendre|ouvre[rz]?|ouvrir|essaie[rz]?|essayer|tente[rz]?|passe[rz]? (?:sur|en|par)|profite[rz]?|pourrais|pourriez|devrais|devriez|conseill\p{L}*|recommand\p{L}*|propos\p{L}*|avec (?:un|du|de l['’]) ?(?:levier|effet)|x ?\d+)(?!\p{L})/iu;
/** Une proposition hors périmètre : dans une phrase qui suggère, ou n'importe où dans une rubrique d'action. */
export function proposeHorsPerimetre(t: string, action = false): boolean {
  return t.split(/(?<=[.!?;])\s+|\n+/).some(p => HORS_PERIMETRE.test(p) && (action || SUGGESTION.test(p)));
}
