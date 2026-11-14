import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // imapflow ouvre des sockets TCP : on le laisse hors du bundle, chargé tel quel par Node.
  serverExternalPackages: ["imapflow"],
  partialPrefetching: true,
  // Les routes qui fabriquent les visuels de L lisent les polices et les captures sur le disque (next/og) :
  // sans cela, Vercel ne les embarque pas. Les crochets sont échappés (clés picomatch, cf. la doc de Next 16).
  outputFileTracingIncludes: {
    '/api/agents/l/\\[action\\]': ['./assets/polices/**', './public/l/captures/**'],
    '/api/l/visuel/\\[postId\\]': ['./assets/polices/**', './public/l/captures/**'],
    '/api/telegram': ['./assets/polices/**', './public/l/captures/**'],
  },
  // Les en-têtes de sécurité : la page ne s'affiche dans aucun cadre, le navigateur ne devine pas les types, les
  // autres sites ne reçoivent pas mon adresse, et la page ne demande ni caméra, ni micro, ni position.
  async headers() {
    return [{
      source: '/:chemin*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
