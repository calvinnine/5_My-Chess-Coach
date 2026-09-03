import { defineConfig } from "drizzle-kit";

const remote = process.env.TURSO_DATABASE_URL?.trim();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(remote
    ? {
        dialect: "turso" as const,
        dbCredentials: { url: remote, authToken: process.env.TURSO_AUTH_TOKEN },
      }
    : {
        dialect: "sqlite" as const,
        dbCredentials: { url: process.env.CHESS_COACH_DB ?? "./data/chess-coach.db" },
      }),
});
