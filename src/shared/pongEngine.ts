import {
  BALL_SIZE,
  BASE_BALL_SPEED,
  COURT_LENGTH,
  COURT_WIDTH,
  type GameMode,
  MAX_BALL_SPEED,
  MAX_BOUNCE_ANGLE,
  PADDLE_LENGTH,
  PADDLE_MARGIN,
  PADDLE_SPEED,
  PADDLE_THICKNESS,
  type PongSimState,
  RALLY_SPEED_INCREMENT,
  SERVE_PAUSE_SEC,
  type SoundEvent,
  TOUCH_PADDLE_MAX_SPEED,
  TRAINING_BASE_SPEED,
  TRAINING_MAX_SPEED,
  TRAINING_MILESTONE_STEP,
  TRAINING_SPEED_STEP,
  WALL_THICKNESS,
  WIN_SCORE,
  clamp,
} from './pongTypes.ts';

export interface StepInput {
  p1Dir: -1 | 0 | 1;
  p1TargetV: number | null;
  p2Dir: -1 | 0 | 1;
  p2TargetV: number | null;
}

export interface StepResult {
  events: SoundEvent[];
  scoredBy: 'p1' | 'p2' | null;
  trainingMilestoneReached: number | null;
}

export function createInitialSimState(mode: GameMode): PongSimState {
  const serveDirection: 1 | -1 = mode === 'TRAINING' ? 1 : Math.random() < 0.5 ? 1 : -1;
  const baseSpeed = mode === 'TRAINING' ? TRAINING_BASE_SPEED : BASE_BALL_SPEED;
  const state: PongSimState = {
    mode,
    ballU: COURT_LENGTH / 2,
    ballV: COURT_WIDTH / 2,
    ballVu: 0,
    ballVv: 0,
    ballSpeed: baseSpeed,
    p1V: COURT_WIDTH / 2,
    p2V: COURT_WIDTH / 2,
    p1Score: 0,
    p2Score: 0,
    trainingReturns: 0,
    serveTimer: mode === 'ATTRACT' ? 0.15 : SERVE_PAUSE_SEC,
    serveDirection,
    winner: null,
    lastSpeedMilestone: 0,
  };
  launchBallVelocity(state, serveDirection);
  return state;
}

export function launchBallVelocity(state: PongSimState, direction: 1 | -1): void {
  const angleRange = (24 * Math.PI) / 180;
  const rawAngle = (Math.random() * 2 - 1) * angleRange;
  // Avoid perfectly flat horizontal shots for better rallies
  const angle = Math.abs(rawAngle) < 0.08 ? (rawAngle >= 0 ? 0.12 : -0.12) : rawAngle;
  const speed =
    state.mode === 'TRAINING' ? getTrainingSpeedForReturns(state.trainingReturns) : BASE_BALL_SPEED;

  state.ballSpeed = speed;
  state.ballVu = Math.cos(angle) * speed * direction;
  state.ballVv = Math.sin(angle) * speed;
}

export function getTrainingSpeedForReturns(returns: number): number {
  const tier = Math.floor(returns / TRAINING_MILESTONE_STEP);
  return Math.min(TRAINING_MAX_SPEED, TRAINING_BASE_SPEED + tier * TRAINING_SPEED_STEP);
}

export function getNextTrainingMilestone(returns: number): number {
  return (Math.floor(returns / TRAINING_MILESTONE_STEP) + 1) * TRAINING_MILESTONE_STEP;
}

export function getTrainingLevel(returns: number): number {
  return Math.floor(returns / TRAINING_MILESTONE_STEP) + 1;
}

function movePaddle(
  currentV: number,
  dir: -1 | 0 | 1,
  targetV: number | null,
  dt: number,
  maxSpeed: number
): number {
  const halfPad = PADDLE_LENGTH / 2;
  const minV = halfPad;
  const maxV = COURT_WIDTH - halfPad;

  let nextV = currentV;
  if (targetV !== null) {
    const clampedTarget = clamp(targetV, minV, maxV);
    const delta = clampedTarget - currentV;
    const maxStep = TOUCH_PADDLE_MAX_SPEED * dt;
    if (Math.abs(delta) <= maxStep) {
      nextV = clampedTarget;
    } else {
      nextV = currentV + Math.sign(delta) * maxStep;
    }
  } else if (dir !== 0) {
    nextV = currentV + dir * maxSpeed * dt;
  }

  return clamp(nextV, minV, maxV);
}

export function resetForServe(state: PongSimState, direction: 1 | -1): void {
  state.ballU = COURT_LENGTH / 2;
  state.ballV = COURT_WIDTH / 2;
  state.serveDirection = direction;
  state.serveTimer = state.mode === 'ATTRACT' ? 0.25 : SERVE_PAUSE_SEC;
  launchBallVelocity(state, direction);
}

