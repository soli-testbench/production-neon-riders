import { WebSocket } from 'ws';
import { BikeState, ArenaConfig, DEFAULT_ARENA, Direction, sanitizeColor, NEON_COLORS, Point } from '../shared/types.js';
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
  isBot: boolean;
}

const BOT_NAMES = [
  'Bot-Alpha', 'Bot-Neon', 'Bot-Blitz', 'Bot-Phantom',
  'Bot-Surge', 'Bot-Volt', 'Bot-Flux', 'Bot-Spark',
];

const MAX_BOTS = 3;
const AI_WALL_AVOID_DIST = 200;
const AI_TRAIL_AVOID_DIST = 100;

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
  private endGameTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string) {
    this.id = id;
  }

  addPlayer(id: string, name: string, color: string, ws: WebSocket): boolean {
    if (this.state !== 'lobby') return false;
    if (this.players.size >= 8) return false;

    const isHost = this.players.size === 0;
    const safeName = name.slice(0, 16).replace(/[<>&"'/]/g, '');
    const safeColor = sanitizeColor(color);
    this.players.set(id, { id, name: safeName, color: safeColor, ws, isHost, isBot: false });

    this.broadcastPlayerList();
    return true;
  }

  addAi(requesterId: string): boolean {
    const requester = this.players.get(requesterId);
    if (!requester || !requester.isHost) return false;
    if (this.state !== 'lobby') return false;

    const botCount = Array.from(this.players.values()).filter((p) => p.isBot).length;
    if (botCount >= MAX_BOTS) return false;
    if (this.players.size >= 8) return false;

    const botId = 'bot-' + Math.random().toString(36).substring(2, 10);
    const usedNames = new Set(Array.from(this.players.values()).map((p) => p.name));
    let botName = BOT_NAMES[botCount] || 'Bot-' + (botCount + 1);
    while (usedNames.has(botName)) {
      botName = 'Bot-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    const usedColors = new Set(Array.from(this.players.values()).map((p) => p.color));
    let botColor = NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
    for (const c of NEON_COLORS) {
      if (!usedColors.has(c)) {
        botColor = c;
        break;
      }
    }

    // Bots use a dummy WebSocket-like object; they never receive messages
    const dummyWs = { readyState: 0, send: () => {} } as unknown as WebSocket;
    this.players.set(botId, {
      id: botId,
      name: botName,
      color: botColor,
      ws: dummyWs,
      isHost: false,
      isBot: true,
    });

    this.broadcastPlayerList();
    return true;
  }

  removeAi(requesterId: string): boolean {
    const requester = this.players.get(requesterId);
    if (!requester || !requester.isHost) return false;
    if (this.state !== 'lobby') return false;

    const bots = Array.from(this.players.values()).filter((p) => p.isBot);
    if (bots.length === 0) return false;

    const lastBot = bots[bots.length - 1];
    this.players.delete(lastBot.id);
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

    // AI decision-making
    this.updateAiBikes();

    // Move all alive bikes
    for (const bike of this.bikes.values()) {
      if (bike.alive) {
        moveBike(bike, dt);
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
    this.endGameTimeout = setTimeout(() => {
      this.endGameTimeout = null;
      this.state = 'lobby';
      this.bikes.clear();
      this.broadcastPlayerList();
    }, 3000);
  }

  private getSpawnPositions(count: number): { x: number; y: number; direction: Direction }[] {
    const margin = 240;
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

  private updateAiBikes(): void {
    const bikesArray = Array.from(this.bikes.values());

    for (const player of this.players.values()) {
      if (!player.isBot) continue;
      const bike = this.bikes.get(player.id);
      if (!bike || !bike.alive) continue;

      const newDir = this.computeAiDirection(bike, bikesArray);
      if (newDir !== null) {
        turnBike(bike, newDir);
      }
    }
  }

  private computeAiDirection(bike: BikeState, allBikes: BikeState[]): Direction | null {
    const directions: Direction[] = ['up', 'down', 'left', 'right'];
    const opposites: Record<Direction, Direction> = {
      up: 'down',
      down: 'up',
      left: 'right',
      right: 'left',
    };

    // Filter out opposite direction (can't 180)
    const candidates = directions.filter((d) => d !== opposites[bike.direction]);

    // Score each candidate direction
    const scored: { dir: Direction; score: number }[] = [];
    for (const dir of candidates) {
      let score = 0;

      // Simulate a position in this direction
      const lookAhead = AI_WALL_AVOID_DIST;
      const futurePos = this.projectPosition(bike, dir, lookAhead);

      // Wall avoidance: check distance to walls
      const wallDistX = Math.min(futurePos.x, this.arena.width - futurePos.x);
      const wallDistY = Math.min(futurePos.y, this.arena.height - futurePos.y);
      const minWallDist = Math.min(wallDistX, wallDistY);

      if (minWallDist < 0) {
        score -= 1000; // Would go out of bounds
      } else if (minWallDist < AI_WALL_AVOID_DIST) {
        score -= (AI_WALL_AVOID_DIST - minWallDist) * 2;
      }

      // Trail avoidance: check for nearby trail segments
      const shortLook = this.projectPosition(bike, dir, AI_TRAIL_AVOID_DIST);
      for (const other of allBikes) {
        const trail = other.trail;
        for (let i = 0; i < trail.length - 1; i++) {
          const dist = this.distToSegment(shortLook, trail[i], trail[i + 1]);
          if (dist < AI_TRAIL_AVOID_DIST) {
            score -= (AI_TRAIL_AVOID_DIST - dist) * 3;
          }
        }
        // Also check live segment for other bikes
        if (other.alive && trail.length > 0) {
          const lastPt = trail[trail.length - 1];
          const liveEnd: Point = { x: other.x, y: other.y };
          const dist = this.distToSegment(shortLook, lastPt, liveEnd);
          if (dist < AI_TRAIL_AVOID_DIST) {
            score -= (AI_TRAIL_AVOID_DIST - dist) * 3;
          }
        }
      }

      // Prefer continuing straight
      if (dir === bike.direction) {
        score += 10;
      }

      // Occasional random strategic turns
      score += Math.random() * 5;

      scored.push({ dir, score });
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best) return null;

    // Only turn if the current direction is bad or best is a different direction with good reason
    const currentScore = scored.find((s) => s.dir === bike.direction);
    if (currentScore && currentScore.score > -50) {
      // Current direction is fine, only turn occasionally or if better option exists
      if (best.dir === bike.direction) return null;
      if (best.score - currentScore.score < 30) return null;
    }

    return best.dir;
  }

  private projectPosition(bike: BikeState, dir: Direction, distance: number): Point {
    switch (dir) {
      case 'up':
        return { x: bike.x, y: bike.y - distance };
      case 'down':
        return { x: bike.x, y: bike.y + distance };
      case 'left':
        return { x: bike.x - distance, y: bike.y };
      case 'right':
        return { x: bike.x + distance, y: bike.y };
    }
  }

  private distToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
    }
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
  }

  private broadcastPlayerList(): void {
    const msg: PlayerListMessage = {
      type: 'player_list',
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isHost: p.isHost,
        isBot: p.isBot,
      })),
    };
    this.broadcast(msg);
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (!player.isBot && player.ws.readyState === WebSocket.OPEN) {
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
    if (this.endGameTimeout) {
      clearTimeout(this.endGameTimeout);
      this.endGameTimeout = null;
    }
  }
}
