'use client';
import { quandCourt } from '@/data/journal';
import type { VueIgnore, VueSilence } from '@/data/silence';

// Ce que j'ai dit d'ignorer sur Telegram (« ignore Livreo ») et la pause des alertes, montrés dans la page : dans les
// Tâches, le Cerveau et le bureau de l'agent concerné. Rien n'est caché : un problème ignoré reste visible ici, avec
// depuis quand, et ce qu'il faut écrire pour le reprendre. Lu dans /api/qg/vues (jamais dans /demo).

const BLEU = '#2d3a66';

/** « API Livreo · ignoré par toi depuis aujourd'hui à 14:40 · « reprends Livreo » » */
export function LigneIgnore({ i, now }: { i: VueIgnore; now: number }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-[6px] rounded-[6px] bg-[#f4f4f8] px-[7px] py-[3px] text-[8px] leading-snug text-[#4a475c]">
      <b className="text-[#1d1b2e]">{i.libelle}</b>
      <span>ignoré par toi depuis {quandCourt(i.depuis, now)}</span>
      <span className="ml-auto text-[7.5px] text-[#8a879c]">Telegram : « reprends {i.reprendre} »</span>
    </li>
  );
}

export function ListeIgnores({ ignores, now }: { ignores: VueIgnore[]; now: number }) {
  if (!ignores.length) return null;
  return <ul className="space-y-[3px]">{ignores.map(i => <LigneIgnore key={i.groupe} i={i} now={now} />)}</ul>;
}

/** « Alertes en pause jusqu'à demain à 08:00 » ; rien sans pause. */
export function BandeauPause({ silence, now }: { silence: VueSilence | undefined; now: number }) {
  if (!silence?.pause) return null;
  return (
    <p className="rounded-[8px] bg-[#eef0fa] px-[8px] py-[5px] text-[8.5px] leading-snug" style={{ color: BLEU }}>
      <b>Alertes en pause jusqu’à {quandCourt(silence.pause, now).replace(/^aujourd’hui à /, '')}</b>
      {' '}· les questions qui attendent ta réponse et le compte rendu du matin passent quand même · Telegram : « reprends les alertes »
    </p>
  );
}
