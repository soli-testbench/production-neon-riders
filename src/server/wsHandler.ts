import { WebSocket } from 'ws';
import { GameRoom } from './gameRoom.js';
import { ClientMessage, ServerMessage } from '../shared/protocol.js';
import { NEON_COLORS } from '../shared/types.js';

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

  handleConnection(ws: WebSocket): void {
    const playerId = generateId();
    this.wsPlayers.set(ws, playerId);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;
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

  private handleMessage(ws: WebSocket, playerId: string, msg: ClientMessage): void {
    switch (msg.type) {
      case 'create_room': {
        const roomId = generateRoomCode();
        const room = new GameRoom(roomId);
        this.rooms.set(roomId, room);

        const validColor = NEON_COLORS.includes(msg.color) ? msg.color : NEON_COLORS[0];
        room.addPlayer(playerId, msg.name, validColor, ws);
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

        const validColor = NEON_COLORS.includes(msg.color) ? msg.color : NEON_COLORS[0];
        const added = room.addPlayer(playerId, msg.name, validColor, ws);
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

      case 'leave_room': {
        this.leaveRoom(playerId);
        break;
      }
    }
  }

  private handleDisconnect(ws: WebSocket, playerId: string): void {
    this.leaveRoom(playerId);
    this.wsPlayers.delete(ws);
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

  getRoomCount(): number {
    return this.rooms.size;
  }

  getPlayerCount(): number {
    return this.wsPlayers.size;
  }
}
