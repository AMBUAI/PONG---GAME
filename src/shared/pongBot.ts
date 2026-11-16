import {
  type BotDifficulty,
  COURT_WIDTH,
  PADDLE_SPEED,
  type PongSimState,
  clamp,
} from './pongTypes.ts';

export interface BotConfig {
  reactionIntervalSec: number;
  errorRange: number;
  maxSpeed: number;
  deadzone: number;
}

export const BOT_DIFFICULTIES: Record<BotDifficulty, BotConfig> = {
  EASY: {
    reactionIntervalSec: 0.16,
    errorRange: 38,
    maxSpeed: 310,
    deadzone: 14,
  },
  CLASSIC: {
    reactionIntervalSec: 0.11,
    errorRange: 24,
    maxSpeed: 390,
    deadzone: 10,
  },
  HARD: {
    reactionIntervalSec: 0.075,
    errorRange: 13,
    maxSpeed: 455,
    deadzone: 7,
  },
};

export interface BotControllerState {
  reactionTimer: number;
  targetV: number;
  errorOffset: number;
}

export function createBotState(): BotControllerState {
  return {
    reactionTimer: 0,
    targetV: COURT_WIDTH / 2,
    errorOffset: 0,
  };
}

export function updateBotInput(
  bot: BotControllerState,
  sim: PongSimState,
  dt: number,
  difficulty: BotDifficulty,
  side: 'p1' | 'p2' = 'p2'
): { moveDir: -1 | 0 | 1; maxSpeed: number } {
  const cfg = BOT_DIFFICULTIES[difficulty];
  const paddleV = side === 'p2' ? sim.p2V : sim.p1V;
  const ballApproaching = side === 'p2' ? sim.ballVu > 0 : sim.ballVu < 0;

  bot.reactionTimer -= dt;
  if (bot.reactionTimer <= 0) {
    bot.reactionTimer = cfg.reactionIntervalSec * (0.85 + Math.random() * 0.3);

    if (ballApproaching) {
      // Refresh human-like aim variance slightly on reaction ticks
      bot.errorOffset = (Math.random() * 2 - 1) * cfg.errorRange;
      bot.targetV = clamp(sim.ballV + bot.errorOffset, 40, COURT_WIDTH - 40);
    } else {
      // Drift calmly back toward center when ball goes away
      bot.targetV = COURT_WIDTH / 2;
    }
  }

  const diff = bot.targetV - paddleV;
  if (Math.abs(diff) <= cfg.deadzone) {
    return { moveDir: 0, maxSpeed: cfg.maxSpeed };
  }

  const effectiveSpeed = ballApproaching ? cfg.maxSpeed : Math.min(cfg.maxSpeed, PADDLE_SPEED * 0.55);
  return {
    moveDir: diff > 0 ? 1 : -1,
    maxSpeed: effectiveSpeed,
  };
}
