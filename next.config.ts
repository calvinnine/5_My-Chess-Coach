import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The libSQL client and the Stockfish child process must stay on the Node
  // runtime, never bundled into the edge/browser build.
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
