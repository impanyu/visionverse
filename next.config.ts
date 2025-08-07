import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config: any) => {
    // Handle ChromaDB external dependencies
    config.externals = config.externals || [];
    config.externals.push({
      'chromadb-default-embed': 'chromadb-default-embed',
    });
    
    // Ignore ChromaDB's external HTTP imports during build
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      'chromadb-default-embed': false,
    };

    return config;
  },
};

export default nextConfig;
