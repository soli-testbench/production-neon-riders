import { GameCanvas } from './canvas.js';
import { Renderer } from './renderer.js';
import { GameLoop } from './gameLoop.js';
import { InputHandler } from './input.js';
import { NetworkClient, ConnectionStatus } from './network.js';
import { LobbyUI } from './ui/lobby.js';
import { BikeInterpolator } from './interpolation.js';
import { Minimap } from './minimap.js';
import { KillFeed } from './killFeed.js';
import { BikeState, ArenaConfig, DEFAULT_ARENA, PowerUpState, RampState } from '../shared/types.js';
import {
  ServerMessage,
  GameStartMessage,
  StateUpdateMessage,
  DeathMessage,
  GameOverMessage,
  RoomCreatedMessage,
  RoomJoinedMessage,
  PowerUpSpawnMessage,
  PowerUpCollectedMessage,
} from '../shared/protocol.js';

class Game {
  private canvas: GameCanvas;
  private renderer: Renderer;
  private gameLoop: GameLoop;
  private input: InputHandler;
  private network: NetworkClient;
  private lobby: LobbyUI;

  private bikes: BikeState[] = [];
  private arena: ArenaConfig = { ...DEFAULT_ARENA };
  private gameActive = false;
  private localPlayerId: string | null = null;
  private particles: Particle[] = [];
  private interpolator: BikeInterpolator = new BikeInterpolator();
  private minimap: Minimap = new Minimap();
  private killFeed: KillFeed = new KillFeed();
  private powerUps: PowerUpState[] = [];
  private ramps: RampState[] = [];
  private localBoostEndTime: number | null = null;
  private spectatorTargetId: string | null = null;
  private isLocalPlayerDead = false;
  private spectatorLabel: HTMLElement | null = null;

  // Death overlay state
  private deathOverlayEl: HTMLElement | null = null;
  private deathOverlayHideTimer: number | null = null;
  private pendingSpectatorTimer: number | null = null;
  private lastDeathReason: string | null = null;
  private localDeathPlacement: number | null = null;
  private totalPlayersAtDeath: number | null = null;
  private static readonly DEATH_OVERLAY_DURATION_MS = 1800;

  constructor() {
    this.canvas = new GameCanvas('game-canvas');
    this.renderer = new Renderer(this.canvas);
    this.input = new InputHandler();
    this.network = new NetworkClient();
    this.lobby = new LobbyUI(this.network);

    this.gameLoop = new GameLoop(
      (dt) => this.update(dt),
      () => this.render(),
    );

    this.setup();
  }

  private setup(): void {
    // Network message handling
    this.network.onMessage((msg: ServerMessage) => {
      this.lobby.handleMessage(msg);
      this.handleGameMessage(msg);
    });

    // Input handling
    this.input.onDirection((direction) => {
      if (this.gameActive) {
        if (this.isLocalPlayerDead) {
          // Spectator mode: cycle through alive players
          this.cycleSpectatorTarget(direction === 'right' || direction === 'down' ? 1 : -1);
        } else {
          this.network.send({ type: 'input', direction });
        }
      }
    });

    // Lobby game start callback
    this.lobby.setOnGameStart(() => {
      this.gameActive = true;
    });

    // Connection status indicator
    this.network.onStatusChange((status: ConnectionStatus) => {
      this.updateConnectionStatus(status);
    });

    // Minimap click for spectator target
    this.minimap.setOnBikeClick((bikeId: string) => {
      this.handleMinimapClick(bikeId);
    });

    // Connect to server
    this.network.connect();

    // Start render loop (always running for background animation)
    this.gameLoop.start();
  }

  private updateConnectionStatus(status: ConnectionStatus): void {
    const el = document.getElementById('connection-status');
    if (!el) return;

    el.className = status;

    switch (status) {
      case 'connected':
        el.textContent = 'Connected';
        // Fade out after a moment
        setTimeout(() => {
          if (this.network.getStatus() === 'connected') {
            el.style.opacity = '0';
          }
        }, 2000);
        break;
      case 'connecting':
        el.style.opacity = '1';
        el.textContent = 'Connecting...';
        break;
      case 'disconnected': {
        el.style.opacity = '1';
        const attempts = this.network.getReconnectAttempts();
        const max = this.network.getMaxReconnectAttempts();
        if (attempts >= max) {
          el.innerHTML = 'Connection lost';
          const retryBtn = document.createElement('button');
          retryBtn.className = 'retry-btn';
          retryBtn.textContent = 'Retry';
          retryBtn.addEventListener('click', () => {
            this.network.manualReconnect();
          });
          el.appendChild(retryBtn);
        } else {
          el.textContent = 'Disconnected';
        }
        break;
      }
    }
  }

