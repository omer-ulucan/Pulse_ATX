import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@pulse-atx/schemas", "@pulse-atx/shared"],
};

export default nextConfig;
