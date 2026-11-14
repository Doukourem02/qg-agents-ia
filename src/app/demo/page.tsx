import type { Metadata } from 'next';
import QGLoader from '@/ui/QGLoader';

export const metadata: Metadata = { title: 'QG' };

// Le mode démo, pour filmer : données fictives, bulles visibles, bureau plus animé.
// Options dans l'adresse : ?moment=pleine (pleine journée), ?visite=1 (la caméra passe de pièce en pièce) et
// ?heure=17:20 (la lumière, les ombres et l'horloge à cette heure ; sans elle, 15:00, plein jour ; la page privée suit
// toujours l'heure réelle) ; ?jour=samedi (ou dimanche…) pour voir le week-end.
export default function Demo() {
  return <QGLoader demo />;
}
