import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for forbidden() (403 surfaces) in Next 16.
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
