// Une durée en mots, partagée par le serveur (Luffy, réunions de crise) et la page. Fonction pure.

const MIN = 60_000;

/** « 25 min », « 2 h 10 », « 3 j 4 h » (jamais moins d'une minute). */
export function duree(ms: number): string {
  const total = Math.max(1, Math.round(ms / MIN)); // minutes entières d'abord, puis découpage
  if (total < 60) return `${total} min`;
  if (total < 24 * 60) {
    const h = Math.floor(total / 60), m = total % 60;
    return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
  }
  const j = Math.floor(total / (24 * 60)), h = Math.round((total % (24 * 60)) / 60);
  return h === 0 ? `${j} j` : h === 24 ? `${j + 1} j` : `${j} j ${h} h`;
}
