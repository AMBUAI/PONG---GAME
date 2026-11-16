import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { usePongControls } from '../hooks/usePongControls.ts';
import {
  createInitialSimState,
  getNextTrainingMilestone,
  getTrainingLevel,
  stepPongSimulation,
} from '../shared/pongEngine.ts';
import { retroAudio } from '../utils/sound.ts';
import { PongCanvas, type RenderFrameState } from './PongCanvas.tsx';

interface TrainingGameProps {
  highScore: number;
  onExit: () => void;
  onScoreCandidate: (score: number) => void;
}

export function TrainingGame({ highScore, onExit, onScoreCandidate }: TrainingGameProps) {
  const [returns, setReturns] = useState(0);
  const [paused, setPaused] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [speedBanner, setSpeedBanner] = useState<string | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [muted, setMuted] = useState(() => retroAudio.isMuted());

  const simRef = useRef(createInitialSimState('TRAINING'));
  const pausedRef = useRef(paused);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bestAtStartRef = useRef(highScore);
  pausedRef.current = paused;

  const { onPointerTargetV, getInput } = usePongControls(!paused && !gameOver, isPortrait);
  const getInputRef = useRef(getInput);
  getInputRef.current = getInput;

  const resetTraining = useCallback(() => {
    retroAudio.unlock();
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    simRef.current = createInitialSimState('TRAINING');
    bestAtStartRef.current = highScore;
    setReturns(0);
    setGameOver(false);
    setPaused(false);
    setSpeedBanner(null);
    setIsNewBest(false);
  }, [highScore]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (!gameOver) {
          setPaused((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, [gameOver]);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const sim = simRef.current;
      if (!pausedRef.current && sim.winner === null) {
        const playerInput = getInputRef.current();
        const prevReturns = sim.trainingReturns;

        const stepResult = stepPongSimulation(
          sim,
          {
            p1Dir: playerInput.moveDir,
            p1TargetV: playerInput.targetV,
            p2Dir: 0,
            p2TargetV: null,
          },
          dt
        );

        for (const ev of stepResult.events) {
          retroAudio.play(ev);
        }

        if (sim.trainingReturns !== prevReturns) {
          setReturns(sim.trainingReturns);
          onScoreCandidate(sim.trainingReturns);
          if (sim.trainingReturns > bestAtStartRef.current) {
            setIsNewBest(true);
          }
        }

        if (stepResult.trainingMilestoneReached !== null) {
          const level = getTrainingLevel(stepResult.trainingMilestoneReached);
          setSpeedBanner(`SPEED UP · LVL ${level}`);
          if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
          bannerTimerRef.current = setTimeout(() => {
            setSpeedBanner(null);
          }, 1400);
        }

        if (sim.winner !== null) {
          setGameOver(true);
          onScoreCandidate(sim.trainingReturns);
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [onScoreCandidate]);

  const getFrameState = useCallback((): RenderFrameState => {
    const s = simRef.current;
    return {
      mode: 'TRAINING',
      ballU: s.ballU,
      ballV: s.ballV,
      p1V: s.p1V,
      p2V: s.p2V,
      dimmed: paused || gameOver,
    };
  }, [paused, gameOver]);

  const toggleMute = () => {
    const next = !muted;
    retroAudio.setMuted(next);
    setMuted(next);
    if (!next) retroAudio.unlock();
  };

  const nextMilestone = getNextTrainingMilestone(returns);
  const currentLevel = getTrainingLevel(returns);

  return (
    <div
      className="w-full h-full bg-black text-white flex flex-col overflow-hidden select-none"
      onPointerDown={() => retroAudio.unlock()}
    >
      {/* Compact Top HUD */}
      <header className="shrink-0 w-full px-3 sm:px-6 py-2 border-b border-white/20 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onExit}
          className="min-h-[44px] px-3 border border-white/50 text-white font-mono-arcade text-xs tracking-wider uppercase hover:bg-white hover:text-black transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          BACK
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono-arcade text-[10px] sm:text-xs text-white/60 uppercase">
              RETURNS
            </span>
            <span className="font-arcade text-base sm:text-xl tracking-wider">{returns}</span>
          </div>
          <div className="font-mono-arcade text-[10px] sm:text-xs text-white/65 tracking-wider">
            NEXT SPEED {nextMilestone} · LVL {currentLevel}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-white/50 text-white hover:bg-white hover:text-black transition-colors cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            disabled={gameOver}
            className="min-h-[44px] px-3 border border-white/50 text-white font-mono-arcade text-xs tracking-wider uppercase hover:bg-white hover:text-black transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
          >
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
        </div>
      </header>

      {/* Playfield */}
      <div className="relative flex-1 min-h-0 w-full p-2 sm:p-5 flex items-center justify-center">
        <div className="w-full h-full max-w-5xl max-h-full">
          <PongCanvas
            getFrameState={getFrameState}
            interactive={!paused && !gameOver}
            onPointerTargetV={onPointerTargetV}
            onOrientationChange={setIsPortrait}
          />
        </div>

        {/* Speed Milestone Flash */}
        {speedBanner && !paused && !gameOver && (
          <div className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 z-10 border border-white bg-black px-4 py-1.5 font-arcade text-xs tracking-widest text-white">
            {speedBanner}
          </div>
        )}

        {/* Pause Overlay */}
        {paused && !gameOver && (
          <div className="absolute inset-0 z-20 bg-black/85 flex items-center justify-center p-4">
            <div className="w-full max-w-xs border-2 border-white bg-black p-6 flex flex-col items-center text-center gap-4">
              <h2 className="font-arcade text-xl tracking-[0.15em]">PAUSED</h2>
              <p className="font-mono-arcade text-xs text-white/75">
                RETURNS: {returns} · NEXT SPEED: {nextMilestone}
              </p>
              <div className="w-full flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => setPaused(false)}
                  className="w-full min-h-[48px] border-2 border-white bg-white text-black font-arcade text-xs tracking-wider hover:bg-black hover:text-white transition-colors cursor-pointer"
                >
                  RESUME
                </button>
                <button
                  type="button"
                  onClick={resetTraining}
                  className="w-full min-h-[48px] border-2 border-white bg-black text-white font-arcade text-xs tracking-wider hover:bg-white hover:text-black transition-colors cursor-pointer"
                >
                  RETRY
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  className="w-full min-h-[48px] border border-white/60 bg-black text-white font-arcade text-xs tracking-wider hover:bg-white hover:text-black transition-colors cursor-pointer"
                >
                  DASHBOARD
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Training End Overlay */}
        {gameOver && (
          <div className="absolute inset-0 z-20 bg-black/85 flex items-center justify-center p-4">
            <div className="w-full max-w-xs border-2 border-white bg-black p-6 flex flex-col items-center text-center gap-4">
              <h2 className="font-arcade text-lg sm:text-xl tracking-[0.12em]">TRAINING OVER</h2>
              <div className="flex flex-col gap-1.5">
                <span className="font-mono-arcade text-xs text-white/65 uppercase">
                  FINAL RETURNS
                </span>
                <span className="font-arcade text-3xl tracking-wider">{returns}</span>
                {isNewBest && (
                  <span className="font-mono-arcade text-xs tracking-widest text-white uppercase mt-1">
                    NEW HIGH SCORE
                  </span>
                )}
              </div>
              <p className="font-mono-arcade text-xs text-white/65">
                SPEED LEVEL REACHED: {currentLevel}
              </p>
              <div className="w-full flex flex-col gap-2.5 mt-1">
                <button
                  type="button"
                  onClick={resetTraining}
                  className="w-full min-h-[48px] border-2 border-white bg-white text-black font-arcade text-xs tracking-wider hover:bg-black hover:text-white transition-colors cursor-pointer"
                >
                  RETRY
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  className="w-full min-h-[48px] border-2 border-white bg-black text-white font-arcade text-xs tracking-wider hover:bg-white hover:text-black transition-colors cursor-pointer"
                >
                  DASHBOARD
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Minimal control hint */}
      <footer className="shrink-0 w-full px-4 py-1.5 text-center font-mono-arcade text-[11px] tracking-wider text-white/55">
        {isPortrait ? 'DRAG TO RETURN BALL' : 'DRAG OR USE W/S OR UP/DOWN KEYS'} · SPEED INCREASES EVERY 25 RETURNS
      </footer>
    </div>
  );
}
