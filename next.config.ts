import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // Landing-page photography (Unsplash licence). The query asks Unsplash for a
    // pre-sized copy, so the optimizer never fetches the full-size original.
    // Artist photos on the results page come from Qloo's image CDN.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/photo-**" },
      { protocol: "https", hostname: "images.qloo.com", pathname: "/i/**" },
    ],
  },
  turbopack: {
    rules: {
      // Tailwind only processes the global stylesheet; CSS Modules stay native.
      "globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
