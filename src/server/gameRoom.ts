import { WebSocket } from 'ws';
import { BikeState, ArenaConfig, DEFAULT_ARENA, Direction } from '../shared/types.js';
import { createBike, turnBike, moveBike, killBike } from '../shared/bike.js';
import { checkAllCollisions } from '../shared/collision.js';
import {
  ServerMessage,
  PlayerListMessage,
  CountdownMessage,
  GameStartMessage,
  StateUpdateMessage,
  DeathMessage,
  GameOverMessage,
} from '../shared/protocol.js';

interface Player {
  id: string;
  name: string;
  color: string;
  ws: WebSocket;
  isHost: boolean;
}

type RoomState = 'lobby' | 'countdown' | 'playing' | 'ended';

export class GameRoom {
  readonly id: string;
  private players: Map<string, Player> = new Map();
  private bikes: Map<string, BikeState> = new Map();
  private arena: ArenaConfig = { ...DEFAULT_ARENA };
  private state: RoomState = 'lobby';
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private lastTick: number = 0;
  private readonly TICK_RATE = 30; // ticks per second

  constructor(id: string) {
    this.id = id;
  }

  addPlayer(id: string, name: string, color: string, ws: WebSocket): boolean {
    if (this.state !== 'lobby') return false;
    if (this.players.size >= 8) return false;

    const isHost = this.players.size === 0;
    this.players.set(id, { id, name, color, ws, isHost });

    this.broadcastPlayerList();
    return true;
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;

    const wasHost = player.isHost;
    this.players.delete(id);

    // Kill bike if in game
    const bike = this.bikes.get(id);
    if (bike) {
      killBike(bike);
    }

    // Reassign host
    if (wasHost && this.players.size > 0) {
      const newHost = this.players.values().next().value;
      if (newHost) {
        newHost.isHost = true;
      }
    }

    this.broadcast({ type: 'player_disconnected', playerId: id });
    this.broadcastPlayerList();

    // Check game over
    if (this.state === 'playing') {
      this.checkGameOver();
    }
  }

  handleInput(playerId: string, direction: Direction): void {
    if (this.state !== 'playing') return;
    const bike = this.bikes.get(playerId);
    if (bike && bike.alive) {
      turnBike(bike, direction);
    }
  }

  startGame(requesterId: string): void {
    const player = this.players.get(requesterId);
    if (!player || !player.isHost) return;
    if (this.state !== 'lobby') return;
    if (this.players.size < 1) return;

    this.state = 'countdown';
    let countdown = 3;

    this.broadcast({ type: 'countdown', seconds: countdown } as CountdownMessage);

    this.countdownTimer = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        this.broadcast({ type: 'countdown', seconds: countdown } as CountdownMessage);
      } else {
        if (this.countdownTimer) {
          clearInterval(this.countdownTimer);
          this.countdownTimer = null;
        }
        this.broadcast({ type: 'countdown', seconds: 0 } as CountdownMessage);
        setTimeout(() => this.beginGame(), 500);
      }
    }, 1000);
  }

  private beginGame(): void {
    this.state = 'playing';
    this.bikes.clear();

    // Position players in the arena
    const playerArray = Array.from(this.players.values());
    const spawnPositions = this.getSpawnPositions(playerArray.length);

    playerArray.forEach((player, idx) => {
      const spawn = spawnPositions[idx];
      const bike = createBike(
        player.id,
        spawn.x,
        spawn.y,
        spawn.direction,
        player.color,
        player.name,
      );
      this.bikes.set(player.id, bike);
    });

    const bikesArray = Array.from(this.bikes.values());

    const startMsg: GameStartMessage = {
      type: 'game_start',
      arena: this.arena,
      bikes: bikesArray,
    };
    this.broadcast(startMsg);

    // Start tick loop
    this.lastTick = Date.now();
    this.tickInterval = setInterval(() => this.tick(), 1000 / this.TICK_RATE);
  }

  private tick(): void {
    if (this.state !== 'playing') return;

    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;

    // Move all alive bikes
    for (const bike of this.bikes.values()) {
      if (bike.alive) {
        moveBike(bike, dt * 60); // Scale to 60fps equivalent
      }
    }

    // Check collisions
    const bikesArray = Array.from(this.bikes.values());
    const deaths = checkAllCollisions(bikesArray, this.arena);

    for (const death of deaths) {
      const bike = this.bikes.get(death.bikeId);
      if (bike && bike.alive) {
        killBike(bike);
        const deathMsg: DeathMessage = {
          type: 'death',
          playerId: death.bikeId,
          reason: death.reason,
        };
        this.broadcast(deathMsg);
      }
    }

    // Broadcast state
    const stateMsg: StateUpdateMessage = {
      type: 'state_update',
      bikes: bikesArray,
      timestamp: now,
    };
    this.broadcast(stateMsg);

    // Check game over
    if (deaths.length > 0) {
      this.checkGameOver();
    }
  }

  private checkGameOver(): void {
    const aliveBikes = Array.from(this.bikes.values()).filter((b) => b.alive);

    // Game over when 0 or 1 players remain
    if (aliveBikes.length <= 1 && this.bikes.size > 1) {
      this.endGame(aliveBikes[0] || null);
    } else if (aliveBikes.length === 0 && this.bikes.size === 1) {
      // Single player died
      this.endGame(null);
    }
  }

  private endGame(winner: BikeState | null): void {
    this.state = 'ended';

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    const msg: GameOverMessage = {
      type: 'game_over',
      winnerId: winner?.id || null,
      winnerName: winner?.name || '',
    };
    this.broadcast(msg);

    // Reset to lobby after a delay
    setTimeout(() => {
      this.state = 'lobby';
      this.bikes.clear();
      this.broadcastPlayerList();
    }, 3000);
  }

  private getSpawnPositions(count: number): { x: number; y: number; direction: Direction }[] {
    const margin = 80;
    const positions: { x: number; y: number; direction: Direction }[] = [
      { x: margin, y: this.arena.height / 2, direction: 'right' },
      { x: this.arena.width - margin, y: this.arena.height / 2, direction: 'left' },
      { x: this.arena.width / 2, y: margin, direction: 'down' },
      { x: this.arena.width / 2, y: this.arena.height - margin, direction: 'up' },
      { x: margin, y: margin, direction: 'right' },
      { x: this.arena.width - margin, y: margin, direction: 'left' },
      { x: margin, y: this.arena.height - margin, direction: 'right' },
      { x: this.arena.width - margin, y: this.arena.height - margin, direction: 'left' },
    ];

    return positions.slice(0, count);
  }

  private broadcastPlayerList(): void {
    const msg: PlayerListMessage = {
      type: 'player_list',
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isHost: p.isHost,
      })),
    };
    this.broadcast(msg);
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(data);
      }
    }
  }

  isEmpty(): boolean {
    return this.players.size === 0;
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  destroy(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }
  }
}
