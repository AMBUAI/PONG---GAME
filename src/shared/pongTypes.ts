export const COURT_LENGTH = 800;
export const COURT_WIDTH = 500;

export const PADDLE_MARGIN = 26;
export const PADDLE_THICKNESS = 14;
export const PADDLE_LENGTH = 86;
export const PADDLE_SPEED = 480;
export const TOUCH_PADDLE_MAX_SPEED = 2400;

export const BALL_SIZE = 14;
export const BASE_BALL_SPEED = 410;
export const MAX_BALL_SPEED = 880;
export const RALLY_SPEED_INCREMENT = 18;
export const MAX_BOUNCE_ANGLE = (52 * Math.PI) / 180;

export const TRAINING_BASE_SPEED = 390;
export const TRAINING_SPEED_STEP = 65;
export const TRAINING_MAX_SPEED = 910;
export const TRAINING_MILESTONE_STEP = 25;
export const WALL_THICKNESS = 16;

export const WIN_SCORE = 21;
export const SERVE_PAUSE_SEC = 0.65;
export const RECONNECT_GRACE_MS = 15000;
export const REMATCH_TIMEOUT_MS = 30000;
export const GAME_INTERMISSION_MS = 3000;
export const RESUME_COUNTDOWN_MS = 1500;

export type GameMode = 'VS_BOT' | 'TRAINING' | 'ONLINE' | 'ATTRACT';
export type BotDifficulty = 'EASY' | 'CLASSIC' | 'HARD';
export type PlayerRole = 'host' | 'guest';

export type SoundEvent = 'paddle' | 'wall' | 'score' | 'speedup' | 'win' | 'lose';

export interface PongSimState {
  mode: GameMode;
  ballU: number;
  ballV: number;
  ballVu: number;
  ballVv: number;
  ballSpeed: number;
  p1V: number;
  p2V: number;
  p1Score: number;
  p2Score: number;
  trainingReturns: number;
  serveTimer: number;
  serveDirection: 1 | -1;
  winner: 'p1' | 'p2' | null;
  lastSpeedMilestone: number;
}

export type RoomStatus =
  | 'LOBBY'
  | 'PLAYING'
  | 'GAME_INTERMISSION'
  | 'PAUSED_DISCONNECT'
  | 'FORFEIT_INTERMISSION'
  | 'RESUMING'
  | 'SERIES_OVER'
  | 'CLOSED';

export type SeriesEndReason = 'MAJORITY_SECURED' | 'ALL_GAMES_COMPLETED';

export interface RematchState {
  hostRequested: boolean;
  guestRequested: boolean;
  requestedBy: PlayerRole | null;
  expiresAt: number | null;
  statusText: string | null;
}

export interface RoomSnapshot {
  roomCode: string;
  status: RoomStatus;
  seriesLength: number;
  majorityNeeded: number;
  currentGame: number;
  hostConnected: boolean;
  guestConnected: boolean;
  hostJoined: boolean;
  guestJoined: boolean;
  p1Score: number;
  p2Score: number;
  p1Games: number;
  p2Games: number;
  p1V: number;
  p2V: number;
  ballU: number;
  ballV: number;
  ballVu: number;
  ballVv: number;
  serveTimer: number;
  disconnectedRole: PlayerRole | null;
  graceExpiresAt: number | null;
  intermissionExpiresAt: number | null;
  lastGameWinner: PlayerRole | null;
  lastGameForfeit: boolean;
  seriesWinner: PlayerRole | 'TIE' | null;
  seriesEndReason: SeriesEndReason | null;
  seriesEndedByForfeit: boolean;
  rematch: RematchState;
  serverTime: number;
  events?: SoundEvent[];
}

export type ClientToServerMessage =
  | { type: 'create_room' }
  | { type: 'join_room'; roomCode: string }
  | { type: 'reconnect_room'; roomCode: string; playerToken: string }
  | { type: 'set_series_length'; seriesLength: number }
  | { type: 'start_match' }
  | { type: 'paddle_input'; targetV: number | null; moveDir: -1 | 0 | 1 }
  | { type: 'request_rematch' }
  | { type: 'accept_rematch' }
  | { type: 'decline_rematch' }
  | { type: 'leave_room' }
  | { type: 'ping'; clientTime: number };

export type ServerToClientMessage =
  | {
      type: 'room_joined';
      roomCode: string;
      role: PlayerRole;
      playerToken: string;
      snapshot: RoomSnapshot;
    }
  | { type: 'room_state'; snapshot: RoomSnapshot }
  | { type: 'room_error'; code: string; message: string }
  | { type: 'room_closed'; reason: string }
  | { type: 'pong'; clientTime: number; serverTime: number };

export function computeMajorityNeeded(seriesLength: number): number {
  return Math.floor(seriesLength / 2) + 1;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
