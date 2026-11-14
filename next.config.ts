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
