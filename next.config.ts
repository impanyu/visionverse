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
    // Handle ChromaDB external dependencies more aggressively
    config.externals = config.externals || [];
    config.externals.push({
      'chromadb-default-embed': 'chromadb-default-embed',
      'chromadb': 'chromadb',
    });
    
    // Ignore ChromaDB's external HTTP imports during build
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      'chromadb-default-embed': false,
      'fs': false,
      'path': false,
      'os': false,
    };

    // Add alias to prevent external URL imports
    config.resolve.alias = {
      ...config.resolve.alias,
      'chromadb-default-embed': false,
    };

    // Ignore external URL patterns
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /https:\/\/unpkg\.com\/chromadb-default-embed/,
      use: 'null-loader',
    });

    return config;
  },
};

export default nextConfig;
