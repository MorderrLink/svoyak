import { getLocalIPv4Addresses } from "./src/server/network/local-addresses";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1", ...getLocalIPv4Addresses()],
  serverExternalPackages: ["unzipper"],
};

export default nextConfig;
