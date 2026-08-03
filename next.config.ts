import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Phase 2 of port-prototype-ui-overhaul: legacy `/recipes/*` URLs
      // 308-permanently redirect to `/templates/*` so external bookmarks
      // survive the rename. The trailing wildcard preserves subpaths.
      { source: "/recipes", destination: "/templates", permanent: true },
      { source: "/recipes/:path*", destination: "/templates/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
