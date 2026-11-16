import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { usePongControls } from '../hooks/usePongControls.ts';
import { createBotState, updateBotInput } from '../shared/pongBot.ts';
import { createInitialSimState, stepPongSimulation } from '../shared/pongEngine.ts';
import { type BotDifficulty, WIN_SCORE } from '../shared/pongTypes.ts';
import { retroAudio } from '../utils/sound.ts';
import { PongCanvas, type RenderFrameState } from './PongCanvas.tsx';

interface VsBotGameProps {
  onExit: () => void;
  onScoreCandidate: (score: number) => void;
}

export function VsBotGame({ onExit, onScoreCandidate }: VsBotGameProps) {
  const [scores, setScores] = useState({ p1: 0, p2: 0 });
  const [paused, setPaused] = useState(false);
  const [winner, setWinner] = useState<'p1' | 'p2' | null>(null);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('CLASSIC');
  const [isPortrait, setIsPortrait] = useState(false);
  const [muted, setMuted] = useState(() => retroAudio.isMuted());

  const simRef = useRef(createInitialSimState('VS_BOT'));
  const botRef = useRef(createBotState());
  const pausedRef = useRef(paused);
  const difficultyRef = useRef(difficulty);
  pausedRef.current = paused;
  difficultyRef.current = difficulty;

  const { onPointerTargetV, getInput } = usePongControls(!paused && winner === null, isPortrait);
  const getInputRef = useRef(getInput);
  getInputRef.current = getInput;

  const resetMatch = useCallback(() => {
    retroAudio.unlock();
    simRef.current = createInitialSimState('VS_BOT');
    botRef.current = createBotState();
    setScores({ p1: 0, p2: 0 });
    setWinner(null);
    setPaused(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (winner === null) {
          setPaused((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [winner]);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const sim = simRef.current;
      if (!pausedRef.current && sim.winner === null) {
        const playerInput = getInputRef.current();
        const botInput = updateBotInput(botRef.current, sim, dt, difficultyRef.current, 'p2');

        const stepResult = stepPongSimulation(
          sim,
          {
            p1Dir: playerInput.moveDir,
            p1TargetV: playerInput.targetV,
            p2Dir: botInput.moveDir,
            p2TargetV: null,
          },
          dt,
          botInput.maxSpeed
        );

        for (const ev of stepResult.events) {
          retroAudio.play(ev);
        }

        if (stepResult.scoredBy !== null) {
          setScores({ p1: sim.p1Score, p2: sim.p2Score });
          if (stepResult.scoredBy === 'p1') {
            onScoreCandidate(sim.p1Score);
          }
        }

        if (sim.winner !== null) {
          setWinner(sim.winner);
          onScoreCandidate(sim.p1Score);
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
      mode: 'VS_BOT',
      ballU: s.ballU,
      ballV: s.ballV,
      p1V: s.p1V,
      p2V: s.p2V,
      dimmed: paused || winner !== null,
    };
  }, [paused, winner]);

  const toggleMute = () => {
    const next = !muted;
    retroAudio.setMuted(next);
    setMuted(next);
    if (!next) retroAudio.unlock();
  };

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

        <div className="flex items-center gap-3 sm:gap-6 font-arcade text-sm sm:text-xl tracking-wider">
          <div className="flex items-center gap-2">
            <span className="font-mono-arcade text-[10px] sm:text-xs text-white/60">YOU</span>
            <span>{String(scores.p1).padStart(2, '0')}</span>
          </div>
          <span className="text-white/40">:</span>
          <div className="flex items-center gap-2">
            <span>{String(scores.p2).padStart(2, '0')}</span>
            <span className="font-mono-arcade text-[10px] sm:text-xs text-white/60">BOT</span>
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
            disabled={winner !== null}
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
            interactive={!paused && winner === null}
            onPointerTargetV={onPointerTargetV}
            onOrientationChange={setIsPortrait}
          />
        </div>

        {/* Pause Overlay */}
        {paused && winner === null && (
          <div className="absolute inset-0 z-20 bg-black/85 flex items-center justify-center p-4">
            <div className="w-full max-w-xs border-2 border-white bg-black p-6 flex flex-col items-center text-center gap-5">
              <h2 className="font-arcade text-xl tracking-[0.15em]">PAUSED</h2>

              <div className="w-full flex flex-col gap-2">
                <span className="font-mono-arcade text-[11px] tracking-widest text-white/70 uppercase">
                  BOT DIFFICULTY
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['EASY', 'CLASSIC', 'HARD'] as BotDifficulty[]).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setDifficulty(lvl)}
                      className={`min-h-[44px] px-2 font-mono-arcade text-xs border transition-colors cursor-pointer ${
                        difficulty === lvl
                          ? 'bg-white text-black border-white font-bold'
                          : 'bg-black text-white border-white/40 hover:border-white'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>

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
                  onClick={resetMatch}
                  className="w-full min-h-[48px] border-2 border-white bg-black text-white font-arcade text-xs tracking-wider hover:bg-white hover:text-black transition-colors cursor-pointer"
                >
                  RESTART
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

        {/* Game Over Overlay */}
        {winner !== null && (
          <div className="absolute inset-0 z-20 bg-black/85 flex items-center justify-center p-4">
            <div className="w-full max-w-xs border-2 border-white bg-black p-6 flex flex-col items-center text-center gap-5">
              <h2 className="font-arcade text-xl sm:text-2xl tracking-[0.14em]">
                {winner === 'p1' ? 'YOU WIN' : 'BOT WINS'}
              </h2>
              <p className="font-arcade text-lg tracking-widest">
                {scores.p1} - {scores.p2}
              </p>
              <p className="font-mono-arcade text-xs text-white/70">
                FIRST TO {WIN_SCORE} POINTS
              </p>
              <div className="w-full flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={resetMatch}
                  className="w-full min-h-[48px] border-2 border-white bg-white text-black font-arcade text-xs tracking-wider hover:bg-black hover:text-white transition-colors cursor-pointer"
                >
                  RESTART
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
        {isPortrait ? 'DRAG ON COURT OR USE LEFT/RIGHT KEYS' : 'DRAG ON COURT OR USE W/S OR UP/DOWN KEYS'} · FIRST TO {WIN_SCORE}
      </footer>
    </div>
  );
}
