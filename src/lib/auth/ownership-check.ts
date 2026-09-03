import type { ChessComClient } from "@/lib/chesscom/client";
import { profileProvesOwnership } from "./verification";

export type OwnershipOutcome =
  | { proven: true }
  | { proven: false; reason: "no_profile" | "code_absent" };

/**
 * Reads the claimed account's public profile and looks for the challenge code.
 *
 * Takes the client rather than making one so the fetch-and-match wiring can be
 * tested — including the part that is easy to get wrong and impossible to see
 * from the outside: the cache must be bypassed.
 */
export async function checkProfileForCode(
  client: ChessComClient,
  username: string,
  code: string,
): Promise<OwnershipOutcome> {
  // `getProfile` never sends a conditional request; see the client for why.
  const profile = (await client.getProfile(username)).data;
  if (!profile) return { proven: false, reason: "no_profile" };
  if (!profileProvesOwnership(profile, code)) return { proven: false, reason: "code_absent" };
  return { proven: true };
}
