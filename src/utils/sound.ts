import type { SoundEvent } from '../shared/pongTypes.ts';

class RetroAudio {
  private ctx: AudioContext | null = null;
  private muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock(): void {
    this.ensureContext();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  private tone(freq: number, durationSec: number, gainPeak = 0.08, delaySec = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.01);
  }

  public play(event: SoundEvent): void {
    if (this.muted) return;
    switch (event) {
      case 'paddle':
        this.tone(480, 0.055, 0.07);
        break;
      case 'wall':
        this.tone(260, 0.045, 0.05);
        break;
      case 'score':
        this.tone(180, 0.14, 0.08);
        break;
      case 'speedup':
        this.tone(520, 0.07, 0.07, 0);
        this.tone(780, 0.1, 0.08, 0.075);
        break;
      case 'win':
        this.tone(440, 0.08, 0.07, 0);
        this.tone(554, 0.08, 0.07, 0.09);
        this.tone(659, 0.16, 0.08, 0.18);
        break;
      case 'lose':
        this.tone(260, 0.1, 0.07, 0);
        this.tone(175, 0.18, 0.07, 0.11);
        break;
    }
  }
}

export const retroAudio = new RetroAudio();
