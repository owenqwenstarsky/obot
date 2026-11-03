import type { NextConfig } from "next";

const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  // Extra hostnames allowed to load dev assets (e.g. a Tailscale name). Dev only.
  allowedDevOrigins: list(process.env.ALLOWED_DEV_ORIGINS),
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "just-bash"],
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
