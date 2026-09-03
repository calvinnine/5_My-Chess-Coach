import crypto from "node:crypto";
import type { ChessComProfile } from "@/lib/chesscom/schemas";

/**
 * Proving that a Chess.com account belongs to the person claiming it.
 *
 * The app asks for a code, the account owner puts it in a profile field only
 * they can edit, and the server reads it back through the public API. No
 * password is ever requested — this app must never handle one — and no
 * third-party approval is needed, unlike OAuth.
 *
 * What this actually proves: whoever asked can write to that Chess.com
 * profile. That is exactly the claim being made.
 */

/** Recognisable at a glance in a profile field, and obviously not a real name. */
const CODE_PREFIX = "mychess-";

/** Long enough that two outstanding challenges will not collide. */
const CODE_BYTES = 5;

export const CHALLENGE_TTL_SECONDS = 30 * 60;

/** A wrong code usually means "not saved yet", so allow retries — but not forever. */
export const MAX_VERIFY_ATTEMPTS = 20;

export function makeChallengeCode(): string {
  return CODE_PREFIX + crypto.randomBytes(CODE_BYTES).toString("hex");
}

export function isChallengeCode(value: string): boolean {
  return new RegExp(`^${CODE_PREFIX}[0-9a-f]{${CODE_BYTES * 2}}$`).test(value);
}

/**
 * The profile fields a Chess.com account holder can put arbitrary text in.
 *
 * `username` is deliberately absent: it is not free text, and accepting it
 * would let anyone whose handle happened to contain the code pass.
 */
function editableFields(profile: ChessComProfile): string[] {
  return [profile.name, profile.location].filter(
    (v): v is string => typeof v === "string",
  );
}

/**
 * Whether this profile carries the challenge code.
 *
 * Matching is case-insensitive and allows surrounding text, so the owner can
 * keep their real name or location alongside the code. The code is random, so
 * a loose match here cannot be hit by accident.
 */
export function profileProvesOwnership(
  profile: ChessComProfile,
  code: string,
): boolean {
  if (!isChallengeCode(code)) return false;
  const needle = code.toLowerCase();
  return editableFields(profile).some((field) => field.toLowerCase().includes(needle));
}

/** Chess.com handles: what their public API accepts. */
export function normalizeUsername(raw: string): string | null {
  const username = raw.trim().toLowerCase();
  return /^[a-z0-9_-]{3,25}$/.test(username) ? username : null;
}