  private handleGameMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'room_created': {
        const roomMsg = msg as RoomCreatedMessage;
        this.localPlayerId = roomMsg.playerId;
        this.renderer.setLocalPlayerId(roomMsg.playerId);
        break;
      }
      case 'room_joined': {
        const joinMsg = msg as RoomJoinedMessage;
        this.localPlayerId = joinMsg.playerId;
        this.renderer.setLocalPlayerId(joinMsg.playerId);
        break;
      }
      case 'game_start': {
        const startMsg = msg as GameStartMessage;
        this.arena = startMsg.arena;
        this.bikes = startMsg.bikes;
        this.ramps = startMsg.ramps || [];
        this.gameActive = true;
        this.isLocalPlayerDead = false;
        this.spectatorTargetId = null;
        this.renderer.setPlayerDead(false);
        if (this.localPlayerId) {
          this.renderer.setFollowTarget(this.localPlayerId);
        }
        this.hideSpectatorLabel();
        this.hideDeathOverlayImmediate();
        this.lastDeathReason = null;
        this.localDeathPlacement = null;
        this.totalPlayersAtDeath = null;
        this.interpolator.clear();
        this.interpolator.pushServerState(this.bikes, performance.now());
        this.minimap.show();
        this.killFeed.show();
        // Enable touch input (calls preventDefault) only during active gameplay.
        this.input.setEnabled(true);
        break;
      }
      case 'state_update': {
        const stateMsg = msg as StateUpdateMessage;
        this.bikes = stateMsg.bikes;
        this.interpolator.pushServerState(this.bikes, performance.now());
        // Check if local player died
        if (this.localPlayerId) {
          const localBike = this.bikes.find((b) => b.id === this.localPlayerId);
          if (localBike && !localBike.alive && !this.isLocalPlayerDead) {
            this.isLocalPlayerDead = true;
            this.renderer.setPlayerDead(true);
            // Touch input should no longer block the page — the local player is
            // now spectating (handled via this.gameActive/dead flag in main.ts)
            // but we keep input listeners enabled for swipe-based spectator cycling.
            // Compute placement at time of death: remaining alive players finish
            // ahead of us, so our placement is (alive remaining) + 1.
            const aliveCount = this.bikes.filter((b) => b.alive).length;
            this.totalPlayersAtDeath = this.bikes.length;
            this.localDeathPlacement = aliveCount + 1;
            // Show the death overlay, then smoothly fade into spectator mode.
            this.showDeathOverlay();
          }
        }
        // If spectating and the spectated player died, auto-switch
        if (this.spectatorTargetId) {
          const spectatedBike = this.bikes.find((b) => b.id === this.spectatorTargetId);
          if (spectatedBike && !spectatedBike.alive) {
            this.autoSelectSpectatorTarget();
          }
        }
        break;
      }
      case 'death': {
        const deathMsg = msg as DeathMessage;
        const deadBike = this.bikes.find((b) => b.id === deathMsg.playerId);
        if (deadBike) {
          this.spawnDeathParticles(deadBike.x, deadBike.y, deadBike.color);
          this.killFeed.addEntry(deadBike.name, deadBike.color, deathMsg.reason);
        }
        // Capture reason for the local player's death overlay. The death
        // message may arrive before or after the state_update that flips the
        // local player's alive flag, so handle both orderings.
        if (deathMsg.playerId === this.localPlayerId) {
          this.lastDeathReason = deathMsg.reason;
          if (this.isLocalPlayerDead && this.deathOverlayEl) {
            this.updateDeathOverlayReason();
          }
        }
        break;
      }
      case 'game_over': {
        const gameOverMsg = msg as GameOverMessage;
        this.gameActive = false;
        this.isLocalPlayerDead = false;
        this.spectatorTargetId = null;
        this.renderer.setPlayerDead(false);
        this.hideSpectatorLabel();
        this.hideDeathOverlayImmediate();
        this.interpolator.clear();
        this.minimap.hide();
        this.killFeed.hide();
        this.powerUps = [];
        this.ramps = [];
        this.localBoostEndTime = null;
        // Disable touch input preventDefault so lobby UI is usable again.
        this.input.setEnabled(false);
        this.lobby.showGameOverWithResults(gameOverMsg.winnerName, gameOverMsg.results || []);
        break;
      }
      case 'power_up_spawn': {
        const puMsg = msg as PowerUpSpawnMessage;
        this.powerUps = puMsg.powerUps;
        break;
      }
      case 'power_up_collected': {
        const collectMsg = msg as PowerUpCollectedMessage;
        // Remove collected power-up from local state
        this.powerUps = this.powerUps.map((pu) =>
          pu.id === collectMsg.powerUpId ? { ...pu, active: false } : pu,
        );
        // Track local boost
        if (collectMsg.playerId === this.localPlayerId) {
          this.localBoostEndTime = Date.now() + 3000;
        }
        break;
      }
    }
  }

  private getAliveBikes(): BikeState[] {
    return this.bikes.filter((b) => b.alive && b.id !== this.localPlayerId);
  }

  private cycleSpectatorTarget(delta: number): void {
    const alive = this.getAliveBikes();
    if (alive.length === 0) {
      this.spectatorTargetId = null;
      this.hideSpectatorLabel();
      if (this.localPlayerId) {
        this.renderer.setFollowTarget(this.localPlayerId);
      }
      return;
    }

    const currentIdx = alive.findIndex((b) => b.id === this.spectatorTargetId);
    let nextIdx: number;
    if (currentIdx === -1) {
      nextIdx = 0;
    } else {
      nextIdx = (currentIdx + delta + alive.length) % alive.length;
    }

    this.spectatorTargetId = alive[nextIdx].id;
    this.renderer.setFollowTarget(this.spectatorTargetId);
    this.showSpectatorLabel(alive[nextIdx].name, alive[nextIdx].color);
  }

  private autoSelectSpectatorTarget(): void {
    const alive = this.getAliveBikes();
    if (alive.length === 0) {
      this.spectatorTargetId = null;
      this.hideSpectatorLabel();
      if (this.localPlayerId) {
        this.renderer.setFollowTarget(this.localPlayerId);
      }
      return;
    }

    this.spectatorTargetId = alive[0].id;
    this.renderer.setFollowTarget(this.spectatorTargetId);
    this.showSpectatorLabel(alive[0].name, alive[0].color);
  }

  private showSpectatorLabel(name: string, color: string): void {
    if (!this.spectatorLabel) {
      this.spectatorLabel = document.getElementById('spectator-label');
    }
    if (this.spectatorLabel) {
      this.spectatorLabel.textContent = `Spectating: ${name}`;
      this.spectatorLabel.style.color = color;
      this.spectatorLabel.style.borderColor = color;
      this.spectatorLabel.style.display = 'block';
    }
  }

  private hideSpectatorLabel(): void {
    if (!this.spectatorLabel) {
      this.spectatorLabel = document.getElementById('spectator-label');
    }
    if (this.spectatorLabel) {
      this.spectatorLabel.style.display = 'none';
    }
  }

  // ----- Death overlay -----

  private ensureDeathOverlay(): HTMLElement {
    if (this.deathOverlayEl) return this.deathOverlayEl;
    const el = document.createElement('div');
    el.id = 'death-overlay';
    el.className = 'death-overlay';
    el.innerHTML = `
      <div class="death-flash"></div>
      <div class="death-overlay-content">
        <h2 class="death-title">CRASHED</h2>
        <p class="death-reason"></p>
        <p class="death-placement"></p>
      </div>
    `;
    document.body.appendChild(el);
    this.deathOverlayEl = el;
    return el;
  }

  private formatPlacement(n: number): string {
    // 1 -> 1st, 2 -> 2nd, 3 -> 3rd, else -> Nth
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    switch (n % 10) {
      case 1:
        return `${n}st`;
      case 2:
        return `${n}nd`;
      case 3:
        return `${n}rd`;
      default:
        return `${n}th`;
    }
  }

  private updateDeathOverlayReason(): void {
    if (!this.deathOverlayEl) return;
    const reasonEl = this.deathOverlayEl.querySelector('.death-reason') as HTMLElement | null;
    if (reasonEl) {
      reasonEl.textContent = this.lastDeathReason || '';
    }
  }

  private showDeathOverlay(): void {
    const el = this.ensureDeathOverlay();

    // Clear any lingering timers from a previous death overlay.
    if (this.deathOverlayHideTimer !== null) {
      window.clearTimeout(this.deathOverlayHideTimer);
      this.deathOverlayHideTimer = null;
    }
    if (this.pendingSpectatorTimer !== null) {
      window.clearTimeout(this.pendingSpectatorTimer);
      this.pendingSpectatorTimer = null;
    }

    const reasonEl = el.querySelector('.death-reason') as HTMLElement | null;
    const placementEl = el.querySelector('.death-placement') as HTMLElement | null;
    if (reasonEl) {
      reasonEl.textContent = this.lastDeathReason || '';
    }
    if (placementEl) {
      if (this.localDeathPlacement !== null && this.totalPlayersAtDeath !== null) {
        placementEl.textContent = `${this.formatPlacement(this.localDeathPlacement)} of ${this.totalPlayersAtDeath}`;
      } else {
        placementEl.textContent = '';
      }
    }

    // Reset classes so the flash/fade animations re-trigger.
    el.classList.remove('fade-out');
    // Force reflow to restart CSS animations.
    void el.offsetHeight;
    el.classList.add('visible');

    // After the configured duration, start the spectator transition AND
    // begin fading out the overlay in parallel so they cross-fade smoothly.
    this.pendingSpectatorTimer = window.setTimeout(() => {
      this.pendingSpectatorTimer = null;
      this.autoSelectSpectatorTarget();
      this.beginDeathOverlayFadeOut();
    }, Game.DEATH_OVERLAY_DURATION_MS);
  }

  private beginDeathOverlayFadeOut(): void {
    if (!this.deathOverlayEl) return;
    this.deathOverlayEl.classList.add('fade-out');
    if (this.deathOverlayHideTimer !== null) {
      window.clearTimeout(this.deathOverlayHideTimer);
    }
    this.deathOverlayHideTimer = window.setTimeout(() => {
      this.deathOverlayHideTimer = null;
      if (this.deathOverlayEl) {
        this.deathOverlayEl.classList.remove('visible', 'fade-out');
      }
    }, 600);
  }

  private hideDeathOverlayImmediate(): void {
    if (this.pendingSpectatorTimer !== null) {
      window.clearTimeout(this.pendingSpectatorTimer);
      this.pendingSpectatorTimer = null;
    }
    if (this.deathOverlayHideTimer !== null) {
      window.clearTimeout(this.deathOverlayHideTimer);
      this.deathOverlayHideTimer = null;
    }
    if (this.deathOverlayEl) {
      this.deathOverlayEl.classList.remove('visible', 'fade-out');
    }
  }

  handleMinimapClick(bikeId: string): void {
    if (!this.isLocalPlayerDead || !this.gameActive) return;
    const bike = this.bikes.find((b) => b.id === bikeId && b.alive);
    if (bike) {
      this.spectatorTargetId = bike.id;
      this.renderer.setFollowTarget(bike.id);
      this.showSpectatorLabel(bike.name, bike.color);
    }
  }

  private spawnDeathParticles(x: number, y: number, color: string): void {
    const count = 25;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 80 + Math.random() * 120;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        life: 1.0,
        decay: 0.8 + Math.random() * 0.4,
        size: 2 + Math.random() * 3,
      });
    }
  }

  private update(_dt: number): void {
    // Update particles
    if (this.particles.length > 0) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * _dt;
        p.y += p.vy * _dt;
        p.life -= p.decay * _dt;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
        }
      }
    }
  }

  private render(): void {
    this.renderer.clear();

    if (this.gameActive) {
      const renderBikes = this.interpolator.getInterpolatedBikes(this.bikes);
      this.renderer.drawGrid(this.arena, renderBikes);
      this.renderer.drawRamps(this.ramps, this.arena);
      this.renderer.drawPowerUps(this.powerUps, this.arena);
      this.renderer.drawBikes(renderBikes);
      this.renderer.drawParticles(this.particles);
      this.renderer.drawVignette();
      this.renderer.drawBoostHUD(this.localBoostEndTime);
      this.minimap.render(this.arena, renderBikes, this.localPlayerId, this.powerUps);
    } else {
      // Draw background animation when not in game
      this.renderer.drawBackgroundGrid();
    }
  }
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  decay: number;
  size: number;
}

// Start the game
new Game();
