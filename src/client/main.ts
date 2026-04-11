import { GameCanvas } from './canvas.js';
import { Renderer } from './renderer.js';
import { GameLoop } from './gameLoop.js';
import { InputHandler } from './input.js';
import { NetworkClient, ConnectionStatus } from './network.js';
import { LobbyUI } from './ui/lobby.js';
import { BikeState, ArenaConfig, DEFAULT_ARENA } from '../shared/types.js';
import {
  ServerMessage,
  GameStartMessage,
  StateUpdateMessage,
  DeathMessage,
  RoomCreatedMessage,
  RoomJoinedMessage,
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
        this.network.send({ type: 'input', direction });
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
        this.gameActive = true;
        this.renderer.setPlayerDead(false);
        break;
      }
      case 'state_update': {
        const stateMsg = msg as StateUpdateMessage;
        this.bikes = stateMsg.bikes;
        // Check if local player died
        if (this.localPlayerId) {
          const localBike = this.bikes.find((b) => b.id === this.localPlayerId);
          if (localBike && !localBike.alive) {
            this.renderer.setPlayerDead(true);
          }
        }
        break;
      }
      case 'death': {
        const deathMsg = msg as DeathMessage;
        const deadBike = this.bikes.find((b) => b.id === deathMsg.playerId);
        if (deadBike) {
          this.spawnDeathParticles(deadBike.x, deadBike.y, deadBike.color);
        }
        break;
      }
      case 'game_over':
        this.gameActive = false;
        this.renderer.setPlayerDead(false);
        break;
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
      this.renderer.drawGrid(this.arena, this.bikes);
      this.renderer.drawBikes(this.bikes);
      this.renderer.drawParticles(this.particles);
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
