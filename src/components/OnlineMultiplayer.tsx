import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Volume2, VolumeX } from 'lucide-react';
import { usePongControls } from '../hooks/usePongControls.ts';
import {
  BALL_SIZE,
  COURT_LENGTH,
  COURT_WIDTH,
  type ClientToServerMessage,
  type PlayerRole,
  type RoomSnapshot,
  type ServerToClientMessage,
  WIN_SCORE,
  clamp,
  computeMajorityNeeded,
} from '../shared/pongTypes.ts';
import { retroAudio } from '../utils/sound.ts';
import { PongCanvas, type RenderFrameState } from './PongCanvas.tsx';

interface OnlineMultiplayerProps {
  onExit: () => void;
}

type OnlineView = 'MENU' | 'HOST_LOADING' | 'JOIN_FORM' | 'ROOM';

const SESSION_KEY = 'retro_pong_active_room';

interface SavedRoomSession {
  roomCode: string;
  playerToken: string;
}

function saveTempSession(session: SavedRoomSession | null): void {
  try {
    if (!session) {
      window.sessionStorage.removeItem(SESSION_KEY);
    } else {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage errors
  }
}

function loadTempSession(): SavedRoomSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedRoomSession>;
    if (
      typeof parsed.roomCode === 'string' &&
      typeof parsed.playerToken === 'string' &&
      parsed.roomCode.length === 6 &&
      parsed.playerToken.length > 0
    ) {
      return { roomCode: parsed.roomCode, playerToken: parsed.playerToken };
    }
    return null;
  } catch {
    return null;
  }
}

