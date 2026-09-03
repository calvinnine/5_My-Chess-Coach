import { resolveLocation } from "../src/db/location";
import { runMigrations } from "../src/db/migrate";

const location = resolveLocation();
const { ran, total } = await runMigrations(location);
console.log(
  ran.length
    ? `Applied ${ran.length}/${total} migration(s) to ${location.label}:\n  ${ran.join("\n  ")}`
    : `Database at ${location.label} is up to date (${total} migration(s) on record).`,
);
