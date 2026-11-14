'use client';
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';

// Les menus de la page se déplacent à la souris : on attrape un menu n'importe où (sauf dans un champ de texte)
// et on le pose ailleurs. Un petit seuil distingue un clic d'un glissé, pour que les boutons marchent toujours.
// La place de chaque menu est retenue dans ce navigateur ; « Remettre les menus en place » efface tout.

export type Decalage = { x: number; y: number };

const CLE = 'qg:menus';
const SEUIL = 4; // pixels d'écran avant de considérer que c'est un glissé
const RESET = 'qg-menus-reset';

function lireTout(): Record<string, Decalage> {
  try { return JSON.parse(localStorage.getItem(CLE) ?? '{}'); } catch { return {}; }
}
function ecrire(id: string, d: Decalage) {
  try { localStorage.setItem(CLE, JSON.stringify({ ...lireTout(), [id]: d })); } catch { /* stockage indisponible : la place n'est pas retenue */ }
}

/** Remet tous les menus à leur place d'origine. */
export function remettreLesMenus() {
  try { localStorage.removeItem(CLE); } catch { /* rien */ }
  window.dispatchEvent(new Event(RESET));
}

/**
 * Le décalage permis pour que le menu reste visible : au moins `marge` pixels du menu dans la fenêtre.
 * `rect` est la place du menu sans décalage, en pixels d'écran ; le décalage est en points d'interface (÷ échelle).
 */
export function borner(d: Decalage, rect: { left: number; top: number; width: number; height: number },
  fenetre: { w: number; h: number }, echelle: number, marge = 40): Decalage {
  const minX = (marge - rect.left - rect.width) / echelle, maxX = (fenetre.w - marge - rect.left) / echelle;
  const minY = (-rect.top) / echelle, maxY = (fenetre.h - marge - rect.top) / echelle;
  return { x: Math.min(maxX, Math.max(minX, d.x)), y: Math.min(maxY, Math.max(minY, d.y)) };
}

const echelle = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;

/** Rend un menu déplaçable. `actif` à faux (format téléphone) : le menu reste à sa place prévue. */
export function useDeplacable(id: string, actif: boolean) {
  const [d, setD] = useState<Decalage>({ x: 0, y: 0 });
  const [glisse, setGlisse] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // lecture après le premier rendu : le serveur ne connaît pas la place retenue
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setD(lireTout()[id] ?? { x: 0, y: 0 });
    const reset = () => setD({ x: 0, y: 0 });
    window.addEventListener(RESET, reset);
    return () => window.removeEventListener(RESET, reset);
  }, [id]);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!actif || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const s = echelle();
    const depart = { x: e.clientX, y: e.clientY }, d0 = d;
    const r = el.getBoundingClientRect();
    // la place du menu sans décalage, pour le garder dans la fenêtre
    const base = { left: r.left - d0.x * s, top: r.top - d0.y * s, width: r.width, height: r.height };
    let parti = false, dernier = d0;
    const bouge = (ev: PointerEvent) => {
      const dx = ev.clientX - depart.x, dy = ev.clientY - depart.y;
      if (!parti && Math.hypot(dx, dy) < SEUIL) return;
      if (!parti) { parti = true; setGlisse(true); }
      dernier = borner({ x: d0.x + dx / s, y: d0.y + dy / s }, base, { w: window.innerWidth, h: window.innerHeight }, s);
      setD(dernier);
    };
    const fin = () => {
      window.removeEventListener('pointermove', bouge);
      window.removeEventListener('pointerup', fin);
      window.removeEventListener('pointercancel', fin);
      if (!parti) return;
      setGlisse(false);
      ecrire(id, dernier);
      // le relâché d'un glissé ne doit pas compter comme un clic sur le bouton dessous
      const mange = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', mange, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', mange, { capture: true }), 0);
    };
    window.addEventListener('pointermove', bouge);
    window.addEventListener('pointerup', fin);
    window.addEventListener('pointercancel', fin);
  };

  const decale = actif && (d.x !== 0 || d.y !== 0);
  return {
    ref,
    onPointerDown,
    style: decale ? { transform: `translate(${d.x}px, ${d.y}px)` } : undefined,
    classe: actif ? (glisse ? 'qg-glisse' : 'qg-deplacable') : '',
  };
}
