import { useCallback, useState } from 'react';
import { Dashboard } from './components/Dashboard.tsx';
import { OnlineMultiplayer } from './components/OnlineMultiplayer.tsx';
import { OfflineIndicator } from './components/PWAControls.tsx';
import { TrainingGame } from './components/TrainingGame.tsx';
import { VsBotGame } from './components/VsBotGame.tsx';
import { getHighScore, updateHighScoreIfHigher } from './utils/highScore.ts';
import { retroAudio } from './utils/sound.ts';

type AppScreen = 'DASHBOARD' | 'VS_BOT' | 'TRAINING' | 'ONLINE';

function hasPendingOnlineSession(): boolean {
  try {
    return Boolean(window.sessionStorage.getItem('retro_pong_active_room'));
  } catch {
    return false;
  }
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>(() =>
    hasPendingOnlineSession() ? 'ONLINE' : 'DASHBOARD'
  );
  const [highScore, setHighScore] = useState<number>(() => getHighScore());

  const handleScoreCandidate = useCallback((score: number) => {
    const updated = updateHighScoreIfHigher(score);
    setHighScore(updated);
  }, []);

  const enterScreen = useCallback((next: AppScreen) => {
    retroAudio.unlock();
    setScreen(next);
  }, []);

  const returnToDashboard = useCallback(() => {
    setHighScore(getHighScore());
    setScreen('DASHBOARD');
  }, []);

  return (
    <>
      {screen === 'VS_BOT' && (
        <VsBotGame
          onExit={returnToDashboard}
          onScoreCandidate={handleScoreCandidate}
        />
      )}

      {screen === 'TRAINING' && (
        <TrainingGame
          highScore={highScore}
          onExit={returnToDashboard}
          onScoreCandidate={handleScoreCandidate}
        />
      )}

      {screen === 'ONLINE' && <OnlineMultiplayer onExit={returnToDashboard} />}

      {screen === 'DASHBOARD' && (
        <Dashboard
          highScore={highScore}
          onSelectVsBot={() => enterScreen('VS_BOT')}
          onSelectTraining={() => enterScreen('TRAINING')}
          onSelectOnline={() => enterScreen('ONLINE')}
        />
      )}

      <OfflineIndicator />
    </>
  );
}