export function OnlineMultiplayer({ onExit }: OnlineMultiplayerProps) {
  const [view, setView] = useState<OnlineView>('MENU');
  const [joinCode, setJoinCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [role, setRole] = useState<PlayerRole | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [copied, setCopied] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [muted, setMuted] = useState(() => retroAudio.isMuted());
  const [clockNow, setClockNow] = useState(() => Date.now());

  const viewRef = useRef<OnlineView>(view);
  viewRef.current = view;

  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<SavedRoomSession | null>(null);
  const intentionalCloseRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActionRef = useRef<ClientToServerMessage | null>(null);

  // Latest authoritative snapshot + receive timestamp for smooth frame interpolation
  const latestSnapshotRef = useRef<{ snap: RoomSnapshot; receivedAt: number } | null>(null);
  const serverOffsetMsRef = useRef(0);

  const isPlaying = snapshot?.status === 'PLAYING' || snapshot?.status === 'RESUMING';
  const { onPointerTargetV, getInput } = usePongControls(isPlaying, isPortrait);
  const getInputRef = useRef(getInput);
  getInputRef.current = getInput;

  const sendMsg = useCallback((msg: ClientToServerMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const cleanupAndExit = useCallback(() => {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'leave_room' }));
      wsRef.current.close();
    } else {
      wsRef.current?.close();
    }
    wsRef.current = null;
    sessionRef.current = null;
    saveTempSession(null);
    onExit();
  }, [onExit]);

  const connectWebSocket = useCallback(
    (onOpenAction?: ClientToServerMessage) => {
      if (onOpenAction) {
        lastActionRef.current = onOpenAction;
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        if (onOpenAction) {
          wsRef.current.send(JSON.stringify(onOpenAction));
        }
        return;
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
        return;
      }

      intentionalCloseRef.current = false;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setSocketReady(true);
        setReconnecting(false);

        const activeSession = sessionRef.current;
        if (activeSession) {
          ws.send(
            JSON.stringify({
              type: 'reconnect_room',
              roomCode: activeSession.roomCode,
              playerToken: activeSession.playerToken,
            })
          );
          return;
        }

        if (lastActionRef.current) {
          const pending = lastActionRef.current;
          lastActionRef.current = null;
          ws.send(JSON.stringify(pending));
        }
      };

      ws.onmessage = (event) => {
        let msg: ServerToClientMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerToClientMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'room_joined': {
            const newSession: SavedRoomSession = {
              roomCode: msg.roomCode,
              playerToken: msg.playerToken,
            };
            sessionRef.current = newSession;
            saveTempSession(newSession);
            serverOffsetMsRef.current = msg.snapshot.serverTime - Date.now();
            latestSnapshotRef.current = { snap: msg.snapshot, receivedAt: performance.now() };
            setRole(msg.role);
            setSnapshot(msg.snapshot);
            setErrorMsg(null);
            setClosedReason(null);
            setView('ROOM');
            break;
          }
          case 'room_state': {
            serverOffsetMsRef.current = msg.snapshot.serverTime - Date.now();
            latestSnapshotRef.current = { snap: msg.snapshot, receivedAt: performance.now() };
            setSnapshot(msg.snapshot);
            if (msg.snapshot.events) {
              for (const ev of msg.snapshot.events) {
                retroAudio.play(ev);
              }
            }
            break;
          }
          case 'room_error': {
            setErrorMsg(msg.message);
            if (
              msg.code === 'EXPIRED' ||
              msg.code === 'INVALID_SESSION' ||
              msg.code === 'NOT_FOUND'
            ) {
              sessionRef.current = null;
              saveTempSession(null);
            }
            if (viewRef.current === 'HOST_LOADING') {
              setView('MENU');
            }
            break;
          }
          case 'room_closed': {
            sessionRef.current = null;
            saveTempSession(null);
            setClosedReason(msg.reason);
            setSnapshot(null);
            break;
          }
          case 'pong': {
            serverOffsetMsRef.current = msg.serverTime - Date.now();
            break;
          }
        }
      };

      ws.onclose = () => {
        setSocketReady(false);
        if (intentionalCloseRef.current) return;

        // If we are in an active room, attempt automatic reconnection
        if (sessionRef.current) {
          setReconnecting(true);
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            connectWebSocket();
          }, 1000);
        }
      };

      ws.onerror = () => {
        // Handled by onclose
      };
    },
    []
  );

  // Resume an interrupted session if user refreshed mid-match in same tab
  useEffect(() => {
    const saved = loadTempSession();
    if (saved) {
      sessionRef.current = saved;
      setView('ROOM');
      setReconnecting(true);
      connectWebSocket();
    }

    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connectWebSocket]);

  // Countdown tick for timers (grace period, intermissions, rematch timeout)
  useEffect(() => {
    const id = setInterval(() => {
      setClockNow(Date.now() + serverOffsetMsRef.current);
    }, 200);
    return () => clearInterval(id);
  }, []);

  // Stream player paddle input to server while match is active
  useEffect(() => {
    if (!isPlaying || !socketReady) return;
    let lastSentTarget: number | null = null;
    let lastSentDir: -1 | 0 | 1 = 0;
    let lastSentTime = 0;

    const id = setInterval(() => {
      const input = getInputRef.current();
      const now = performance.now();
      const changed = input.targetV !== lastSentTarget || input.moveDir !== lastSentDir;
      if (changed || now - lastSentTime >= 50) {
        lastSentTarget = input.targetV;
        lastSentDir = input.moveDir;
        lastSentTime = now;
        sendMsg({
          type: 'paddle_input',
          targetV: input.targetV,
          moveDir: input.moveDir,
        });
      }
    }, 16);

    return () => clearInterval(id);
  }, [isPlaying, socketReady, sendMsg]);

  const handleHostSelect = () => {
    retroAudio.unlock();
    setErrorMsg(null);
    setClosedReason(null);
    sessionRef.current = null;
    saveTempSession(null);
    setView('HOST_LOADING');
    connectWebSocket({ type: 'create_room' });
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    retroAudio.unlock();
    const normalized = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
      setErrorMsg('ENTER A VALID 6-CHARACTER ALPHANUMERIC CODE.');
      return;
    }
    setErrorMsg(null);
    setClosedReason(null);
    sessionRef.current = null;
    saveTempSession(null);
    connectWebSocket({ type: 'join_room', roomCode: normalized });
  };

  const handleCopyCode = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(snapshot.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback if clipboard blocked
    }
  };

  const getFrameState = useCallback((): RenderFrameState => {
    const latest = latestSnapshotRef.current;
    if (!latest) {
      return {
        mode: 'ONLINE',
        ballU: COURT_LENGTH / 2,
        ballV: COURT_WIDTH / 2,
        p1V: COURT_WIDTH / 2,
        p2V: COURT_WIDTH / 2,
        mirrorU: role === 'guest',
        dimmed: true,
      };
    }

    const { snap, receivedAt } = latest;
    const elapsedSec =
      snap.status === 'PLAYING' && snap.serveTimer <= 0
        ? Math.min((performance.now() - receivedAt) / 1000, 0.045)
        : 0;

    const halfBall = BALL_SIZE / 2;
    const ballU = clamp(snap.ballU + snap.ballVu * elapsedSec, halfBall, COURT_LENGTH - halfBall);
    const ballV = clamp(snap.ballV + snap.ballVv * elapsedSec, halfBall, COURT_WIDTH - halfBall);

    return {
      mode: 'ONLINE',
      ballU,
      ballV,
      p1V: snap.p1V,
      p2V: snap.p2V,
      mirrorU: role === 'guest',
      dimmed: snap.status !== 'PLAYING',
    };
  }, [role]);

  const toggleMute = () => {
    const next = !muted;
    retroAudio.setMuted(next);
    setMuted(next);
    if (!next) retroAudio.unlock();
  };

  const secondsLeft = (targetMs: number | null): number => {
    if (!targetMs) return 0;
    return Math.max(0, Math.ceil((targetMs - clockNow) / 1000));
  };

  // Room closed notice screen (e.g., Rematch declined or Host left lobby)
  if (closedReason) {
    return (
      <div className="w-full h-full bg-black text-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm border-2 border-white bg-black p-6 flex flex-col items-center text-center gap-5">
          <h2 className="font-arcade text-lg tracking-[0.14em]">ROOM CLOSED</h2>
          <p className="font-mono-arcade text-xs text-white/80 tracking-wider">{closedReason}</p>
          <button
            type="button"
            onClick={() => {
              setClosedReason(null);
              onExit();
            }}
            className="w-full min-h-[48px] border-2 border-white bg-white text-black font-arcade text-xs tracking-wider hover:bg-black hover:text-white transition-colors cursor-pointer"
          >
            DASHBOARD
          </button>
        </div>
      </div>
    );
  }

  // Menu: Exactly two primary options: HOST and JOIN
  if (view === 'MENU') {
    return (
      <div className="w-full h-full bg-black text-white flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <h1 className="font-arcade text-xl sm:text-2xl tracking-[0.14em] mb-3">
            ONLINE MULTIPLAYER
          </h1>
          <p className="font-mono-arcade text-xs text-white/65 tracking-wider mb-10">
            REAL-TIME 1V1 MATCH
          </p>

          <div className="w-full flex flex-col gap-3.5">
            <button
              type="button"
              onClick={handleHostSelect}
              className="w-full min-h-[52px] px-6 py-3.5 border-2 border-white bg-black text-white font-arcade text-xs sm:text-sm tracking-[0.14em] hover:bg-white hover:text-black transition-colors cursor-pointer"
            >
              HOST
            </button>
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setJoinCode('');
                setView('JOIN_FORM');
              }}
              className="w-full min-h-[52px] px-6 py-3.5 border-2 border-white bg-black text-white font-arcade text-xs sm:text-sm tracking-[0.14em] hover:bg-white hover:text-black transition-colors cursor-pointer"
            >
              JOIN
            </button>
            <button
              type="button"
              onClick={cleanupAndExit}
              className="w-full min-h-[48px] mt-4 px-6 py-3 border border-white/50 bg-black text-white font-mono-arcade text-xs tracking-[0.15em] hover:bg-white hover:text-black transition-colors cursor-pointer"
            >
              BACK TO DASHBOARD
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'HOST_LOADING') {
    return (
      <div className="w-full h-full bg-black text-white flex flex-col items-center justify-center p-6 gap-6">
        <p className="font-arcade text-sm tracking-[0.15em]">CREATING ROOM...</p>
        <button
          type="button"
          onClick={() => setView('MENU')}
          className="min-h-[44px] px-5 border border-white/50 font-mono-arcade text-xs tracking-wider hover:bg-white hover:text-black transition-colors cursor-pointer"
        >
          CANCEL
        </button>
      </div>
    );
  }

  if (view === 'JOIN_FORM') {
    return (
      <div className="w-full h-full bg-black text-white flex flex-col items-center justify-center p-6">
        <form
          onSubmit={handleJoinSubmit}
          className="w-full max-w-sm border-2 border-white bg-black p-6 flex flex-col items-center text-center gap-5"
        >
          <h2 className="font-arcade text-lg tracking-[0.14em]">JOIN ROOM</h2>
          <p className="font-mono-arcade text-xs text-white/70">
            ENTER 6-CHARACTER ROOM CODE
          </p>

          <input
            type="text"
            value={joinCode}
            onChange={(e) => {
              setErrorMsg(null);
              setJoinCode(e.target.value.toUpperCase());
            }}
            placeholder="A1B2C3"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            className="w-full min-h-[52px] px-4 border-2 border-white bg-black text-white text-center font-arcade text-lg tracking-[0.25em] uppercase placeholder:text-white/25 focus:outline-none"
          />

          {errorMsg && (
            <p role="alert" className="font-mono-arcade text-xs text-white border border-white/60 px-3 py-2 w-full">
              {errorMsg}
            </p>
          )}

          <div className="w-full flex flex-col gap-2.5">
            <button
              type="submit"
              className="w-full min-h-[48px] border-2 border-white bg-white text-black font-arcade text-xs tracking-[0.14em] hover:bg-black hover:text-white transition-colors cursor-pointer"
            >
              CONNECT
            </button>
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setView('MENU');
              }}
              className="w-full min-h-[44px] border border-white/50 bg-black text-white font-mono-arcade text-xs tracking-wider hover:bg-white hover:text-black transition-colors cursor-pointer"
            >
              BACK
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Reconnecting before snapshot is loaded (e.g. tab refresh)
  if (!snapshot) {
    return (
      <div className="w-full h-full bg-black text-white flex flex-col items-center justify-center p-6 gap-5 text-center">
        <p className="font-arcade text-sm tracking-[0.14em]">
          {reconnecting ? 'RECONNECTING TO MATCH...' : 'CONNECTING...'}
        </p>
        {errorMsg && <p className="font-mono-arcade text-xs text-white/80">{errorMsg}</p>}
        <button
          type="button"
          onClick={cleanupAndExit}
          className="min-h-[44px] px-5 border border-white/50 font-mono-arcade text-xs tracking-wider hover:bg-white hover:text-black transition-colors cursor-pointer"
        >
          DASHBOARD
        </button>
      </div>
    );
  }

  const majorityNeeded = computeMajorityNeeded(snapshot.seriesLength);
  const isHost = role === 'host';
  const myScore = isHost ? snapshot.p1Score : snapshot.p2Score;
  const oppScore = isHost ? snapshot.p2Score : snapshot.p1Score;
  const myGames = isHost ? snapshot.p1Games : snapshot.p2Games;
  const oppGames = isHost ? snapshot.p2Games : snapshot.p1Games;

  // LOBBY VIEW
  if (snapshot.status === 'LOBBY') {
    const canStart = isHost && snapshot.hostConnected && snapshot.guestConnected;

    return (
      <div className="w-full h-full bg-black text-white overflow-y-auto flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md border-2 border-white bg-black p-5 sm:p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3 border-b border-white/25 pb-3">
            <span className="font-arcade text-xs sm:text-sm tracking-[0.14em]">
              {isHost ? 'HOST LOBBY' : 'GUEST LOBBY'}
            </span>
            <button
              type="button"
              onClick={cleanupAndExit}
              className="min-h-[44px] px-3 border border-white/50 font-mono-arcade text-xs tracking-wider hover:bg-white hover:text-black transition-colors cursor-pointer"
            >
              LEAVE
            </button>
          </div>

          {/* Room Code Display */}
          <div className="flex flex-col items-center text-center gap-2.5 py-2 border border-white/30 px-4">
            <span className="font-mono-arcade text-[11px] text-white/65 tracking-widest uppercase">
              ROOM CODE
            </span>
            <div className="font-arcade text-2xl sm:text-3xl tracking-[0.28em]">
              {snapshot.roomCode}
            </div>
            {isHost && (
              <button
                type="button"
                onClick={handleCopyCode}
                className="min-h-[44px] px-4 border border-white/60 flex items-center gap-2 font-mono-arcade text-xs tracking-wider hover:bg-white hover:text-black transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'COPIED' : 'COPY CODE'}</span>
              </button>
            )}
          </div>

          {/* Series Length Selector (Host) or Display (Guest) */}
          <div className="flex flex-col gap-2">
            <span className="font-mono-arcade text-[11px] text-white/70 tracking-wider uppercase">
              SERIES LENGTH: BEST OF {snapshot.seriesLength}
            </span>
            {isHost ? (
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((len) => (
                  <button
                    key={len}
                    type="button"
                    onClick={() => sendMsg({ type: 'set_series_length', seriesLength: len })}
                    className={`min-h-[44px] font-mono-arcade text-xs border transition-colors cursor-pointer ${
                      snapshot.seriesLength === len
                        ? 'bg-white text-black border-white font-bold'
                        : 'bg-black text-white border-white/40 hover:border-white'
                    }`}
                  >
                    {len}
                  </button>
                ))}
              </div>
            ) : (
              <div className="border border-white/30 px-3 py-2 font-mono-arcade text-xs">
                HOST SELECTED: {snapshot.seriesLength}{' '}
                {snapshot.seriesLength === 1 ? 'GAME' : 'GAMES'}
              </div>
            )}
          </div>

          {/* Explicit Series Rules */}
          <div className="border border-white/25 p-3.5 flex flex-col gap-1.5 font-mono-arcade text-[11px] sm:text-xs text-white/80 leading-relaxed">
            <p className="text-white font-bold tracking-wider">SERIES RULES</p>
            <p>• MAX {snapshot.seriesLength} {snapshot.seriesLength === 1 ? 'GAME' : 'GAMES'} IN SERIES</p>
            <p>• FIRST TO {WIN_SCORE} POINTS WINS EACH GAME (NO DEUCE)</p>
            <p>• FIRST TO {majorityNeeded} GAME {majorityNeeded === 1 ? 'WIN' : 'WINS'} SECURES THE SERIES IMMEDIATELY</p>
            {snapshot.seriesLength % 2 === 0 && (
              <p>
                • IF TIED {snapshot.seriesLength / 2}-{snapshot.seriesLength / 2} AFTER ALL{' '}
                {snapshot.seriesLength} GAMES, SERIES ENDS IN A TIE
              </p>
            )}
          </div>

          {/* Connection Status */}
          <div className="border border-white/30 px-3.5 py-2.5 flex items-center justify-between font-mono-arcade text-xs">
            <span className="text-white/70">OPPONENT</span>
            <span className="font-bold">
              {isHost
                ? snapshot.guestConnected
                  ? 'PLAYER 2 CONNECTED'
                  : 'WAITING FOR PLAYER 2...'
                : snapshot.hostConnected
                  ? 'HOST CONNECTED'
                  : 'HOST RECONNECTING...'}
            </span>
          </div>

          {errorMsg && (
            <p className="font-mono-arcade text-xs border border-white/60 px-3 py-2 text-center">
              {errorMsg}
            </p>
          )}

          {isHost ? (
            <button
              type="button"
              disabled={!canStart}
              onClick={() => sendMsg({ type: 'start_match' })}
              className="w-full min-h-[52px] border-2 border-white bg-white text-black font-arcade text-xs sm:text-sm tracking-[0.14em] hover:bg-black hover:text-white transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
            >
              START MATCH
            </button>
          ) : (
            <div className="w-full min-h-[48px] border border-white/40 flex items-center justify-center font-mono-arcade text-xs tracking-wider text-white/80">
              WAITING FOR HOST TO START...
            </div>
          )}
        </div>
      </div>
    );
  }

  // SERIES RESULTS SCREEN
  if (snapshot.status === 'SERIES_OVER') {
    const isTie = snapshot.seriesWinner === 'TIE';
    const didWin = !isTie && snapshot.seriesWinner === role;
    const myRematchReq = isHost
      ? snapshot.rematch.hostRequested
      : snapshot.rematch.guestRequested;
    const oppRematchReq = isHost
      ? snapshot.rematch.guestRequested
      : snapshot.rematch.hostRequested;
    const oppConnected = isHost ? snapshot.guestConnected : snapshot.hostConnected;

    return (
      <div className="w-full h-full bg-black text-white overflow-y-auto flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-sm border-2 border-white bg-black p-6 flex flex-col items-center text-center gap-5">
          <h2 className="font-arcade text-xl sm:text-2xl tracking-[0.14em]">
            {isTie ? 'SERIES TIE' : didWin ? 'YOU WIN' : 'OPPONENT WINS'}
          </h2>

          <div className="w-full border border-white/30 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between font-arcade text-lg">
              <span>YOU: {myGames}</span>
              <span className="text-white/40">-</span>
              <span>OPP: {oppGames}</span>
            </div>
            <p className="font-mono-arcade text-xs text-white/75">
              SERIES LENGTH: {snapshot.seriesLength}{' '}
              {snapshot.seriesLength === 1 ? 'GAME' : 'GAMES'}
            </p>
            <p className="font-mono-arcade text-xs text-white/85">
              {snapshot.seriesEndReason === 'MAJORITY_SECURED'
                ? 'ENDED: MAJORITY SECURED'
                : 'ENDED: ALL GAMES COMPLETED'}
              {snapshot.seriesEndedByForfeit ? ' (FORFEIT)' : ''}
            </p>
          </div>

          {/* Rematch Section */}
          {oppRematchReq && !myRematchReq ? (
            <div className="w-full border border-white p-4 flex flex-col gap-3">
              <p className="font-arcade text-xs tracking-wider">REMATCH REQUESTED</p>
              <p className="font-mono-arcade text-xs text-white/80">
                OPPONENT WANTS A FRESH SERIES ({secondsLeft(snapshot.rematch.expiresAt)}S)
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => sendMsg({ type: 'accept_rematch' })}
                  className="min-h-[48px] border-2 border-white bg-white text-black font-arcade text-xs hover:bg-black hover:text-white transition-colors cursor-pointer"
                >
                  ACCEPT
                </button>
                <button
                  type="button"
                  onClick={() => sendMsg({ type: 'decline_rematch' })}
                  className="min-h-[48px] border-2 border-white bg-black text-white font-arcade text-xs hover:bg-white hover:text-black transition-colors cursor-pointer"
                >
                  DECLINE
                </button>
              </div>
            </div>
          ) : myRematchReq ? (
            <div className="w-full border border-white/60 p-4 flex flex-col gap-2">
              <p className="font-arcade text-xs tracking-wider">REMATCH REQUESTED</p>
              <p className="font-mono-arcade text-xs text-white/75">
                WAITING FOR OPPONENT ({secondsLeft(snapshot.rematch.expiresAt)}S)
              </p>
            </div>
          ) : snapshot.rematch.statusText ? (
            <p className="font-mono-arcade text-xs border border-white/40 px-3 py-2 w-full">
              {snapshot.rematch.statusText}
            </p>
          ) : null}

          <div className="w-full flex flex-col gap-2.5">
            {!myRematchReq && !oppRematchReq && oppConnected && (
              <button
                type="button"
                onClick={() => sendMsg({ type: 'request_rematch' })}
                className="w-full min-h-[48px] border-2 border-white bg-white text-black font-arcade text-xs tracking-wider hover:bg-black hover:text-white transition-colors cursor-pointer"
              >
                REMATCH
              </button>
            )}
            <button
              type="button"
              onClick={cleanupAndExit}
              className="w-full min-h-[48px] border-2 border-white bg-black text-white font-arcade text-xs tracking-wider hover:bg-white hover:text-black transition-colors cursor-pointer"
            >
              DASHBOARD
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ACTIVE ONLINE MATCH / INTERMISSION / PAUSED_DISCONNECT VIEW
  return (
    <div
      className="w-full h-full bg-black text-white flex flex-col overflow-hidden select-none"
      onPointerDown={() => retroAudio.unlock()}
    >
      {/* Top HUD */}
      <header className="shrink-0 w-full px-3 sm:px-6 py-2 border-b border-white/20 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={cleanupAndExit}
          className="min-h-[44px] px-3 border border-white/50 text-white font-mono-arcade text-xs tracking-wider uppercase hover:bg-white hover:text-black transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          EXIT
        </button>

        <div className="flex flex-col items-center">
          <div className="flex items-center gap-3 sm:gap-5 font-arcade text-sm sm:text-xl tracking-wider">
            <div className="flex items-center gap-1.5">
              <span className="font-mono-arcade text-[10px] sm:text-xs text-white/60">YOU</span>
              <span>{String(myScore).padStart(2, '0')}</span>
            </div>
            <span className="text-white/40">:</span>
            <div className="flex items-center gap-1.5">
              <span>{String(oppScore).padStart(2, '0')}</span>
              <span className="font-mono-arcade text-[10px] sm:text-xs text-white/60">OPP</span>
            </div>
          </div>
          <div className="font-mono-arcade text-[10px] sm:text-xs text-white/70 tracking-wider">
            SERIES {myGames}-{oppGames} · GAME {snapshot.currentGame}/{snapshot.seriesLength}
          </div>
        </div>

        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute sound' : 'Mute sound'}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-white/50 text-white hover:bg-white hover:text-black transition-colors cursor-pointer shrink-0"
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </header>

      {/* Playfield */}
      <div className="relative flex-1 min-h-0 w-full p-2 sm:p-5 flex items-center justify-center">
        <div className="w-full h-full max-w-5xl max-h-full">
          <PongCanvas
            getFrameState={getFrameState}
            interactive={isPlaying}
            onPointerTargetV={onPointerTargetV}
            onOrientationChange={setIsPortrait}
          />
        </div>

        {/* Intermission / Reconnect / Pause Overlays */}
        {reconnecting && (
          <div className="absolute inset-0 z-20 bg-black/85 flex items-center justify-center p-4">
            <div className="w-full max-w-xs border-2 border-white bg-black p-6 text-center flex flex-col gap-3">
              <h2 className="font-arcade text-base tracking-wider">CONNECTION LOST</h2>
              <p className="font-mono-arcade text-xs text-white/80">RECONNECTING TO SERVER...</p>
            </div>
          </div>
        )}

        {!reconnecting && snapshot.status === 'PAUSED_DISCONNECT' && (
          <div className="absolute inset-0 z-20 bg-black/85 flex items-center justify-center p-4">
            <div className="w-full max-w-xs border-2 border-white bg-black p-6 text-center flex flex-col gap-4">
              <h2 className="font-arcade text-base tracking-wider">MATCH PAUSED</h2>
              <p className="font-mono-arcade text-xs text-white/85">
                {snapshot.disconnectedRole === role
                  ? 'RECONNECTING...'
                  : 'OPPONENT DISCONNECTED · WAITING FOR RECONNECTION'}
              </p>
              <p className="font-arcade text-2xl">{secondsLeft(snapshot.graceExpiresAt)}S</p>
              <p className="font-mono-arcade text-[11px] text-white/60">
                FORFEIT OF CURRENT GAME IF NOT RESTORED
              </p>
            </div>
          </div>
        )}

        {!reconnecting && snapshot.status === 'FORFEIT_INTERMISSION' && (
          <div className="absolute inset-0 z-20 bg-black/85 flex items-center justify-center p-4">
            <div className="w-full max-w-xs border-2 border-white bg-black p-6 text-center flex flex-col gap-4">
              <h2 className="font-arcade text-base tracking-wider">GAME WON BY FORFEIT</h2>
              <p className="font-mono-arcade text-xs text-white/85">
                SERIES: YOU {myGames} - {oppGames} OPP
              </p>
              <p className="font-mono-arcade text-xs text-white/75">
                WAITING FOR OPPONENT TO RECONNECT FOR NEXT GAME:{' '}
                {secondsLeft(snapshot.graceExpiresAt)}S
              </p>
              <button
                type="button"
                onClick={cleanupAndExit}
                className="w-full min-h-[44px] border border-white/60 font-mono-arcade text-xs tracking-wider hover:bg-white hover:text-black transition-colors cursor-pointer"
              >
                LEAVE ROOM
              </button>
            </div>
          </div>
        )}

        {!reconnecting && snapshot.status === 'GAME_INTERMISSION' && (
          <div className="absolute inset-0 z-20 bg-black/80 flex items-center justify-center p-4">
            <div className="w-full max-w-xs border-2 border-white bg-black p-6 text-center flex flex-col gap-3">
              <h2 className="font-arcade text-base tracking-wider">
                {snapshot.lastGameWinner === role ? 'GAME WON' : 'GAME LOST'}
              </h2>
              <p className="font-arcade text-lg">
                {myScore} - {oppScore}
              </p>
              <p className="font-mono-arcade text-xs text-white/80">
                SERIES: {myGames} - {oppGames} (FIRST TO {majorityNeeded})
              </p>
              <p className="font-mono-arcade text-xs text-white/70">
                NEXT GAME IN {secondsLeft(snapshot.intermissionExpiresAt)}S
              </p>
            </div>
          </div>
        )}

        {!reconnecting && snapshot.status === 'RESUMING' && (
          <div className="pointer-events-none absolute inset-0 z-20 bg-black/65 flex items-center justify-center p-4">
            <div className="border-2 border-white bg-black px-6 py-4 text-center flex flex-col gap-2">
              <p className="font-arcade text-sm tracking-wider">OPPONENT RECONNECTED</p>
              <p className="font-mono-arcade text-xs text-white/80">
                RESUMING IN {secondsLeft(snapshot.intermissionExpiresAt)}S
              </p>
            </div>
          </div>
        )}
      </div>

      <footer className="shrink-0 w-full px-4 py-1.5 text-center font-mono-arcade text-[11px] tracking-wider text-white/55">
        ROOM {snapshot.roomCode} · FIRST TO {WIN_SCORE} · MAJORITY {majorityNeeded} OF{' '}
        {snapshot.seriesLength}
      </footer>
    </div>
  );
}
