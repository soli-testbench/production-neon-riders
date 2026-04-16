import { NEON_COLORS, sanitizeColor } from '../../shared/types.js';
import { NetworkClient } from '../network.js';
import { ServerMessage, PlayerResult } from '../../shared/protocol.js';

export class LobbyUI {
  private network: NetworkClient;
  private selectedColor: string;
  private playerId: string | null = null;
  private isHost = false;
  private currentRoomId: string | null = null;
  private onGameStart: (() => void) | null = null;

  // DOM Elements
  private lobbyOverlay: HTMLElement;
  private nameInput: HTMLInputElement;
  private colorPicker: HTMLElement;
  private menuButtons: HTMLElement;
  private roomSection: HTMLElement;
  private roomCodeDisplay: HTMLElement;
  private playerList: HTMLElement;
  private startBtn: HTMLElement;
  private countdownDisplay: HTMLElement;
  private createRoomBtn: HTMLElement;
  private joinRoomBtn: HTMLElement;
  private roomCodeInput: HTMLInputElement;
  private leaveRoomBtn: HTMLElement;
  private gameoverOverlay: HTMLElement;
  private gameoverMessage: HTMLElement;
  private backLobbyBtn: HTMLElement;
  private playAgainBtn: HTMLElement;
  private hud: HTMLElement;
  private hudPlayers: HTMLElement;

  // HUD caching to avoid DOM thrashing
  private cachedHudState: Map<string, { name: string; color: string; alive: boolean; element: HTMLElement }> = new Map();
  private cachedHudOrder: string[] = [];

  constructor(network: NetworkClient) {
    this.network = network;
    // Load saved color or default to first
    const savedColor = localStorage.getItem('neon-riders-color');
    this.selectedColor = savedColor && NEON_COLORS.includes(savedColor) ? savedColor : NEON_COLORS[0];

    // Get DOM elements
    this.lobbyOverlay = document.getElementById('lobby-overlay')!;
    this.nameInput = document.getElementById('player-name') as HTMLInputElement;
    this.colorPicker = document.getElementById('color-picker')!;
    this.menuButtons = document.getElementById('menu-buttons')!;
    this.roomSection = document.getElementById('room-section')!;
    this.roomCodeDisplay = document.getElementById('room-code-display')!;
    this.playerList = document.getElementById('player-list')!;
    this.startBtn = document.getElementById('btn-start-game')!;
    this.countdownDisplay = document.getElementById('countdown-display')!;
    this.createRoomBtn = document.getElementById('btn-create-room')!;
    this.joinRoomBtn = document.getElementById('btn-join-room')!;
    this.roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;
    this.leaveRoomBtn = document.getElementById('btn-leave-room')!;
    this.gameoverOverlay = document.getElementById('gameover-overlay')!;
    this.gameoverMessage = document.getElementById('gameover-message')!;
    this.backLobbyBtn = document.getElementById('btn-back-lobby')!;
    this.playAgainBtn = document.getElementById('btn-play-again')!;
    this.hud = document.getElementById('hud')!;
    this.hudPlayers = document.getElementById('hud-players')!;

    this.initColorPicker();
    this.loadSavedName();
    this.bindEvents();
  }

