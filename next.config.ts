import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "https://chat-api.jdump.com",
  },
  async headers() {
    return [
      {
        source: "/vaultboy.webp",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
