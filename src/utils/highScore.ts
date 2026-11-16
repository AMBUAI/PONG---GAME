const HIGH_SCORE_KEY = 'retro_pong_high_score';

let inMemoryHighScore = 0;

export function getHighScore(): number {
  try {
    const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
    if (!raw) return inMemoryHighScore;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      inMemoryHighScore = Math.max(inMemoryHighScore, parsed);
      return inMemoryHighScore;
    }
    return inMemoryHighScore;
  } catch {
    return inMemoryHighScore;
  }
}

export function updateHighScoreIfHigher(candidateScore: number): number {
  if (!Number.isFinite(candidateScore) || candidateScore <= 0) {
    return getHighScore();
  }
  const cleanScore = Math.floor(candidateScore);
  const current = getHighScore();
  if (cleanScore <= current) {
    return current;
  }

  inMemoryHighScore = cleanScore;
  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(cleanScore));
  } catch {
    // Fallback to in-memory high score when localStorage is blocked or unavailable
  }
  return cleanScore;
}
