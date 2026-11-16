import { useState } from 'react';
import { Download } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall.ts';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="min-h-[44px] px-4 py-2 border border-white/70 bg-black text-white font-mono-arcade text-xs tracking-wider uppercase flex items-center justify-center gap-2 hover:bg-white hover:text-black transition-colors cursor-pointer whitespace-nowrap"
      >
        <Download className="w-3.5 h-3.5" />
        <span>INSTALL APP</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[44px] px-4 py-2 border border-white/70 bg-black text-white font-mono-arcade text-xs tracking-wider uppercase flex items-center justify-center gap-2 hover:bg-white hover:text-black transition-colors cursor-pointer whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          <span>INSTALL ON IOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
            <div className="w-full max-w-xs border-2 border-white bg-black p-6 text-center flex flex-col gap-4">
              <h3 className="font-arcade text-sm tracking-wider">INSTALL PONG</h3>
              <p className="font-mono-arcade text-xs text-white/85 leading-relaxed">
                1. TAP THE SHARE ICON IN SAFARI.
                <br />
                2. TAP &quot;ADD TO HOME SCREEN&quot;.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[44px] border-2 border-white bg-white text-black font-arcade text-xs tracking-wider hover:bg-black hover:text-white transition-colors cursor-pointer"
              >
                CLOSE
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-3 left-3 z-40 border border-white/70 bg-black px-3 py-1.5 font-mono-arcade text-[11px] tracking-wider text-white uppercase pointer-events-none"
    >
      OFFLINE · VS BOT &amp; TRAINING READY
    </div>
  );
}
