import { GameCanvas } from './canvas.js';
import { Renderer } from './renderer.js';
import { GameLoop } from './gameLoop.js';
import { InputHandler } from './input.js';
import { NetworkClient } from './network.js';
import { LobbyUI } from './ui/lobby.js';
import { BikeState, ArenaConfig, DEFAULT_ARENA } from '../shared/types.js';
import { ServerMessage, GameStartMessage, StateUpdateMessage } from '../shared/protocol.js';

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

    // Connect to server
    this.network.connect();

    // Start render loop (always running for background animation)
    this.gameLoop.start();
  }

  private handleGameMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'game_start': {
        const startMsg = msg as GameStartMessage;
        this.arena = startMsg.arena;
        this.bikes = startMsg.bikes;
        this.gameActive = true;
        break;
      }
      case 'state_update': {
        const stateMsg = msg as StateUpdateMessage;
        this.bikes = stateMsg.bikes;
        break;
      }
      case 'game_over':
        this.gameActive = false;
        break;
    }
  }

  private update(_dt: number): void {
    // Game state is authoritative from server, no client-side simulation needed
  }

  private render(): void {
    this.renderer.clear();

    if (this.gameActive) {
      this.renderer.drawGrid(this.arena);
      this.renderer.drawBikes(this.bikes);
    } else {
      // Draw background animation when not in game
      this.renderer.drawBackgroundGrid();
    }
  }
}

// Start the game
new Game();
