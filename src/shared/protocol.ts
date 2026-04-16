import { BikeState, Direction, PowerUpState, RampState } from './types.js';

// Client -> Server messages
export interface JoinMessage {
  type: 'join';
  name: string;
  color: string;
  roomId?: string;
}

export interface CreateRoomMessage {
  type: 'create_room';
  name: string;
  color: string;
}

export interface InputMessage {
  type: 'input';
  direction: Direction;
}

export interface StartGameMessage {
  type: 'start_game';
}

export interface LeaveRoomMessage {
  type: 'leave_room';
}

export interface AddAiMessage {
  type: 'add_ai';
}

export interface RemoveAiMessage {
  type: 'remove_ai';
}

export interface QuickPlayMessage {
  type: 'quick_play';
  name: string;
  color: string;
}

export type ClientMessage =
  | JoinMessage
  | CreateRoomMessage
  | InputMessage
  | StartGameMessage
  | LeaveRoomMessage
  | AddAiMessage
  | RemoveAiMessage
  | QuickPlayMessage;

// Server -> Client messages
export interface RoomCreatedMessage {
  type: 'room_created';
  roomId: string;
  playerId: string;
  isHost: boolean;
}

export interface RoomJoinedMessage {
  type: 'room_joined';
  roomId: string;
  playerId: string;
  isHost: boolean;
}

export interface PlayerListMessage {
  type: 'player_list';
  players: { id: string; name: string; color: string; isHost: boolean; isBot: boolean }[];
}

export interface CountdownMessage {
  type: 'countdown';
  seconds: number;
}

export interface GameStartMessage {
  type: 'game_start';
  arena: { width: number; height: number; gridSize: number };
  bikes: BikeState[];
  ramps: RampState[];
}

export interface StateUpdateMessage {
  type: 'state_update';
  bikes: BikeState[];
  timestamp: number;
}

export interface DeathMessage {
  type: 'death';
  playerId: string;
  reason: string;
}

export interface PlayerResult {
  playerId: string;
  name: string;
  color: string;
  placement: number;
  survivalTime: number; // milliseconds
}

export interface GameOverMessage {
  type: 'game_over';
  winnerId: string | null;
  winnerName: string;
  results: PlayerResult[];
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface PlayerDisconnectedMessage {
  type: 'player_disconnected';
  playerId: string;
}

export interface PowerUpSpawnMessage {
  type: 'power_up_spawn';
  powerUps: PowerUpState[];
}

export interface PowerUpCollectedMessage {
  type: 'power_up_collected';
  powerUpId: string;
  playerId: string;
}

export type ServerMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | PlayerListMessage
  | CountdownMessage
  | GameStartMessage
  | StateUpdateMessage
  | DeathMessage
  | GameOverMessage
  | ErrorMessage
  | PlayerDisconnectedMessage
  | PowerUpSpawnMessage
  | PowerUpCollectedMessage;
