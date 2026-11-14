'use client';
import { useQG } from '@/store';
import { useDeplacable } from './deplacable';

/** Un menu posé sur la scène ; avec un `id`, il se déplace à la souris (format large seulement). */
export function Panel({ id, className = '', style: place, children }: { id?: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const large = useQG(s => s.format === 'large');
  const { ref, onPointerDown, style, classe } = useDeplacable(id ?? '', !!id && large);
  return <div ref={ref} data-panel={id} onPointerDown={onPointerDown} style={{ ...place, ...style }} className={`qg-panel absolute ${classe} ${className}`}>{children}</div>;
}