  private initColorPicker(): void {
    while (this.colorPicker.firstChild) this.colorPicker.removeChild(this.colorPicker.firstChild);
    NEON_COLORS.forEach((color) => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch' + (color === this.selectedColor ? ' selected' : '');
      swatch.style.backgroundColor = color;
      swatch.style.setProperty('--swatch-color', color);
      swatch.style.boxShadow = `0 0 8px ${color}44`;
      swatch.addEventListener('click', () => {
        this.colorPicker.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
        swatch.classList.add('selected');
        this.selectedColor = color;
      });
      this.colorPicker.appendChild(swatch);
    });
  }

  private loadSavedName(): void {
    const saved = localStorage.getItem('neon-riders-name');
    if (saved) {
      this.nameInput.value = saved;
    }
  }

  private saveName(): void {
    localStorage.setItem('neon-riders-name', this.nameInput.value);
  }

  private saveColor(): void {
    localStorage.setItem('neon-riders-color', this.selectedColor);
  }

  private getName(): string {
    return this.nameInput.value.trim() || 'Rider';
  }

  private bindEvents(): void {
    this.createRoomBtn.addEventListener('click', () => {
      this.saveName();
      this.saveColor();
      this.network.send({
        type: 'create_room',
        name: this.getName(),
        color: this.selectedColor,
      });
    });

    this.joinRoomBtn.addEventListener('click', () => {
      const roomId = this.roomCodeInput.value.trim().toUpperCase();
      if (!roomId) return;
      this.saveName();
      this.saveColor();
      this.network.send({
        type: 'join',
        name: this.getName(),
        color: this.selectedColor,
        roomId,
      });
    });

    this.startBtn.addEventListener('click', () => {
      this.network.send({ type: 'start_game' });
    });

    this.leaveRoomBtn.addEventListener('click', () => {
      this.network.send({ type: 'leave_room' });
      this.showMenu();
    });

    const addAiBtn = document.getElementById('btn-add-ai');
    const removeAiBtn = document.getElementById('btn-remove-ai');
    if (addAiBtn) {
      addAiBtn.addEventListener('click', () => {
        this.network.send({ type: 'add_ai' });
      });
    }
    if (removeAiBtn) {
      removeAiBtn.addEventListener('click', () => {
        this.network.send({ type: 'remove_ai' });
      });
    }

    const toggleLeaderboardBtn = document.getElementById('btn-toggle-leaderboard');
    const closeLeaderboardBtn = document.getElementById('btn-close-leaderboard');
    const leaderboardSection = document.getElementById('leaderboard-section');

    if (toggleLeaderboardBtn && leaderboardSection) {
      toggleLeaderboardBtn.addEventListener('click', () => {
        const visible = leaderboardSection.style.display !== 'none';
        leaderboardSection.style.display = visible ? 'none' : '';
        if (!visible) this.fetchLeaderboard();
      });
    }
    if (closeLeaderboardBtn && leaderboardSection) {
      closeLeaderboardBtn.addEventListener('click', () => {
        leaderboardSection.style.display = 'none';
      });
    }

    this.backLobbyBtn.addEventListener('click', () => {
      this.gameoverOverlay.style.display = 'none';
      this.hud.style.display = 'none';
      this.lobbyOverlay.style.display = 'flex';
      if (this.currentRoomId) {
        this.showRoom(this.currentRoomId);
      } else {
        this.showMenu();
      }
    });

    this.playAgainBtn.addEventListener('click', () => {
      this.network.send({ type: 'start_game' });
    });

    // Enter key on name input focuses room code input
    this.nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.roomCodeInput.focus();
      }
    });

    // Enter key on room code input triggers join
    this.roomCodeInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const roomId = this.roomCodeInput.value.trim().toUpperCase();
        if (!roomId) return;
        this.saveName();
        this.saveColor();
        this.network.send({
          type: 'join',
          name: this.getName(),
          color: this.selectedColor,
          roomId,
        });
      }
    });
  }

  private showMenu(): void {
    this.menuButtons.style.display = '';
    this.roomSection.style.display = 'none';
    this.countdownDisplay.style.display = 'none';
    (document.getElementById('name-section') as HTMLElement).style.display = '';
    (document.getElementById('color-section') as HTMLElement).style.display = '';
  }

  private showRoom(roomId: string): void {
    this.menuButtons.style.display = 'none';
    this.roomSection.style.display = '';
    this.roomCodeDisplay.textContent = roomId;
    this.countdownDisplay.style.display = 'none';
    (document.getElementById('name-section') as HTMLElement).style.display = 'none';
    (document.getElementById('color-section') as HTMLElement).style.display = 'none';

    const aiControls = document.getElementById('ai-controls') as HTMLElement;
    if (this.isHost) {
      this.startBtn.style.display = '';
      if (aiControls) aiControls.style.display = '';
    } else {
      this.startBtn.style.display = 'none';
      if (aiControls) aiControls.style.display = 'none';
    }
  }

  handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'room_created':
        this.playerId = msg.playerId;
        this.isHost = msg.isHost;
        this.currentRoomId = msg.roomId;
        this.showRoom(msg.roomId);
        break;

      case 'room_joined':
        this.playerId = msg.playerId;
        this.isHost = msg.isHost;
        this.currentRoomId = msg.roomId;
        this.showRoom(msg.roomId);
        break;


      case 'countdown':
        this.countdownDisplay.style.display = '';
        this.countdownDisplay.textContent = msg.seconds > 0 ? String(msg.seconds) : 'GO!';
        this.startBtn.style.display = 'none';
        break;

      case 'game_start':
        this.lobbyOverlay.style.display = 'none';
        this.countdownDisplay.style.display = 'none';
        this.hud.style.display = '';
        this.onGameStart?.();
        break;

      case 'state_update':
        this.updateHUD(msg.bikes);
        break;

      case 'player_list': {
        this.renderPlayerList(msg.players);
        // Update host status from server
        if (this.playerId) {
          const me = msg.players.find((p) => p.id === this.playerId);
          if (me) {
            this.isHost = me.isHost;
          }
        }
        // If we're on the room view, update host controls
        if (this.roomSection.style.display !== 'none') {
          const aiControls = document.getElementById('ai-controls') as HTMLElement;
          if (this.isHost) {
            this.startBtn.style.display = '';
            if (aiControls) aiControls.style.display = '';
          } else {
            this.startBtn.style.display = 'none';
            if (aiControls) aiControls.style.display = 'none';
          }
        }
        break;
      }

      case 'game_over':
        // Results display handled by main.ts via showGameOverWithResults
        break;

      case 'error':
        this.showErrorNotification(msg.message);
        break;
    }
  }

  private renderPlayerList(players: { id: string; name: string; color: string; isHost: boolean; isBot: boolean }[]): void {
    while (this.playerList.firstChild) this.playerList.removeChild(this.playerList.firstChild);
    players.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'player-item';

      const dot = document.createElement('div');
      dot.className = 'player-color-dot';
      const safeColor = sanitizeColor(p.color);
      dot.style.backgroundColor = safeColor;
      dot.style.boxShadow = `0 0 6px ${safeColor}`;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = p.name;

      item.appendChild(dot);
      item.appendChild(nameSpan);

      if (p.isBot) {
        const badge = document.createElement('span');
        badge.className = 'player-bot-badge';
        badge.textContent = 'BOT';
        item.appendChild(badge);
      }

      if (p.isHost) {
        const badge = document.createElement('span');
        badge.className = 'player-host-badge';
        badge.textContent = 'HOST';
        item.appendChild(badge);
      }

      this.playerList.appendChild(item);
    });
  }

  private updateHUD(bikes: { id: string; name: string; color: string; alive: boolean }[]): void {
    const newOrder = bikes.map((b) => b.id);

    // Check if player list changed (added/removed/reordered)
    const orderChanged =
      newOrder.length !== this.cachedHudOrder.length ||
      newOrder.some((id, i) => id !== this.cachedHudOrder[i]);

    if (orderChanged) {
      // Full rebuild needed — player list changed
      while (this.hudPlayers.firstChild) this.hudPlayers.removeChild(this.hudPlayers.firstChild);
      this.cachedHudState.clear();

      for (const b of bikes) {
        const el = document.createElement('div');
        el.className = 'hud-player' + (b.alive ? '' : ' dead');

        const dot = document.createElement('div');
        dot.className = 'hud-dot';
        const safeColor = sanitizeColor(b.color);
        dot.style.backgroundColor = safeColor;
        dot.style.boxShadow = `0 0 4px ${safeColor}`;

        const nameSpan = document.createElement('span');
        nameSpan.textContent = b.name;

        el.appendChild(dot);
        el.appendChild(nameSpan);
        this.hudPlayers.appendChild(el);

        this.cachedHudState.set(b.id, { name: b.name, color: b.color, alive: b.alive, element: el });
      }
      this.cachedHudOrder = newOrder;
    } else {
      // Only update alive/dead state changes via CSS class toggling
      for (const b of bikes) {
        const cached = this.cachedHudState.get(b.id);
        if (!cached) continue;

        if (cached.alive !== b.alive) {
          cached.alive = b.alive;
          if (b.alive) {
            cached.element.classList.remove('dead');
          } else {
            cached.element.classList.add('dead');
          }
        }
      }
    }
  }

  private showGameOver(winnerName: string): void {
    this.hud.style.display = 'none';
    this.gameoverOverlay.style.display = 'flex';
    this.gameoverMessage.textContent = winnerName
      ? `${winnerName} wins!`
      : 'Draw!';
    // Show Play Again button only for host
    this.playAgainBtn.style.display = this.isHost ? '' : 'none';
  }

  showGameOverWithResults(winnerName: string, results: PlayerResult[]): void {
    this.showGameOver(winnerName);

    // Remove any existing results table
    const existing = this.gameoverOverlay.querySelector('.results-table');
    if (existing) existing.remove();

    if (results.length === 0) return;

    // Build results table
    const table = document.createElement('table');
    table.className = 'results-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const label of ['#', 'Player', 'Time']) {
      const th = document.createElement('th');
      th.textContent = label;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const result of results) {
      const row = document.createElement('tr');
      const safeColor = sanitizeColor(result.color);
      row.style.setProperty('--row-color', safeColor);

      if (result.placement === 1) {
        row.className = 'results-row-winner';
      }

      // Placement
      const tdPlace = document.createElement('td');
      tdPlace.textContent = String(result.placement);
      row.appendChild(tdPlace);

      // Name with color dot
      const tdName = document.createElement('td');
      const nameCell = document.createElement('div');
      nameCell.className = 'results-name-cell';
      const dot = document.createElement('div');
      dot.className = 'results-color-dot';
      dot.style.backgroundColor = safeColor;
      dot.style.boxShadow = `0 0 6px ${safeColor}`;
      const nameSpan = document.createElement('span');
      nameSpan.textContent = result.name;
      nameSpan.style.color = safeColor;
      nameCell.appendChild(dot);
      nameCell.appendChild(nameSpan);
      tdName.appendChild(nameCell);
      row.appendChild(tdName);

      // Survival time formatted as m:ss
      const tdTime = document.createElement('td');
      const totalSec = Math.floor(result.survivalTime / 1000);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;
      tdTime.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
      row.appendChild(tdTime);

      tbody.appendChild(row);
    }
    table.appendChild(tbody);

    // Insert table before the buttons
    const container = this.gameoverOverlay.querySelector('.gameover-container')!;
    const playAgainBtn = container.querySelector('#btn-play-again')!;
    container.insertBefore(table, playAgainBtn);
  }

  private showErrorNotification(message: string): void {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'neon-error-notification';
    notification.textContent = message;

    // Find or create a container for notifications inside the lobby
    let container = document.getElementById('error-notification-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'error-notification-container';
      container.className = 'error-notification-container';
      this.lobbyOverlay.appendChild(container);
    }

    container.appendChild(notification);

    // Trigger reflow so CSS transition works
    notification.offsetHeight;
    notification.classList.add('visible');

    // Auto-dismiss after 3.5 seconds
    setTimeout(() => {
      notification.classList.remove('visible');
      notification.classList.add('fade-out');
      notification.addEventListener('transitionend', () => {
        notification.remove();
      });
    }, 3500);
  }

  setOnGameStart(cb: () => void): void {
    this.onGameStart = cb;
  }

  private async fetchLeaderboard(): Promise<void> {
    const content = document.getElementById('leaderboard-content');
    if (!content) return;

    content.innerHTML = '<p class="leaderboard-loading">Loading...</p>';

    try {
      const protocol = window.location.protocol;
      const host = window.location.host;
      const res = await fetch(`${protocol}//${host}/api/leaderboard`);
      if (!res.ok) throw new Error('Failed to fetch');

      const entries: { name: string; wins: number; totalGames: number; totalSurvivalTime: number }[] = await res.json();

      if (entries.length === 0) {
        content.innerHTML = '<p class="leaderboard-empty">No games played yet</p>';
        return;
      }

      const table = document.createElement('table');
      table.className = 'leaderboard-table';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      for (const label of ['#', 'Player', 'Wins', 'Games', 'Avg Time']) {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      entries.forEach((entry, idx) => {
        const row = document.createElement('tr');
        if (idx === 0) row.className = 'leaderboard-row-top';

        const tdRank = document.createElement('td');
        tdRank.textContent = String(idx + 1);
        row.appendChild(tdRank);

        const tdName = document.createElement('td');
        tdName.textContent = entry.name;
        row.appendChild(tdName);

        const tdWins = document.createElement('td');
        tdWins.textContent = String(entry.wins);
        row.appendChild(tdWins);

        const tdGames = document.createElement('td');
        tdGames.textContent = String(entry.totalGames);
        row.appendChild(tdGames);

        const tdTime = document.createElement('td');
        const avgMs = entry.totalGames > 0 ? entry.totalSurvivalTime / entry.totalGames : 0;
        const totalSec = Math.floor(avgMs / 1000);
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        tdTime.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
        row.appendChild(tdTime);

        tbody.appendChild(row);
      });
      table.appendChild(tbody);

      content.innerHTML = '';
      content.appendChild(table);
    } catch {
      content.innerHTML = '<p class="leaderboard-empty">Could not load leaderboard</p>';
    }
  }

}
