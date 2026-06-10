/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@trash-wars/shared", "@trash-wars/economy"],
  reactStrictMode: true,
  webpack: (config) => {
    // the workspace packages use ESM-style ".js" relative imports from .ts sources
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
