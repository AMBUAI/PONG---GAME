import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  COURT_WIDTH,
  GAME_INTERMISSION_MS,
  PADDLE_LENGTH,
  PADDLE_SPEED,
  type PlayerRole,
  type PongSimState,
  RECONNECT_GRACE_MS,
  REMATCH_TIMEOUT_MS,
  RESUME_COUNTDOWN_MS,
  type RematchState,
  type RoomSnapshot,
  type RoomStatus,
  type SeriesEndReason,
  type ServerToClientMessage,
  type SoundEvent,
  clamp,
  computeMajorityNeeded,
} from '../shared/pongTypes.ts';
import { createInitialSimState, stepPongSimulation } from '../shared/pongEngine.ts';

interface PlayerSlot {
  token: string;
  ws: WebSocket | null;
  connected: boolean;
  joined: boolean;
  targetV: number | null;
  moveDir: -1 | 0 | 1;
}

interface ActiveRoom {
  code: string;
  status: RoomStatus;
  seriesLength: number;
  currentGame: number;
  p1Games: number;
  p2Games: number;
  host: PlayerSlot;
  guest: PlayerSlot;
  sim: PongSimState;
  lastTickTime: number;
  lastBroadcastTime: number;
  tickInterval: ReturnType<typeof setInterval> | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  intermissionTimer: ReturnType<typeof setTimeout> | null;
  rematchTimer: ReturnType<typeof setTimeout> | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  disconnectedRole: PlayerRole | null;
  graceExpiresAt: number | null;
  intermissionExpiresAt: number | null;
  lastGameWinner: PlayerRole | null;
  lastGameForfeit: boolean;
  seriesWinner: PlayerRole | 'TIE' | null;
  seriesEndReason: SeriesEndReason | null;
  seriesEndedByForfeit: boolean;
  rematch: RematchState;
  pendingEvents: SoundEvent[];
}

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const TICK_MS = 1000 / 60;
const BROADCAST_MS = 1000 / 30;
const LOBBY_IDLE_EXPIRY_MS = 15 * 60 * 1000;
const FINISHED_ROOM_EXPIRY_MS = 5 * 60 * 1000;

export class RoomManager {
  private rooms = new Map<string, ActiveRoom>();
  private socketIndex = new WeakMap<WebSocket, { roomCode: string; role: PlayerRole }>();

