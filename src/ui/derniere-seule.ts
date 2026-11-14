/**
 * Un compteur de requêtes : `prendre()` donne à chaque requête une fonction qui dit si elle est encore la plus récente.
 * Une réponse plus ancienne (lecture périodique ou clic précédent) n'écrase jamais un état plus frais.
 */
export function derniereSeule() {
  let n = 0;
  return {
    prendre() {
      const moi = ++n;
      return () => moi === n;
    },
  };
}
