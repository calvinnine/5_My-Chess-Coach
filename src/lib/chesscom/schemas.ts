import { z } from "zod";

export const profileSchema = z.object({
  username: z.string(),
  player_id: z.number().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  avatar: z.string().optional(),
  country: z.string().optional(),
  /** Free-text fields the account owner can edit; used for ownership proof. */
  location: z.string().optional(),
  url: z.string().optional(),
  joined: z.number().optional(),
  last_online: z.number().optional(),
  followers: z.number().optional(),
  status: z.string().optional(),
});
export type ChessComProfile = z.infer<typeof profileSchema>;

const ratingBucket = z
  .object({
    last: z.object({ rating: z.number(), date: z.number().optional() }).optional(),
    best: z.object({ rating: z.number() }).optional(),
    record: z
      .object({ win: z.number(), loss: z.number(), draw: z.number() })
      .optional(),
  })
  .optional();

export const statsSchema = z.object({
  chess_rapid: ratingBucket,
  chess_blitz: ratingBucket,
  chess_bullet: ratingBucket,
  chess_daily: ratingBucket,
});
export type ChessComStats = z.infer<typeof statsSchema>;

export const archivesSchema = z.object({ archives: z.array(z.string()) });

const sideSchema = z.object({
  username: z.string(),
  rating: z.number().optional(),
  result: z.string().optional(),
  "@id": z.string().optional(),
  uuid: z.string().optional(),
});

export const monthlyGameSchema = z.object({
  url: z.string().optional(),
  pgn: z.string().optional(),
  time_control: z.string().optional(),
  end_time: z.number().optional(),
  rated: z.boolean().optional(),
  fen: z.string().optional(),
  time_class: z.string().optional(),
  rules: z.string().optional(),
  uuid: z.string().optional(),
  white: sideSchema,
  black: sideSchema,
  accuracies: z
    .object({ white: z.number().optional(), black: z.number().optional() })
    .optional(),
  eco: z.string().optional(),
});
export type ChessComGame = z.infer<typeof monthlyGameSchema>;

/**
 * Games are validated one by one, not as a whole array: a single malformed
 * entry must not throw away the rest of the month.
 */
export const monthlyGamesSchema = z.object({ games: z.array(z.unknown()) });
