import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { NextConfig } from "next";

const localEnvironmentPath = resolve(process.cwd(), ".env");
const workspaceEnvironmentPath = resolve(process.cwd(), "../../.env");
if (existsSync(localEnvironmentPath)) {
  process.loadEnvFile(localEnvironmentPath);
} else if (existsSync(workspaceEnvironmentPath)) {
  process.loadEnvFile(workspaceEnvironmentPath);
}

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@pulse-atx/schemas", "@pulse-atx/shared"],
};

export default nextConfig;