export function stepPongSimulation(
  state: PongSimState,
  input: StepInput,
  dtRaw: number,
  p2MaxSpeed: number = PADDLE_SPEED
): StepResult {
  const result: StepResult = {
    events: [],
    scoredBy: null,
    trainingMilestoneReached: null,
  };

  if (state.winner !== null) {
    return result;
  }

  const dt = Math.min(dtRaw, 0.05);
  const SUB_STEP_MAX = 1 / 120;
  const subSteps = Math.max(1, Math.ceil(dt / SUB_STEP_MAX));
  const subDt = dt / subSteps;

  const halfBall = BALL_SIZE / 2;
  const halfPad = PADDLE_LENGTH / 2;
  const p1Front = PADDLE_MARGIN + PADDLE_THICKNESS / 2;
  const p1Back = PADDLE_MARGIN - PADDLE_THICKNESS / 2;
  const p2Front = COURT_LENGTH - PADDLE_MARGIN - PADDLE_THICKNESS / 2;
  const p2Back = COURT_LENGTH - PADDLE_MARGIN + PADDLE_THICKNESS / 2;
  const trainingWallFace = COURT_LENGTH - WALL_THICKNESS;

  for (let i = 0; i < subSteps; i++) {
    // Move paddles continuously even during serve pause
    state.p1V = movePaddle(state.p1V, input.p1Dir, input.p1TargetV, subDt, PADDLE_SPEED);
    if (state.mode !== 'TRAINING') {
      state.p2V = movePaddle(state.p2V, input.p2Dir, input.p2TargetV, subDt, p2MaxSpeed);
    }

    if (state.serveTimer > 0) {
      state.serveTimer = Math.max(0, state.serveTimer - subDt);
      continue;
    }

    const prevU = state.ballU;
    state.ballU += state.ballVu * subDt;
    state.ballV += state.ballVv * subDt;

    // Top & bottom walls
    if (state.ballV - halfBall <= 0) {
      state.ballV = halfBall;
      state.ballVv = Math.abs(state.ballVv);
      result.events.push('wall');
    } else if (state.ballV + halfBall >= COURT_WIDTH) {
      state.ballV = COURT_WIDTH - halfBall;
      state.ballVv = -Math.abs(state.ballVv);
      result.events.push('wall');
    }

    // Player 1 paddle collision (left side in landscape / bottom in portrait)
    if (
      state.ballVu < 0 &&
      state.ballU - halfBall <= p1Front &&
      prevU + halfBall >= p1Back
    ) {
      const hitHalfSpan = halfPad + halfBall * 0.85;
      if (Math.abs(state.ballV - state.p1V) <= hitHalfSpan) {
        const rel = clamp((state.ballV - state.p1V) / halfPad, -1, 1);
        const angle = rel * MAX_BOUNCE_ANGLE;

        if (state.mode === 'TRAINING') {
          state.trainingReturns += 1;
          state.ballSpeed = getTrainingSpeedForReturns(state.trainingReturns);
          if (
            state.trainingReturns > 0 &&
            state.trainingReturns % TRAINING_MILESTONE_STEP === 0 &&
            state.trainingReturns !== state.lastSpeedMilestone
          ) {
            state.lastSpeedMilestone = state.trainingReturns;
            result.trainingMilestoneReached = state.trainingReturns;
            result.events.push('speedup');
          } else {
            result.events.push('paddle');
          }
        } else {
          state.ballSpeed = Math.min(MAX_BALL_SPEED, state.ballSpeed + RALLY_SPEED_INCREMENT);
          result.events.push('paddle');
        }

        state.ballVu = Math.cos(angle) * state.ballSpeed;
        state.ballVv = Math.sin(angle) * state.ballSpeed;
        state.ballU = p1Front + halfBall + 0.5;
      }
    }

    // Opposite side: solid wall in TRAINING, paddle in VS_BOT / ONLINE / ATTRACT
    if (state.mode === 'TRAINING') {
      if (state.ballVu > 0 && state.ballU + halfBall >= trainingWallFace) {
        state.ballU = trainingWallFace - halfBall - 0.5;
        state.ballVu = -Math.abs(state.ballVu);
        result.events.push('wall');
      }
    } else if (
      state.ballVu > 0 &&
      state.ballU + halfBall >= p2Front &&
      prevU - halfBall <= p2Back
    ) {
      const hitHalfSpan = halfPad + halfBall * 0.85;
      if (Math.abs(state.ballV - state.p2V) <= hitHalfSpan) {
        const rel = clamp((state.ballV - state.p2V) / halfPad, -1, 1);
        const angle = rel * MAX_BOUNCE_ANGLE;

        state.ballSpeed = Math.min(MAX_BALL_SPEED, state.ballSpeed + RALLY_SPEED_INCREMENT);
        state.ballVu = -Math.cos(angle) * state.ballSpeed;
        state.ballVv = Math.sin(angle) * state.ballSpeed;
        state.ballU = p2Front - halfBall - 0.5;
        result.events.push('paddle');
      }
    }

    // Scoring checks
    if (state.ballU + halfBall < 0) {
      if (state.mode === 'TRAINING') {
        state.winner = 'p2';
        result.events.push('lose');
        return result;
      }

      if (state.mode !== 'ATTRACT') {
        state.p2Score += 1;
      }
      result.scoredBy = 'p2';
      result.events.push('score');

      if (state.mode !== 'ATTRACT' && state.p2Score >= WIN_SCORE) {
        state.winner = 'p2';
        result.events.push('lose');
        return result;
      }

      resetForServe(state, -1);
      return result;
    }

    if (state.mode !== 'TRAINING' && state.ballU - halfBall > COURT_LENGTH) {
      if (state.mode !== 'ATTRACT') {
        state.p1Score += 1;
      }
      result.scoredBy = 'p1';
      result.events.push('score');

      if (state.mode !== 'ATTRACT' && state.p1Score >= WIN_SCORE) {
        state.winner = 'p1';
        result.events.push('win');
        return result;
      }

      resetForServe(state, 1);
      return result;
    }
  }

  return result;
}
