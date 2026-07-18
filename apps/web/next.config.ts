import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@pulse-atx/schemas", "@pulse-atx/shared"],
};

export default nextConfig;
