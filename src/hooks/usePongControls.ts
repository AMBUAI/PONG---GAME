import { useCallback, useEffect, useRef } from 'react';

export interface PaddleInputState {
  moveDir: -1 | 0 | 1;
  targetV: number | null;
}

export function usePongControls(enabled: boolean, isPortrait: boolean) {
  const keysRef = useRef({
    neg: false,
    pos: false,
  });
  const pointerTargetRef = useRef<number | null>(null);
  const isPortraitRef = useRef(isPortrait);
  isPortraitRef.current = isPortrait;

  useEffect(() => {
    if (!enabled) {
      keysRef.current.neg = false;
      keysRef.current.pos = false;
      pointerTargetRef.current = null;
      return;
    }

    const updateKey = (code: string, pressed: boolean): boolean => {
      if (isPortraitRef.current) {
        if (code === 'ArrowLeft' || code === 'KeyA' || code === 'ArrowUp' || code === 'KeyW') {
          keysRef.current.neg = pressed;
          return true;
        }
        if (code === 'ArrowRight' || code === 'KeyD' || code === 'ArrowDown' || code === 'KeyS') {
          keysRef.current.pos = pressed;
          return true;
        }
      } else {
        if (code === 'ArrowUp' || code === 'KeyW' || code === 'ArrowLeft' || code === 'KeyA') {
          keysRef.current.neg = pressed;
          return true;
        }
        if (code === 'ArrowDown' || code === 'KeyS' || code === 'ArrowRight' || code === 'KeyD') {
          keysRef.current.pos = pressed;
          return true;
        }
      }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (updateKey(e.code, true)) {
        // Clear pointer target when keyboard takes over
        pointerTargetRef.current = null;
        e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      updateKey(e.code, false);
    };

    const onBlur = () => {
      keysRef.current.neg = false;
      keysRef.current.pos = false;
      pointerTargetRef.current = null;
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled]);

  const onPointerTargetV = useCallback((v: number | null) => {
    pointerTargetRef.current = v;
  }, []);

  const getInput = useCallback((): PaddleInputState => {
    const neg = keysRef.current.neg;
    const pos = keysRef.current.pos;
    const moveDir: -1 | 0 | 1 = neg && !pos ? -1 : pos && !neg ? 1 : 0;
    return {
      moveDir,
      targetV: pointerTargetRef.current,
    };
  }, []);

  return { onPointerTargetV, getInput };
}
