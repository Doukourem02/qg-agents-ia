// Les sites que Luffy surveille (constatés le 10 novembre 2026). Pour en ajouter ou en retirer : modifier cette liste.

export type Site = { id: string; nom: string; url: string; normal: (statut: number) => boolean };

const deuxXX = (s: number) => s >= 200 && s < 300;

export const SITES: readonly Site[] = [
  { id: 'boutique', nom: 'Boutique Stores', url: 'https://www.boutiquestores.com', normal: deuxXX },
  { id: 'portfolio', nom: 'Portfolio', url: 'https://mon-portfolio.vercel.app', normal: deuxXX },
  // Renvoie vers la connexion : une redirection est une réponse normale.
  { id: 'admin-livreo', nom: 'Admin Livreo', url: 'https://admin.livreo.exemple.com', normal: s => s >= 200 && s < 400 },
  // Une API peut répondre 404 à la racine : seuls 5xx, délai dépassé et erreur réseau comptent.
  { id: 'api-livreo', nom: 'API Livreo', url: 'https://api.livreo.exemple.com', normal: s => s < 500 },
  { id: 'solidar', nom: 'solidar-ci', url: 'https://solidar-ci.vercel.app', normal: deuxXX },
  { id: 'bella', nom: 'studio-deco', url: 'https://studio-deco.vercel.app', normal: deuxXX },
];
