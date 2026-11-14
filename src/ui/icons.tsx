import {
  siClaude, siCursor, siExpo, siGithub, siGmail, siNeon, siNotion, siPrisma, siRender, siSanity, siSpotify, siTelegram, siUpstash,
  siVercel, siObsidian, siApple, siBinance,
} from 'simple-icons';
import { Clapperboard, CodeXml, CookingPot, Crown, FolderKanban, Gamepad2, Laptop, Megaphone, Phone, Stamp, Toilet, Users, type LucideIcon } from 'lucide-react';

// Les logos officiels de mes outils (bibliothèque simple-icons, licence CC0, couleurs des marques).
// LinkedIn a demandé à être retiré de simple-icons : son logo « in » est redessiné ici, sur son bleu officiel.

export type Tool = { key: string; nom: string; hex: string; path: string };

const LINKEDIN_PATH =
  'M5.3 9.5h3.4V19H5.3zM7 4.6a1.95 1.95 0 1 1 0 3.9 1.95 1.95 0 0 1 0-3.9zM10.9 9.5h3.25v1.3h.05c.45-.85 1.55-1.75 3.2-1.75 3.4 0 4.05 2.25 4.05 5.15V19H18.1v-4.25c0-1.02-.02-2.33-1.42-2.33-1.42 0-1.64 1.11-1.64 2.25V19h-3.4z';

const si = (key: string, s: { title: string; hex: string; path: string }): Tool => ({ key, nom: s.title, hex: `#${s.hex}`, path: s.path });

export const TOOLS: Tool[] = [
  si('GH', siGithub),
  si('▲', siVercel),
  { key: 'in', nom: 'LinkedIn', hex: '#0A66C2', path: LINKEDIN_PATH },
  si('Tg', siTelegram),
  si('Gm', siGmail),
  si('No', siNotion),
  si('C', siClaude),
  si('Cu', siCursor),
  si('Sa', siSanity),
  si('Up', siUpstash),
  si('Ex', siExpo),
  si('Pr', siPrisma),
  si('Ne', siNeon),
  si('Re', siRender),
  si('Sp', siSpotify),
  si('Ob', siObsidian),
  { ...si('Mac', siApple), nom: 'Mac' },
  si('Bi', siBinance),
];

export function ToolLogo({ t, size = 12 }: { t: Tool; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#fff" aria-hidden>
      <path d={t.path} />
    </svg>
  );
}

/** Le pictogramme de chaque pièce, pour le plan du bureau. */
export const ROOM_ICONS: Record<string, LucideIcon> = {
  direction: Crown,
  communication: Megaphone,
  code: CodeXml,
  mac: Laptop,
  cafe: CookingPot,
  pause: Gamepad2,
  toilettes: Toilet,
  atelier: FolderKanban,
  reunion: Users,
  cabines: Phone,
  studio: Clapperboard,
  accords: Stamp,
};
