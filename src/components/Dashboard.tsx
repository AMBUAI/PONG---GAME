import { useCallback, useEffect, useRef } from 'react';
import { createBotState, updateBotInput } from '../shared/pongBot.ts';
import { createInitialSimState, stepPongSimulation } from '../shared/pongEngine.ts';
import { PongCanvas, type RenderFrameState } from './PongCanvas.tsx';
import { PWAInstallButton } from './PWAControls.tsx';

interface DashboardProps {
  highScore: number;
  onSelectVsBot: () => void;
  onSelectTraining: () => void;
  onSelectOnline: () => void;
}

export function Dashboard({
  highScore,
  onSelectVsBot,
  onSelectTraining,
  onSelectOnline,
}: DashboardProps) {
  const simRef = useRef(createInitialSimState('ATTRACT'));
  const leftBotRef = useRef(createBotState());
  const rightBotRef = useRef(createBotState());

  useEffect(() => {
    simRef.current = createInitialSimState('ATTRACT');
    leftBotRef.current = createBotState();
    rightBotRef.current = createBotState();

    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const sim = simRef.current;
      const p1Bot = updateBotInput(leftBotRef.current, sim, dt, 'CLASSIC', 'p1');
      const p2Bot = updateBotInput(rightBotRef.current, sim, dt, 'CLASSIC', 'p2');

      stepPongSimulation(
        sim,
        {
          p1Dir: p1Bot.moveDir,
          p1TargetV: null,
          p2Dir: p2Bot.moveDir,
          p2TargetV: null,
        },
        dt,
        p2Bot.maxSpeed
      );

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, []);

  const getFrameState = useCallback((): RenderFrameState => {
    const s = simRef.current;
    return {
      mode: 'ATTRACT',
      ballU: s.ballU,
      ballV: s.ballV,
      p1V: s.p1V,
      p2V: s.p2V,
      dimmed: true,
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-black text-white flex items-center justify-center overflow-hidden">
      {/* Live miniature background Pong simulation */}
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-10 pointer-events-none">
        <div className="w-full h-full max-w-5xl max-h-[78vh]">
          <PongCanvas getFrameState={getFrameState} interactive={false} />
        </div>
      </div>

      {/* Minimalist foreground menu */}
      <main className="relative z-10 w-full max-w-sm px-6 py-8 flex flex-col items-center text-center bg-black/70">
        <h1 className="font-arcade text-4xl sm:text-5xl tracking-[0.18em] text-white mb-4 select-none">
          PONG
        </h1>

        <p className="font-mono-arcade text-xs sm:text-sm tracking-[0.2em] text-white/80 uppercase mb-10">
          HIGH SCORE {highScore}
        </p>

        <nav aria-label="Game Modes" className="w-full flex flex-col gap-3.5">
          <button
            type="button"
            onClick={onSelectVsBot}
            className="w-full min-h-[52px] px-6 py-3.5 border-2 border-white bg-black text-white font-arcade text-xs sm:text-sm tracking-[0.14em] uppercase transition-colors duration-150 hover:bg-white hover:text-black active:bg-white active:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap"
          >
            VS BOT
          </button>

          <button
            type="button"
            onClick={onSelectTraining}
            className="w-full min-h-[52px] px-6 py-3.5 border-2 border-white bg-black text-white font-arcade text-xs sm:text-sm tracking-[0.14em] uppercase transition-colors duration-150 hover:bg-white hover:text-black active:bg-white active:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap"
          >
            TRAINING
          </button>

          <button
            type="button"
            onClick={onSelectOnline}
            className="w-full min-h-[52px] px-6 py-3.5 border-2 border-white bg-black text-white font-arcade text-xs sm:text-sm tracking-[0.14em] uppercase transition-colors duration-150 hover:bg-white hover:text-black active:bg-white active:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer whitespace-nowrap"
          >
            ONLINE MULTIPLAYER
          </button>
        </nav>

        <div className="mt-6">
          <PWAInstallButton />
        </div>
      </main>
    </div>
  );
}
