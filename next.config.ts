import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 and the Stockfish child process must stay on the Node runtime,
  // never bundled into the edge/browser build.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
