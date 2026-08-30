export interface PlayerSummary {
  id: number;
  username: string;
  displayName: string;
  lastSyncedAt: number | null;
  gameCount: number;
  ratings: Array<{ timeClass: string; rating: number }>;
}

export interface GameListItem {
  id: number;
  externalUrl: string;
  playedAt: number;
  timeClass: string;
  timeControl: string;
  rated: boolean;
  rules: string;
  opponentKind: "human" | "coach" | "bot";
  playerColor: "white" | "black";
  playerRating: number | null;
  opponentUsername: string;
  opponentRating: number | null;
  ratingDiff: number | null;
  result: "win" | "loss" | "draw";
  termination: string | null;
  openingName: string | null;
  ecoCode: string | null;
  chesscomAccuracy: number | null;
  analysisStatus: string;
  analysisError: string | null;
  summary: string | null;
}

export interface JobState {
  running: boolean;
  cancelRequested: boolean;
  total: number;
  completed: number;
  failed: number;
  currentGameId: number | null;
  currentGameLabel: string | null;
  positionsDone: number;
  positionsTotal: number;
  stage: string;
  lastError: string | null;
  engineVersion: string | null;
}

export interface AnalysisStatusResponse {
  job: JobState;
  queue: Record<string, number>;
  failedGames: Array<{ id: number; error: string | null }>;
}

export interface EngineLocation {
  found: boolean;
  path: string | null;
  version: string | null;
  source: string;
}

export interface TurningPoint {
  ply: number;
  moveNumber: number;
  color: "white" | "black";
  san: string;
  bestMoveSan: string | null;
  bestLine: string | null;
  fenBefore: string;
  fenAfter: string;
  evalBeforeText: string;
  evalAfterText: string;
  centipawnLoss: number;
  classification: string;
  importance: number;
  themes: string[];
  explanation: string;
}

export interface StrengthMoment {
  ply: number;
  moveNumber: number;
  san: string;
  fenAfter: string;
  tags: string[];
  explanation: string;
}

export interface MoveRow {
  ply: number;
  moveNumber: number;
  color: "white" | "black";
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  evalBeforeText: string;
  evalAfterText: string;
  evalAfterWhiteCp: number | null;
  evalAfterWhiteMate: number | null;
  bestMoveSan: string | null;
  bestMoveUci: string | null;
  bestLine: string | null;
  centipawnLoss: number | null;
  classification: string | null;
  clockMs: number | null;
  phase: string | null;
  isPlayerMove: boolean;
  themes: {
    themes?: Array<{ tag: string; detail: string }>;
    strengths?: Array<{ tag: string; detail: string }>;
  };
}

export interface GameDetailResponse {
  game: GameListItem & { pgn: string; finalFen: string | null; analysisVersion: string | null; parseError: string | null };
  moves: MoveRow[];
  review: {
    overallSummary: string | null;
    openingSummary: string | null;
    middlegameSummary: string | null;
    endgameSummary: string | null;
    timeSummary: string | null;
    reflectionQuestion: string | null;
    userThoughts: string | null;
    userPostmortem: string | null;
    turningPoints: TurningPoint[];
    strengths: StrengthMoment[];
    checklist: string[];
  } | null;
}

export interface RecordSummary {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  score: number;
}

export interface Pattern {
  tag: string;
  label: string;
  description: string;
  patternType: "weakness" | "strength";
  status: "observing" | "candidate" | "confirmed";
  sampleSize: number;
  occurrenceCount: number;
  gameCount: number;
  distinctOpenings: number;
  distinctOpponents: number;
  severityScore: number;
  confidenceScore: number;
  evidenceGameIds: number[];
  evidence: Array<{ gameId: number; ply: number; moveNumber: number; san: string; detail: string }>;
  openingSpecific: string | null;
}

export interface DashboardResponse {
  playerId: number;
  username: string;
  displayName: string;
  totalGames: number;
  practiceGames: number;
  analyzedGames: number;
  pendingGames: number;
  hasEnoughSample: boolean;
  minSample: number;
  ratings: Array<{ timeClass: string; rating: number; recordedAt: number }>;
  ratingHistory: Array<{ timeClass: string; points: Array<{ at: number; rating: number }> }>;
  records: { last10: RecordSummary; last30: RecordSummary; last90: RecordSummary };
  byColor: { white: RecordSummary; black: RecordSummary };
  byTimeClass: Array<{ timeClass: string } & RecordSummary>;
  byOpening: Array<{ opening: string; asColor: string } & RecordSummary>;
  accuracy: {
    averageLossCp: number | null;
    blundersPerGame: number | null;
    mistakesPerGame: number | null;
    inaccuraciesPerGame: number | null;
  };
  weaknesses: Pattern[];
  strengths: Pattern[];
  allPatterns: Pattern[];
  trainingTasks: Array<{
    patternTag: string | null;
    title: string;
    instruction: string;
    targetCount: number | null;
    targetMinutes: number | null;
    completionCriteria: string;
  }>;
  recentGames: Array<{
    id: number;
    playedAt: number;
    opponentUsername: string;
    result: string;
    playerColor: string;
    timeClass: string;
    openingName: string | null;
    analysisStatus: string;
  }>;
}
