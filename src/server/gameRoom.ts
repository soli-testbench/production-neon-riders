import { WebSocket } from 'ws';
import {
  BikeState, ArenaConfig, DEFAULT_ARENA, Direction, sanitizeColor, NEON_COLORS, Point,
  PowerUpState, POWER_UP_COLLISION_RADIUS, SPEED_BOOST_MULTIPLIER,
  SPEED_BOOST_DURATION_MS, POWER_UP_RESPAWN_DELAY_MS,
  POWER_UP_COUNT_MIN, POWER_UP_COUNT_MAX, POWER_UP_SPAWN_MARGIN,
  RampState, RAMP_COUNT_MIN, RAMP_COUNT_MAX, RAMP_WIDTH, RAMP_HEIGHT,
  RAMP_SPAWN_MARGIN, JUMP_DURATION_MS,
} from '../shared/types.js';
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
  PlayerResult,
  PowerUpSpawnMessage,
  PowerUpCollectedMessage,
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
  private powerUps: Map<string, PowerUpState> = new Map();
  private powerUpRespawnTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private gameStartTime: number = 0;
  private deathOrder: { playerId: string; timestamp: number }[] = [];
  private ramps: RampState[] = [];

  constructor(id: string) {
    this.id = id;
  }

  addPlayer(id: string, name: string, color: string, ws: WebSocket): boolean {
    if (this.state !== 'lobby') return false;
    if (this.players.size >= 8) return false;

    const isHost = this.players.size === 0;
    const safeName = name.slice(0, 16).replace(/[<>&"'/]/g, '');
    let safeColor = sanitizeColor(color);

    // Ensure unique color: if requested color is taken, assign first unused color
    const usedColors = new Set(Array.from(this.players.values()).map((p) => p.color));
    if (usedColors.has(safeColor)) {
      const unused = NEON_COLORS.find((c) => !usedColors.has(c));
      if (unused) {
        safeColor = unused;
      }
    }

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

    // Handle countdown state: cancel if no human players remain
    if (this.state === 'countdown') {
      const hasHumans = this.hasHumanPlayers();
      if (!hasHumans || this.players.size === 0) {
        // Cancel countdown - only bots remain or room is empty
        if (this.countdownTimer) {
          clearInterval(this.countdownTimer);
          this.countdownTimer = null;
        }
        this.state = 'lobby';
        this.broadcastPlayerList();
        return;
      }
    }

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
    if (this.state !== 'lobby' && this.state !== 'ended') return;
    if (this.players.size < 1) return;

    // If starting from ended state, clear the endGame timeout
    if (this.state === 'ended') {
      if (this.endGameTimeout) {
        clearTimeout(this.endGameTimeout);
        this.endGameTimeout = null;
      }
    }

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
    // Guard: don't start with zero players
    if (this.players.size === 0) {
      this.state = 'lobby';
      return;
    }

    this.state = 'playing';
    this.bikes.clear();
    this.clearPowerUps();
    this.ramps = [];
    this.gameStartTime = Date.now();
    this.deathOrder = [];

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

    // Spawn ramps
    this.spawnRamps();

    const bikesArray = Array.from(this.bikes.values());

    const startMsg: GameStartMessage = {
      type: 'game_start',
      arena: this.arena,
      bikes: bikesArray,
      ramps: this.ramps,
    };
    this.broadcast(startMsg);

    // Spawn power-ups
    this.spawnInitialPowerUps(Array.from(this.bikes.values()));

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

    // Check boost expiry
    this.updateBoosts();

    // Check jump expiry
    this.updateJumps();

    // Move all alive bikes
    for (const bike of this.bikes.values()) {
      if (bike.alive) {
        moveBike(bike, dt);
      }
    }

    // Check ramp collisions (must happen after movement)
    this.checkRampCollisions();

    // Check collisions
    const bikesArray = Array.from(this.bikes.values());
    const deaths = checkAllCollisions(bikesArray, this.arena);

    for (const death of deaths) {
      const bike = this.bikes.get(death.bikeId);
      if (bike && bike.alive) {
        killBike(bike);
        this.deathOrder.push({ playerId: death.bikeId, timestamp: Date.now() });
        const deathMsg: DeathMessage = {
          type: 'death',
          playerId: death.bikeId,
          reason: death.reason,
        };
        this.broadcast(deathMsg);
      }
    }

    // Check power-up collection
    this.checkPowerUpCollisions(bikesArray);

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

  private buildResults(winner: BikeState | null): PlayerResult[] {
    const now = Date.now();
    const results: PlayerResult[] = [];

    // Build a map of playerId -> death timestamp
    const deathTimes = new Map<string, number>();
    for (const d of this.deathOrder) {
      if (!deathTimes.has(d.playerId)) {
        deathTimes.set(d.playerId, d.timestamp);
      }
    }

    // All bikes in the game
    for (const bike of this.bikes.values()) {
      const player = this.players.get(bike.id);
      const deathTime = deathTimes.get(bike.id);
      const survivalTime = deathTime
        ? deathTime - this.gameStartTime
        : now - this.gameStartTime;

      results.push({
        playerId: bike.id,
        name: player?.name || bike.name,
        color: bike.color,
        placement: 0, // computed below
        survivalTime,
      });
    }

    // Sort by survival time descending (longest survival = best placement)
    results.sort((a, b) => b.survivalTime - a.survivalTime);

    // Assign placements - ties for simultaneous deaths
    let placement = 1;
    for (let i = 0; i < results.length; i++) {
      if (i > 0 && results[i].survivalTime === results[i - 1].survivalTime) {
        results[i].placement = results[i - 1].placement; // tied
      } else {
        results[i].placement = placement;
      }
      placement++;
    }

    // If there's a winner, ensure they are placement 1
    if (winner) {
      const winnerResult = results.find((r) => r.playerId === winner.id);
      if (winnerResult) {
        winnerResult.placement = 1;
      }
    }

    return results;
  }

  private endGame(winner: BikeState | null): void {
    this.state = 'ended';

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    this.clearPowerUps();

    const results = this.buildResults(winner);

    const msg: GameOverMessage = {
      type: 'game_over',
      winnerId: winner?.id || null,
      winnerName: winner?.name || '',
      results,
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

      // Ramp awareness: seek ramps when trail danger is high
      for (const ramp of this.ramps) {
        const dx = ramp.x - shortLook.x;
        const dy = ramp.y - shortLook.y;
        const distToRamp = Math.sqrt(dx * dx + dy * dy);
        if (distToRamp < AI_WALL_AVOID_DIST) {
          // Bonus for heading toward a ramp (especially if there's danger)
          score += Math.max(0, (AI_WALL_AVOID_DIST - distToRamp) * 0.5);
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

  hasHumanPlayers(): boolean {
    for (const player of this.players.values()) {
      if (!player.isBot) return true;
    }
    return false;
  }

  getState(): RoomState {
    return this.state;
  }

  getLastActivityTime(): number {
    return this.lastTick || Date.now();
  }

  private spawnInitialPowerUps(bikes: BikeState[]): void {
    const count = POWER_UP_COUNT_MIN + Math.floor(Math.random() * (POWER_UP_COUNT_MAX - POWER_UP_COUNT_MIN + 1));
    for (let i = 0; i < count; i++) {
      const id = 'pu-' + Math.random().toString(36).substring(2, 10);
      const pos = this.getRandomPowerUpPosition(bikes);
      const powerUp: PowerUpState = {
        id,
        x: pos.x,
        y: pos.y,
        type: 'speed_boost',
        active: true,
      };
      this.powerUps.set(id, powerUp);
    }
    this.broadcastPowerUpState();
  }

  private getRandomPowerUpPosition(bikes: BikeState[]): Point {
    const margin = POWER_UP_SPAWN_MARGIN;
    const gridSize = this.arena.gridSize;
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const gridX = Math.floor((margin + Math.random() * (this.arena.width - 2 * margin)) / gridSize);
      const gridY = Math.floor((margin + Math.random() * (this.arena.height - 2 * margin)) / gridSize);
      const x = gridX * gridSize + gridSize / 2;
      const y = gridY * gridSize + gridSize / 2;

      // Check not too close to any bike spawn
      let tooClose = false;
      for (const bike of bikes) {
        const dx = x - bike.x;
        const dy = y - bike.y;
        if (Math.sqrt(dx * dx + dy * dy) < margin) {
          tooClose = true;
          break;
        }
      }

      // Check not too close to existing power-ups
      if (!tooClose) {
        for (const pu of this.powerUps.values()) {
          const dx = x - pu.x;
          const dy = y - pu.y;
          if (Math.sqrt(dx * dx + dy * dy) < gridSize * 3) {
            tooClose = true;
            break;
          }
        }
      }

      if (!tooClose) {
        return { x, y };
      }
    }

    // Fallback: random position within margins
    const x = margin + Math.random() * (this.arena.width - 2 * margin);
    const y = margin + Math.random() * (this.arena.height - 2 * margin);
    return { x, y };
  }

  private checkPowerUpCollisions(bikes: BikeState[]): void {
    for (const bike of bikes) {
      if (!bike.alive) continue;

      for (const powerUp of this.powerUps.values()) {
        if (!powerUp.active) continue;

        const dx = bike.x - powerUp.x;
        const dy = bike.y - powerUp.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < POWER_UP_COLLISION_RADIUS) {
          this.collectPowerUp(powerUp, bike);
        }
      }
    }
  }

  private collectPowerUp(powerUp: PowerUpState, bike: BikeState): void {
    powerUp.active = false;

    // Apply speed boost
    bike.speedMultiplier = SPEED_BOOST_MULTIPLIER;
    bike.boostEndTime = Date.now() + SPEED_BOOST_DURATION_MS;

    // Broadcast collection
    const msg: PowerUpCollectedMessage = {
      type: 'power_up_collected',
      powerUpId: powerUp.id,
      playerId: bike.id,
    };
    this.broadcast(msg);

    // Schedule respawn
    const timer = setTimeout(() => {
      this.powerUpRespawnTimers.delete(powerUp.id);
      if (this.state !== 'playing') return;

      const bikes = Array.from(this.bikes.values());
      const newPos = this.getRandomPowerUpPosition(bikes);
      powerUp.x = newPos.x;
      powerUp.y = newPos.y;
      powerUp.active = true;
      this.broadcastPowerUpState();
    }, POWER_UP_RESPAWN_DELAY_MS);
    this.powerUpRespawnTimers.set(powerUp.id, timer);
  }

  private updateBoosts(): void {
    const now = Date.now();
    for (const bike of this.bikes.values()) {
      if (bike.speedMultiplier && bike.boostEndTime && now >= bike.boostEndTime) {
        bike.speedMultiplier = undefined;
        bike.boostEndTime = undefined;
      }
    }
  }

  private clearPowerUps(): void {
    for (const timer of this.powerUpRespawnTimers.values()) {
      clearTimeout(timer);
    }
    this.powerUpRespawnTimers.clear();
    this.powerUps.clear();
  }

  private broadcastPowerUpState(): void {
    const msg: PowerUpSpawnMessage = {
      type: 'power_up_spawn',
      powerUps: Array.from(this.powerUps.values()),
    };
    this.broadcast(msg);
  }

  private spawnRamps(): void {
    const count = RAMP_COUNT_MIN + Math.floor(Math.random() * (RAMP_COUNT_MAX - RAMP_COUNT_MIN + 1));
    const directions: Direction[] = ['up', 'down', 'left', 'right'];

    for (let i = 0; i < count; i++) {
      const id = 'ramp-' + Math.random().toString(36).substring(2, 10);
      const pos = this.getRandomRampPosition();
      const direction = directions[Math.floor(Math.random() * directions.length)];
      this.ramps.push({
        id,
        x: pos.x,
        y: pos.y,
        direction,
        width: RAMP_WIDTH,
        height: RAMP_HEIGHT,
      });
    }
  }

  private getRandomRampPosition(): Point {
    const margin = RAMP_SPAWN_MARGIN;
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = margin + Math.random() * (this.arena.width - 2 * margin);
      const y = margin + Math.random() * (this.arena.height - 2 * margin);

      // Check not too close to bike spawns
      let tooClose = false;
      for (const bike of this.bikes.values()) {
        const dx = x - bike.x;
        const dy = y - bike.y;
        if (Math.sqrt(dx * dx + dy * dy) < margin) {
          tooClose = true;
          break;
        }
      }

      // Check not too close to other ramps
      if (!tooClose) {
        for (const ramp of this.ramps) {
          const dx = x - ramp.x;
          const dy = y - ramp.y;
          if (Math.sqrt(dx * dx + dy * dy) < RAMP_WIDTH * 3) {
            tooClose = true;
            break;
          }
        }
      }

      if (!tooClose) {
        return { x, y };
      }
    }

    // Fallback
    return {
      x: margin + Math.random() * (this.arena.width - 2 * margin),
      y: margin + Math.random() * (this.arena.height - 2 * margin),
    };
  }

  private checkRampCollisions(): void {
    const now = Date.now();
    for (const bike of this.bikes.values()) {
      if (!bike.alive || bike.jumping) continue;

      for (const ramp of this.ramps) {
        const halfW = ramp.width / 2;
        const halfH = ramp.height / 2;
        if (
          bike.x >= ramp.x - halfW &&
          bike.x <= ramp.x + halfW &&
          bike.y >= ramp.y - halfH &&
          bike.y <= ramp.y + halfH
        ) {
          bike.jumping = true;
          bike.jumpEndTime = now + JUMP_DURATION_MS;
          break;
        }
      }
    }
  }

  private updateJumps(): void {
    const now = Date.now();
    for (const bike of this.bikes.values()) {
      if (bike.jumping && bike.jumpEndTime && now >= bike.jumpEndTime) {
        bike.jumping = false;
        bike.jumpEndTime = undefined;
        // Insert current position as a new trail point so the trail resumes cleanly
        bike.trail.push({ x: bike.x, y: bike.y });
      }
    }
  }

  destroy(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.endGameTimeout) {
      clearTimeout(this.endGameTimeout);
      this.endGameTimeout = null;
    }
    this.clearPowerUps();
    this.ramps = [];
  }
}
