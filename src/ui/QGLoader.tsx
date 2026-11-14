'use client';
import dynamic from 'next/dynamic';

// Le QG vit entièrement dans le navigateur (scène 3D, simulation) : pas de rendu côté serveur.
const QGApp = dynamic(() => import('./QGApp'), {
  ssr: false,
  loading: () => <main className="qg-sky h-dvh w-full" />,
});

export default function QGLoader({ demo = false }: { demo?: boolean }) {
  return <QGApp demo={demo} />;
}
