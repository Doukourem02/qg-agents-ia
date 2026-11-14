// La description des pièces du bureau (le texte du panneau qui s'ouvre au clic sur une pièce).

export const PIECES: Record<string, { texte: string; pole?: string }> = {
  direction: { texte: 'Le bureau vitré de Kuroro (CEO), Stalker (CTO) et Obito (CMO).', pole: 'direction' },
  code: { texte: 'Le Pôle Code : veille, point du matin, surveillance, sécurité, relecture, documentation.', pole: 'code' },
  communication: { texte: 'La pièce centrale : L prépare mes posts LinkedIn, Ye tient le portfolio à jour.', pole: 'communication' },
  mac: { texte: 'Mac & Outils : le ménage du Mac, les mails, et plus tard Notion.', pole: 'mac' },
  atelier: { texte: 'Un îlot par projet, sans nom affiché. Un agent vient à l’îlot quand il agit sur ce projet.' },
  reunion: { texte: 'La salle de réunion : les points d’équipe et les visiteurs.' },
  cafe: { texte: 'La cuisine, vitrée : de quoi faire un café, réchauffer son plat et manger, avec sa salle à manger à côté. Les agents y passent entre deux tâches et y déjeunent.' },
  pause: { texte: 'Box & pause : PS5, baby-foot, borne d’arcade et un canapé pour la sieste.' },
  toilettes: { texte: 'Les toilettes : deux cabines Hommes, deux cabines Femmes, les lavabos et leur miroir.' },
  cabines: { texte: 'Deux cabines vitrées pour les appels, avec leur voyant « occupé ».' },
  studio: { texte: 'Le studio : L et Tom y préparent les visuels et les vidéos des posts.' },
  accords: { texte: 'Le bureau des accords : tout ce qui sort du QG attend ici mon OK (sur Telegram).' },
};