  private generateRoomCode(): string {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  private generateToken(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  private send(ws: WebSocket | null, msg: ServerToClientMessage): void {
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Ignore send failure on closing sockets
    }
  }

  private emptyRematch(): RematchState {
    return {
      hostRequested: false,
      guestRequested: false,
      requestedBy: null,
      expiresAt: null,
      statusText: null,
    };
  }

  private buildSnapshot(room: ActiveRoom, includeEvents = false): RoomSnapshot {
    const snapshot: RoomSnapshot = {
      roomCode: room.code,
      status: room.status,
      seriesLength: room.seriesLength,
      majorityNeeded: computeMajorityNeeded(room.seriesLength),
      currentGame: room.currentGame,
      hostConnected: room.host.connected,
      guestConnected: room.guest.connected,
      hostJoined: room.host.joined,
      guestJoined: room.guest.joined,
      p1Score: room.sim.p1Score,
      p2Score: room.sim.p2Score,
      p1Games: room.p1Games,
      p2Games: room.p2Games,
      p1V: room.sim.p1V,
      p2V: room.sim.p2V,
      ballU: room.sim.ballU,
      ballV: room.sim.ballV,
      ballVu: room.sim.ballVu,
      ballVv: room.sim.ballVv,
      serveTimer: room.sim.serveTimer,
      disconnectedRole: room.disconnectedRole,
      graceExpiresAt: room.graceExpiresAt,
      intermissionExpiresAt: room.intermissionExpiresAt,
      lastGameWinner: room.lastGameWinner,
      lastGameForfeit: room.lastGameForfeit,
      seriesWinner: room.seriesWinner,
      seriesEndReason: room.seriesEndReason,
      seriesEndedByForfeit: room.seriesEndedByForfeit,
      rematch: { ...room.rematch },
      serverTime: Date.now(),
    };

    if (includeEvents && room.pendingEvents.length > 0) {
      snapshot.events = [...room.pendingEvents];
      room.pendingEvents = [];
    }

    return snapshot;
  }

  private broadcastState(room: ActiveRoom, includeEvents = false): void {
    const snapshot = this.buildSnapshot(room, includeEvents);
    const msg: ServerToClientMessage = { type: 'room_state', snapshot };
    this.send(room.host.ws, msg);
    this.send(room.guest.ws, msg);
  }

  private clearTimers(room: ActiveRoom): void {
    if (room.tickInterval) {
      clearInterval(room.tickInterval);
      room.tickInterval = null;
    }
    if (room.graceTimer) {
      clearTimeout(room.graceTimer);
      room.graceTimer = null;
    }
    if (room.intermissionTimer) {
      clearTimeout(room.intermissionTimer);
      room.intermissionTimer = null;
    }
    if (room.rematchTimer) {
      clearTimeout(room.rematchTimer);
      room.rematchTimer = null;
    }
    if (room.expiryTimer) {
      clearTimeout(room.expiryTimer);
      room.expiryTimer = null;
    }
  }

  private scheduleRoomExpiry(room: ActiveRoom, delayMs: number): void {
    if (room.expiryTimer) clearTimeout(room.expiryTimer);
    room.expiryTimer = setTimeout(() => {
      this.closeRoom(room, 'ROOM EXPIRED');
    }, delayMs);
  }

  private closeRoom(room: ActiveRoom, reason: string): void {
    if (room.status === 'CLOSED') return;
    room.status = 'CLOSED';
    this.clearTimers(room);

    const msg: ServerToClientMessage = { type: 'room_closed', reason };
    this.send(room.host.ws, msg);
    this.send(room.guest.ws, msg);

    this.rooms.delete(room.code);
  }

  private detachSocket(ws: WebSocket): void {
    const entry = this.socketIndex.get(ws);
    if (!entry) return;
    this.socketIndex.delete(ws);

    const room = this.rooms.get(entry.roomCode);
    if (!room) return;
    const slot = entry.role === 'host' ? room.host : room.guest;
    if (slot.ws === ws) {
      slot.ws = null;
      slot.connected = false;
    }
  }

  public createRoom(ws: WebSocket): void {
    this.detachSocket(ws);

    const code = this.generateRoomCode();
    const hostToken = this.generateToken();

    const room: ActiveRoom = {
      code,
      status: 'LOBBY',
      seriesLength: 3,
      currentGame: 1,
      p1Games: 0,
      p2Games: 0,
      host: {
        token: hostToken,
        ws,
        connected: true,
        joined: true,
        targetV: null,
        moveDir: 0,
      },
      guest: {
        token: '',
        ws: null,
        connected: false,
        joined: false,
        targetV: null,
        moveDir: 0,
      },
      sim: createInitialSimState('ONLINE'),
      lastTickTime: Date.now(),
      lastBroadcastTime: 0,
      tickInterval: null,
      graceTimer: null,
      intermissionTimer: null,
      rematchTimer: null,
      expiryTimer: null,
      disconnectedRole: null,
      graceExpiresAt: null,
      intermissionExpiresAt: null,
      lastGameWinner: null,
      lastGameForfeit: false,
      seriesWinner: null,
      seriesEndReason: null,
      seriesEndedByForfeit: false,
      rematch: this.emptyRematch(),
      pendingEvents: [],
    };

    this.rooms.set(code, room);
    this.socketIndex.set(ws, { roomCode: code, role: 'host' });
    this.scheduleRoomExpiry(room, LOBBY_IDLE_EXPIRY_MS);

    this.send(ws, {
      type: 'room_joined',
      roomCode: code,
      role: 'host',
      playerToken: hostToken,
      snapshot: this.buildSnapshot(room),
    });
  }

  public joinRoom(ws: WebSocket, rawCode: string): void {
    const code = (rawCode ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      this.send(ws, {
        type: 'room_error',
        code: 'INVALID_CODE',
        message: 'ENTER A VALID 6-CHARACTER ALPHANUMERIC CODE.',
      });
      return;
    }

    const room = this.rooms.get(code);
    if (!room || room.status === 'CLOSED') {
      this.send(ws, {
        type: 'room_error',
        code: 'NOT_FOUND',
        message: 'ROOM NOT FOUND OR EXPIRED.',
      });
      return;
    }

    if (room.guest.joined) {
      this.send(ws, {
        type: 'room_error',
        code: 'ROOM_FULL',
        message: 'THIS ROOM ALREADY HAS TWO PLAYERS.',
      });
      return;
    }

    if (room.status !== 'LOBBY') {
      this.send(ws, {
        type: 'room_error',
        code: 'MATCH_ACTIVE',
        message: 'MATCH ALREADY IN PROGRESS.',
      });
      return;
    }

    this.detachSocket(ws);
    const guestToken = this.generateToken();
    room.guest.token = guestToken;
    room.guest.ws = ws;
    room.guest.connected = true;
    room.guest.joined = true;

    this.socketIndex.set(ws, { roomCode: code, role: 'guest' });
    this.scheduleRoomExpiry(room, LOBBY_IDLE_EXPIRY_MS);

    this.send(ws, {
      type: 'room_joined',
      roomCode: code,
      role: 'guest',
      playerToken: guestToken,
      snapshot: this.buildSnapshot(room),
    });

    this.broadcastState(room);
  }

  public reconnectRoom(ws: WebSocket, rawCode: string, playerToken: string): void {
    const code = (rawCode ?? '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.status === 'CLOSED') {
      this.send(ws, {
        type: 'room_error',
        code: 'EXPIRED',
        message: 'ROOM EXPIRED OR MATCH ALREADY ENDED.',
      });
      return;
    }

    let role: PlayerRole | null = null;
    if (playerToken && room.host.token === playerToken) {
      role = 'host';
    } else if (playerToken && room.guest.token === playerToken) {
      role = 'guest';
    }

    if (!role) {
      this.send(ws, {
        type: 'room_error',
        code: 'INVALID_SESSION',
        message: 'SESSION EXPIRED OR INVALID.',
      });
      return;
    }

    this.detachSocket(ws);
    const slot = role === 'host' ? room.host : room.guest;
    slot.ws = ws;
    slot.connected = true;
    this.socketIndex.set(ws, { roomCode: code, role });

    this.send(ws, {
      type: 'room_joined',
      roomCode: code,
      role,
      playerToken,
      snapshot: this.buildSnapshot(room),
    });

    // If reconnecting during a disconnect pause or forfeit intermission, restore cleanly
    if (
      (room.status === 'PAUSED_DISCONNECT' || room.status === 'FORFEIT_INTERMISSION') &&
      room.host.connected &&
      room.guest.connected
    ) {
      if (room.graceTimer) {
        clearTimeout(room.graceTimer);
        room.graceTimer = null;
      }
      const wasForfeitIntermission = room.status === 'FORFEIT_INTERMISSION';
      room.disconnectedRole = null;
      room.graceExpiresAt = null;

      if (wasForfeitIntermission) {
        room.currentGame += 1;
        room.sim = createInitialSimState('ONLINE');
      }

      room.status = 'RESUMING';
      room.intermissionExpiresAt = Date.now() + RESUME_COUNTDOWN_MS;
      this.broadcastState(room);

      if (room.intermissionTimer) clearTimeout(room.intermissionTimer);
      room.intermissionTimer = setTimeout(() => {
        if (room.status !== 'RESUMING') return;
        room.intermissionExpiresAt = null;
        room.status = 'PLAYING';
        room.lastTickTime = Date.now();
        this.startTickLoop(room);
        this.broadcastState(room);
      }, RESUME_COUNTDOWN_MS);
      return;
    }

    this.broadcastState(room);
  }

  public setSeriesLength(ws: WebSocket, seriesLength: number): void {
    const entry = this.socketIndex.get(ws);
    if (!entry) return;
    const room = this.rooms.get(entry.roomCode);
    if (!room || entry.role !== 'host' || room.status !== 'LOBBY') return;

    if (!Number.isInteger(seriesLength) || seriesLength < 1 || seriesLength > 10) {
      return;
    }

    room.seriesLength = seriesLength;
    this.broadcastState(room);
  }

  public startMatch(ws: WebSocket): void {
    const entry = this.socketIndex.get(ws);
    if (!entry) return;
    const room = this.rooms.get(entry.roomCode);
    if (!room || entry.role !== 'host' || room.status !== 'LOBBY') return;

    if (!room.host.connected || !room.guest.connected) {
      this.send(ws, {
        type: 'room_error',
        code: 'WAITING_PLAYER',
        message: 'BOTH PLAYERS MUST BE CONNECTED TO START.',
      });
      return;
    }

    if (room.expiryTimer) {
      clearTimeout(room.expiryTimer);
      room.expiryTimer = null;
    }

    this.resetSeriesState(room);
    room.status = 'PLAYING';
    room.lastTickTime = Date.now();
    this.startTickLoop(room);
    this.broadcastState(room);
  }

  private resetSeriesState(room: ActiveRoom): void {
    room.currentGame = 1;
    room.p1Games = 0;
    room.p2Games = 0;
    room.lastGameWinner = null;
    room.lastGameForfeit = false;
    room.seriesWinner = null;
    room.seriesEndReason = null;
    room.seriesEndedByForfeit = false;
    room.disconnectedRole = null;
    room.graceExpiresAt = null;
    room.intermissionExpiresAt = null;
    room.rematch = this.emptyRematch();
    room.pendingEvents = [];
    room.host.moveDir = 0;
    room.host.targetV = null;
    room.guest.moveDir = 0;
    room.guest.targetV = null;
    room.sim = createInitialSimState('ONLINE');
  }

  public handlePaddleInput(ws: WebSocket, targetV: number | null, moveDir: -1 | 0 | 1): void {
    const entry = this.socketIndex.get(ws);
    if (!entry) return;
    const room = this.rooms.get(entry.roomCode);
    if (!room) return;
    if (room.status !== 'PLAYING' && room.status !== 'RESUMING') return;

    const slot = entry.role === 'host' ? room.host : room.guest;
    const validDir: -1 | 0 | 1 = moveDir === -1 || moveDir === 1 ? moveDir : 0;
    slot.moveDir = validDir;

    if (typeof targetV === 'number' && Number.isFinite(targetV)) {
      const halfPad = PADDLE_LENGTH / 2;
      slot.targetV = clamp(targetV, halfPad, COURT_WIDTH - halfPad);
    } else {
      slot.targetV = null;
    }
  }

  private startTickLoop(room: ActiveRoom): void {
    if (room.tickInterval) clearInterval(room.tickInterval);
    room.lastTickTime = Date.now();
    room.lastBroadcastTime = 0;

    room.tickInterval = setInterval(() => {
      if (room.status !== 'PLAYING') {
        if (room.tickInterval) {
          clearInterval(room.tickInterval);
          room.tickInterval = null;
        }
        return;
      }

      const now = Date.now();
      const dt = Math.min((now - room.lastTickTime) / 1000, 0.05);
      room.lastTickTime = now;

      const stepResult = stepPongSimulation(
        room.sim,
        {
          p1Dir: room.host.moveDir,
          p1TargetV: room.host.targetV,
          p2Dir: room.guest.moveDir,
          p2TargetV: room.guest.targetV,
        },
        dt,
        PADDLE_SPEED
      );

      if (stepResult.events.length > 0) {
        room.pendingEvents.push(...stepResult.events);
      }

      if (room.sim.winner !== null) {
        if (room.tickInterval) {
          clearInterval(room.tickInterval);
          room.tickInterval = null;
        }
        this.handleGameEnded(room, room.sim.winner === 'p1' ? 'host' : 'guest', false);
        return;
      }

      if (stepResult.scoredBy !== null || now - room.lastBroadcastTime >= BROADCAST_MS) {
        room.lastBroadcastTime = now;
        this.broadcastState(room, true);
      }
    }, TICK_MS);
  }

  private handleGameEnded(room: ActiveRoom, winnerRole: PlayerRole, byForfeit: boolean): void {
    if (winnerRole === 'host') {
      room.p1Games += 1;
    } else {
      room.p2Games += 1;
    }

    room.lastGameWinner = winnerRole;
    room.lastGameForfeit = byForfeit;

    const majority = computeMajorityNeeded(room.seriesLength);
    const totalPlayed = room.p1Games + room.p2Games;

    if (room.p1Games >= majority || room.p2Games >= majority) {
      room.seriesWinner = room.p1Games >= majority ? 'host' : 'guest';
      room.seriesEndReason = 'MAJORITY_SECURED';
      room.seriesEndedByForfeit = byForfeit;
      room.status = 'SERIES_OVER';
      room.disconnectedRole = null;
      room.graceExpiresAt = null;
      room.intermissionExpiresAt = null;
      this.scheduleRoomExpiry(room, FINISHED_ROOM_EXPIRY_MS);
      this.broadcastState(room, true);
      return;
    }

    if (totalPlayed >= room.seriesLength) {
      room.seriesWinner =
        room.p1Games === room.p2Games ? 'TIE' : room.p1Games > room.p2Games ? 'host' : 'guest';
      room.seriesEndReason = 'ALL_GAMES_COMPLETED';
      room.seriesEndedByForfeit = byForfeit;
      room.status = 'SERIES_OVER';
      room.disconnectedRole = null;
      room.graceExpiresAt = null;
      room.intermissionExpiresAt = null;
      this.scheduleRoomExpiry(room, FINISHED_ROOM_EXPIRY_MS);
      this.broadcastState(room, true);
      return;
    }

    // Series continues
    if (byForfeit) {
      // Wait for opponent to reconnect for the next game under the same defined per-game grace window
      const disconnectedRole = winnerRole === 'host' ? 'guest' : 'host';
      room.status = 'FORFEIT_INTERMISSION';
      room.disconnectedRole = disconnectedRole;
      room.graceExpiresAt = Date.now() + RECONNECT_GRACE_MS;
      this.broadcastState(room, true);

      room.graceTimer = setTimeout(() => {
        if (room.status !== 'FORFEIT_INTERMISSION') return;
        const stillMissing =
          disconnectedRole === 'host' ? !room.host.connected : !room.guest.connected;
        if (stillMissing) {
          room.currentGame += 1;
          this.handleGameEnded(room, winnerRole, true);
        }
      }, RECONNECT_GRACE_MS);
      return;
    }

    room.status = 'GAME_INTERMISSION';
    room.intermissionExpiresAt = Date.now() + GAME_INTERMISSION_MS;
    this.broadcastState(room, true);

    if (room.intermissionTimer) clearTimeout(room.intermissionTimer);
    room.intermissionTimer = setTimeout(() => {
      if (room.status !== 'GAME_INTERMISSION') return;
      if (!room.host.connected || !room.guest.connected) return;
      room.currentGame += 1;
      room.sim = createInitialSimState('ONLINE');
      room.intermissionExpiresAt = null;
      room.status = 'PLAYING';
      this.startTickLoop(room);
      this.broadcastState(room);
    }, GAME_INTERMISSION_MS);
  }

  public requestRematch(ws: WebSocket): void {
    const entry = this.socketIndex.get(ws);
    if (!entry) return;
    const room = this.rooms.get(entry.roomCode);
    if (!room || room.status !== 'SERIES_OVER') return;

    if (!room.host.connected || !room.guest.connected) {
      room.rematch = {
        ...this.emptyRematch(),
        statusText: 'OPPONENT DISCONNECTED · REMATCH UNAVAILABLE',
      };
      this.broadcastState(room);
      return;
    }

    if (entry.role === 'host') {
      room.rematch.hostRequested = true;
    } else {
      room.rematch.guestRequested = true;
    }

    if (room.rematch.requestedBy === null) {
      room.rematch.requestedBy = entry.role;
      room.rematch.expiresAt = Date.now() + REMATCH_TIMEOUT_MS;
      room.rematch.statusText = 'REMATCH REQUESTED';

      if (room.rematchTimer) clearTimeout(room.rematchTimer);
      room.rematchTimer = setTimeout(() => {
        if (room.status !== 'SERIES_OVER') return;
        room.rematch = {
          ...this.emptyRematch(),
          statusText: 'REMATCH REQUEST TIMED OUT',
        };
        this.broadcastState(room);
      }, REMATCH_TIMEOUT_MS);
    }

    if (room.rematch.hostRequested && room.rematch.guestRequested) {
      this.startRematchSeries(room);
      return;
    }

    this.broadcastState(room);
  }

  public acceptRematch(ws: WebSocket): void {
    this.requestRematch(ws);
  }

  public declineRematch(ws: WebSocket): void {
    const entry = this.socketIndex.get(ws);
    if (!entry) return;
    const room = this.rooms.get(entry.roomCode);
    if (!room || room.status !== 'SERIES_OVER') return;

    this.closeRoom(room, 'REMATCH DECLINED');
  }

  private startRematchSeries(room: ActiveRoom): void {
    if (room.rematchTimer) {
      clearTimeout(room.rematchTimer);
      room.rematchTimer = null;
    }
    if (room.expiryTimer) {
      clearTimeout(room.expiryTimer);
      room.expiryTimer = null;
    }

    this.resetSeriesState(room);
    room.status = 'PLAYING';
    this.startTickLoop(room);
    this.broadcastState(room);
  }

  public leaveRoom(ws: WebSocket): void {
    const entry = this.socketIndex.get(ws);
    if (!entry) return;
    const room = this.rooms.get(entry.roomCode);
    if (!room) return;

    this.detachSocket(ws);

    if (room.status === 'LOBBY') {
      if (entry.role === 'host') {
        this.closeRoom(room, 'HOST CLOSED THE ROOM');
      } else {
        room.guest = {
          token: '',
          ws: null,
          connected: false,
          joined: false,
          targetV: null,
          moveDir: 0,
        };
        this.broadcastState(room);
      }
      return;
    }

    if (room.status === 'SERIES_OVER') {
      if (room.rematchTimer) {
        clearTimeout(room.rematchTimer);
        room.rematchTimer = null;
      }
      room.rematch = {
        ...this.emptyRematch(),
        statusText: 'OPPONENT LEFT THE ROOM',
      };
      this.broadcastState(room);
      if (!room.host.connected && !room.guest.connected) {
        this.closeRoom(room, 'BOTH PLAYERS LEFT');
      }
      return;
    }

    // Active match voluntary leave triggers immediate disconnect grace or close if both gone
    this.handleActiveDisconnect(room, entry.role);
  }

  public handleSocketClose(ws: WebSocket): void {
    const entry = this.socketIndex.get(ws);
    if (!entry) return;
    const room = this.rooms.get(entry.roomCode);
    this.detachSocket(ws);
    if (!room || room.status === 'CLOSED') return;

    if (room.status === 'LOBBY') {
      if (entry.role === 'host') {
        // Give host a brief grace or keep lobby open up to 15s for accidental refresh
        setTimeout(() => {
          const current = this.rooms.get(room.code);
          if (current && current.status === 'LOBBY' && !current.host.connected) {
            this.closeRoom(current, 'HOST DISCONNECTED');
          }
        }, RECONNECT_GRACE_MS);
      } else {
        setTimeout(() => {
          const current = this.rooms.get(room.code);
          if (current && current.status === 'LOBBY' && !current.guest.connected) {
            current.guest.joined = false;
            current.guest.token = '';
            this.broadcastState(current);
          }
        }, 4000);
      }
      this.broadcastState(room);
      return;
    }

    if (room.status === 'SERIES_OVER') {
      if (room.rematch.requestedBy !== null) {
        if (room.rematchTimer) {
          clearTimeout(room.rematchTimer);
          room.rematchTimer = null;
        }
        room.rematch = {
          ...this.emptyRematch(),
          statusText: 'OPPONENT DISCONNECTED · REMATCH CANCELLED',
        };
      }
      this.broadcastState(room);
      return;
    }

    this.handleActiveDisconnect(room, entry.role);
  }

  private handleActiveDisconnect(room: ActiveRoom, role: PlayerRole): void {
    if (!room.host.connected && !room.guest.connected) {
      // Both disconnected: expire after grace period if neither returns
      if (room.tickInterval) {
        clearInterval(room.tickInterval);
        room.tickInterval = null;
      }
      if (room.intermissionTimer) {
        clearTimeout(room.intermissionTimer);
        room.intermissionTimer = null;
      }
      if (room.graceTimer) clearTimeout(room.graceTimer);
      room.status = 'PAUSED_DISCONNECT';
      room.disconnectedRole = role;
      room.graceExpiresAt = Date.now() + RECONNECT_GRACE_MS;
      room.graceTimer = setTimeout(() => {
        if (!room.host.connected && !room.guest.connected) {
          this.closeRoom(room, 'BOTH PLAYERS DISCONNECTED');
        }
      }, RECONNECT_GRACE_MS);
      return;
    }

    if (room.status === 'PAUSED_DISCONNECT' || room.status === 'FORFEIT_INTERMISSION') {
      this.broadcastState(room);
      return;
    }

    if (room.tickInterval) {
      clearInterval(room.tickInterval);
      room.tickInterval = null;
    }
    if (room.intermissionTimer) {
      clearTimeout(room.intermissionTimer);
      room.intermissionTimer = null;
    }

    room.status = 'PAUSED_DISCONNECT';
    room.disconnectedRole = role;
    room.intermissionExpiresAt = null;
    room.graceExpiresAt = Date.now() + RECONNECT_GRACE_MS;
    this.broadcastState(room);

    if (room.graceTimer) clearTimeout(room.graceTimer);
    room.graceTimer = setTimeout(() => {
      if (room.status !== 'PAUSED_DISCONNECT') return;
      const missingSlot = role === 'host' ? room.host : room.guest;
      if (missingSlot.connected) return;
      const winnerRole: PlayerRole = role === 'host' ? 'guest' : 'host';
      this.handleGameEnded(room, winnerRole, true);
    }, RECONNECT_GRACE_MS);
  }
}
