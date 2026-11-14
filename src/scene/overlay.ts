// Les étiquettes (noms, bulles, pièces) vivent dans un seul calque HTML au-dessus de la scène 3D.
// La scène calcule à chaque image où tombe chaque point à l'écran et déplace l'élément correspondant.

const els = new Map<string, HTMLElement>();

/** À utiliser comme `ref` : enregistre l'élément sous une clé, le retire au démontage. */
export const anchor = (key: string) => (el: HTMLElement | null) => {
  if (el) els.set(key, el);
  else els.delete(key);
};

export function place(key: string, x: number, y: number, visible = true) {
  const el = els.get(key);
  if (!el) return;
  el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  el.style.visibility = visible ? 'visible' : 'hidden';
}

/** La taille (non agrandie) du contenu d'un élément du calque : 0 × 0 s'il est vide. */
export function taille(key: string): { w: number; h: number } {
  const el = els.get(key)?.firstElementChild as HTMLElement | null | undefined;
  return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 };
}
