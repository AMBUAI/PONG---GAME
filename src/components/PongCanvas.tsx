import { useEffect, useRef } from 'react';
import {
  BALL_SIZE,
  COURT_LENGTH,
  COURT_WIDTH,
  type GameMode,
  PADDLE_LENGTH,
  PADDLE_MARGIN,
  PADDLE_THICKNESS,
  WALL_THICKNESS,
  clamp,
} from '../shared/pongTypes.ts';

export interface RenderFrameState {
  mode: GameMode;
  ballU: number;
  ballV: number;
  p1V: number;
  p2V: number;
  mirrorU?: boolean;
  dimmed?: boolean;
  hideBall?: boolean;
}

interface PongCanvasProps {
  getFrameState: () => RenderFrameState;
  interactive?: boolean;
  onPointerTargetV?: (targetV: number | null) => void;
  onOrientationChange?: (isPortrait: boolean) => void;
  className?: string;
}

export function PongCanvas({
  getFrameState,
  interactive = true,
  onPointerTargetV,
  onOrientationChange,
  className = '',
}: PongCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const getFrameStateRef = useRef(getFrameState);
  const onPointerTargetRef = useRef(onPointerTargetV);
  const onOrientationRef = useRef(onOrientationChange);

  getFrameStateRef.current = getFrameState;
  onPointerTargetRef.current = onPointerTargetV;
  onOrientationRef.current = onOrientationChange;

  const layoutRef = useRef({
    isPortrait: false,
    canvasW: 800,
    canvasH: 500,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(120, Math.floor(rect.width));
      const height = Math.max(120, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

      const isPortrait = height > width * 1.05;
      const logicalW = isPortrait ? COURT_WIDTH : COURT_LENGTH;
      const logicalH = isPortrait ? COURT_LENGTH : COURT_WIDTH;
      const scale = Math.min(width / logicalW, height / logicalH);
      const drawW = logicalW * scale;
      const drawH = logicalH * scale;
      const offsetX = (width - drawW) / 2;
      const offsetY = (height - drawH) / 2;

      if (layoutRef.current.isPortrait !== isPortrait) {
        onOrientationRef.current?.(isPortrait);
      }

      layoutRef.current = {
        isPortrait,
        canvasW: width,
        canvasH: height,
        scale,
        offsetX,
        offsetY,
      };

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    window.addEventListener('orientationchange', updateSize);

    let rafId = 0;
    const render = () => {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const { isPortrait, canvasW, canvasH, scale, offsetX, offsetY } = layoutRef.current;
        const frame = getFrameStateRef.current();

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvasW, canvasH);

        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        const logicalW = isPortrait ? COURT_WIDTH : COURT_LENGTH;
        const logicalH = isPortrait ? COURT_LENGTH : COURT_WIDTH;

        // Subtle outer court border
        ctx.strokeStyle = frame.dimmed ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, logicalW - 2, logicalH - 2);

        const white = frame.dimmed ? 'rgba(255,255,255,0.38)' : '#FFFFFF';
        const netWhite = frame.dimmed ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.35)';

        // Center net (for non-training modes)
        if (frame.mode !== 'TRAINING') {
          ctx.fillStyle = netWhite;
          const dashLen = 14;
          const gapLen = 14;
          const thickness = 4;
          if (isPortrait) {
            const yMid = COURT_LENGTH / 2 - thickness / 2;
            for (let x = 14; x < COURT_WIDTH - 14; x += dashLen + gapLen) {
              ctx.fillRect(x, yMid, dashLen, thickness);
            }
          } else {
            const xMid = COURT_LENGTH / 2 - thickness / 2;
            for (let y = 14; y < COURT_WIDTH - 14; y += dashLen + gapLen) {
              ctx.fillRect(xMid, y, thickness, dashLen);
            }
          }
        }

        const mirror = Boolean(frame.mirrorU);
        const mapU = (u: number) => (mirror ? COURT_LENGTH - u : u);

        const p1U = mapU(PADDLE_MARGIN);
        const p2U = mapU(COURT_LENGTH - PADDLE_MARGIN);
        const ballU = mapU(frame.ballU);
        const ballV = frame.ballV;

        ctx.fillStyle = white;

        if (isPortrait) {
          // Player 1 (or local player when mirrored) is at BOTTOM: u = 0 -> bottom (COURT_LENGTH), u = 800 -> top (0)
          const toScreenY = (uVal: number) => COURT_LENGTH - uVal;

          // P1 paddle (bottom)
          ctx.fillRect(
            frame.p1V - PADDLE_LENGTH / 2,
            toScreenY(p1U) - PADDLE_THICKNESS / 2,
            PADDLE_LENGTH,
            PADDLE_THICKNESS
          );

          // Opponent paddle or Training wall (top)
          if (frame.mode === 'TRAINING') {
            ctx.fillRect(0, 0, COURT_WIDTH, WALL_THICKNESS);
          } else {
            ctx.fillRect(
              frame.p2V - PADDLE_LENGTH / 2,
              toScreenY(p2U) - PADDLE_THICKNESS / 2,
              PADDLE_LENGTH,
              PADDLE_THICKNESS
            );
          }

          // Ball
          if (!frame.hideBall) {
            ctx.fillRect(
              ballV - BALL_SIZE / 2,
              toScreenY(ballU) - BALL_SIZE / 2,
              BALL_SIZE,
              BALL_SIZE
            );
          }
        } else {
          // Landscape: u = 0 -> left, u = 800 -> right
          // P1 paddle (left)
          ctx.fillRect(
            p1U - PADDLE_THICKNESS / 2,
            frame.p1V - PADDLE_LENGTH / 2,
            PADDLE_THICKNESS,
            PADDLE_LENGTH
          );

          // Opponent paddle or Training wall (right)
          if (frame.mode === 'TRAINING') {
            ctx.fillRect(COURT_LENGTH - WALL_THICKNESS, 0, WALL_THICKNESS, COURT_WIDTH);
          } else {
            ctx.fillRect(
              p2U - PADDLE_THICKNESS / 2,
              frame.p2V - PADDLE_LENGTH / 2,
              PADDLE_THICKNESS,
              PADDLE_LENGTH
            );
          }

          // Ball
          if (!frame.hideBall) {
            ctx.fillRect(ballU - BALL_SIZE / 2, ballV - BALL_SIZE / 2, BALL_SIZE, BALL_SIZE);
          }
        }

        ctx.restore();
      }
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('orientationchange', updateSize);
    };
  }, []);

  const mapClientToV = (clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { isPortrait, scale, offsetX, offsetY } = layoutRef.current;
    if (scale <= 0) return null;

    const rawV = isPortrait
      ? (clientX - rect.left - offsetX) / scale
      : (clientY - rect.top - offsetY) / scale;

    return clamp(rawV, PADDLE_LENGTH / 2, COURT_WIDTH - PADDLE_LENGTH / 2);
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden ${interactive ? 'touch-arena cursor-pointer' : 'pointer-events-none'} ${className}`}
      onPointerDown={
        interactive
          ? (e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const v = mapClientToV(e.clientX, e.clientY);
              if (v !== null) onPointerTargetRef.current?.(v);
            }
          : undefined
      }
      onPointerMove={
        interactive
          ? (e) => {
              if (e.buttons === 0 && e.pointerType === 'mouse') return;
              const v = mapClientToV(e.clientX, e.clientY);
              if (v !== null) onPointerTargetRef.current?.(v);
            }
          : undefined
      }
      onPointerUp={
        interactive
          ? () => {
              onPointerTargetRef.current?.(null);
            }
          : undefined
      }
      onPointerCancel={
        interactive
          ? () => {
              onPointerTargetRef.current?.(null);
            }
          : undefined
      }
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
