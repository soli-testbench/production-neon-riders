import { WebSocket } from 'ws';
import { GameRoom } from './gameRoom.js';
import { ClientMessage, ServerMessage } from '../shared/protocol.js';
import { sanitizeColor, sanitizeName, isValidDirection } from '../shared/types.js';

// Rate limiter state per connection
interface RateLimitState {
  inputTimestamps: number[];
  generalTimestamps: number[];
}

const INPUT_RATE_LIMIT = 20; // max input messages per second
const GENERAL_RATE_LIMIT = 60; // max general messages per second
const RATE_WINDOW_MS = 1000; // 1 second sliding window

// Room cleanup constants
const CLEANUP_INTERVAL_MS = 60000; // 60 seconds
const EMPTY_ROOM_MAX_AGE_MS = 300000; // 5 minutes empty

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export class WebSocketHandler {
  private rooms: Map<string, GameRoom> = new Map();
  private playerRooms: Map<string, string> = new Map(); // playerId -> roomId
  private wsPlayers: Map<WebSocket, string> = new Map(); // ws -> playerId
  private rateLimits: Map<WebSocket, RateLimitState> = new Map();
  private roomCreationTimes: Map<string, number> = new Map(); // roomId -> creation timestamp
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanupLoop();
  }

  handleConnection(ws: WebSocket): void {
    const playerId = generateId();
    this.wsPlayers.set(ws, playerId);
    this.rateLimits.set(ws, { inputTimestamps: [], generalTimestamps: [] });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;

        // Rate limiting: check general limit
        if (!this.checkRateLimit(ws, 'general')) return;
        // Additional input-specific rate limit
        if (msg.type === 'input' && !this.checkRateLimit(ws, 'input')) return;

        this.handleMessage(ws, playerId, msg);
      } catch (err) {
        console.error('Invalid message:', err);
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws, playerId);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  }

  private checkRateLimit(ws: WebSocket, type: 'input' | 'general'): boolean {
    const state = this.rateLimits.get(ws);
    if (!state) return true;

    const now = Date.now();
    const timestamps = type === 'input' ? state.inputTimestamps : state.generalTimestamps;
    const limit = type === 'input' ? INPUT_RATE_LIMIT : GENERAL_RATE_LIMIT;

    // Remove timestamps outside the window
    while (timestamps.length > 0 && timestamps[0] < now - RATE_WINDOW_MS) {
      timestamps.shift();
    }

    if (timestamps.length >= limit) {
      return false; // Silently drop
    }

    timestamps.push(now);
    return true;
  }

  private handleMessage(ws: WebSocket, playerId: string, msg: ClientMessage): void {
    switch (msg.type) {
      case 'create_room': {
        const roomId = generateRoomCode();
        const room = new GameRoom(roomId);
        this.rooms.set(roomId, room);
        this.roomCreationTimes.set(roomId, Date.now());

        const safeColor = sanitizeColor(msg.color);
        const safeName = sanitizeName(msg.name || '');
        room.addPlayer(playerId, safeName, safeColor, ws);
        this.playerRooms.set(playerId, roomId);

        this.sendTo(ws, {
          type: 'room_created',
          roomId,
          playerId,
          isHost: true,
        });
        break;
      }

      case 'join': {
        if (!msg.roomId) {
          this.sendTo(ws, { type: 'error', message: 'Room code required' });
          return;
        }

        const room = this.rooms.get(msg.roomId);
        if (!room) {
          this.sendTo(ws, { type: 'error', message: 'Room not found' });
          return;
        }

        const safeColor = sanitizeColor(msg.color);
        const safeName = sanitizeName(msg.name || '');
        const added = room.addPlayer(playerId, safeName, safeColor, ws);
        if (!added) {
          this.sendTo(ws, { type: 'error', message: 'Cannot join room (full or in progress)' });
          return;
        }

        this.playerRooms.set(playerId, msg.roomId);

        this.sendTo(ws, {
          type: 'room_joined',
          roomId: msg.roomId,
          playerId,
          isHost: false,
        });
        break;
      }

      case 'input': {
        if (!isValidDirection(msg.direction)) return;
        const roomId = this.playerRooms.get(playerId);
        if (roomId) {
          const room = this.rooms.get(roomId);
          room?.handleInput(playerId, msg.direction);
        }
        break;
      }

      case 'start_game': {
        const roomId = this.playerRooms.get(playerId);
        if (roomId) {
          const room = this.rooms.get(roomId);
          room?.startGame(playerId);
        }
        break;
      }

      case 'add_ai': {
        const roomId = this.playerRooms.get(playerId);
        if (roomId) {
          const room = this.rooms.get(roomId);
          room?.addAi(playerId);
        }
        break;
      }

      case 'remove_ai': {
        const roomId = this.playerRooms.get(playerId);
        if (roomId) {
          const room = this.rooms.get(roomId);
          room?.removeAi(playerId);
        }
        break;
      }

      case 'leave_room': {
        this.leaveRoom(playerId);
        break;
      }
    }
  }

  private handleDisconnect(ws: WebSocket, playerId: string): void {
    this.leaveRoom(playerId);
    this.wsPlayers.delete(ws);
    this.rateLimits.delete(ws);
  }

  private leaveRoom(playerId: string): void {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (room) {
      room.removePlayer(playerId);
      if (room.isEmpty()) {
        room.destroy();
        this.rooms.delete(roomId);
      }
    }

    this.playerRooms.delete(playerId);
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private startCleanupLoop(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleRooms();
    }, CLEANUP_INTERVAL_MS);
  }

  private cleanupStaleRooms(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [roomId, room] of this.rooms) {
      // Check 1: No human players connected
      if (!room.hasHumanPlayers()) {
        console.log(`[Room Janitor] Destroying room ${roomId}: no human players`);
        toDelete.push(roomId);
        continue;
      }

      // Check 2: Room stuck in 'ended' state for too long
      const roomState = room.getState();
      if (roomState === 'ended' && !room.hasHumanPlayers()) {
        console.log(`[Room Janitor] Destroying room ${roomId}: ended state with no humans`);
        toDelete.push(roomId);
        continue;
      }

      // Check 3: Empty room for more than 5 minutes
      if (room.isEmpty()) {
        const creationTime = this.roomCreationTimes.get(roomId) || now;
        if (now - creationTime > EMPTY_ROOM_MAX_AGE_MS) {
          console.log(`[Room Janitor] Destroying room ${roomId}: empty for over 5 minutes`);
          toDelete.push(roomId);
          continue;
        }
      }
    }

    for (const roomId of toDelete) {
      const room = this.rooms.get(roomId);
      if (room) {
        // Clean up player->room mappings for any remaining players
        for (const [playerId, rId] of this.playerRooms) {
          if (rId === roomId) {
            this.playerRooms.delete(playerId);
          }
        }
        room.destroy();
        this.rooms.delete(roomId);
        this.roomCreationTimes.delete(roomId);
      }
    }

    if (toDelete.length > 0) {
      console.log(`[Room Janitor] Cleaned up ${toDelete.length} room(s). Active rooms: ${this.rooms.size}`);
    }
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getPlayerCount(): number {
    return this.wsPlayers.size;
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
