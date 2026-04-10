import { sanitizeColor } from '../../shared/types.js';

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  alive: boolean;
}

export function renderPlayerList(container: HTMLElement, players: PlayerInfo[]): void {
  while (container.firstChild) container.removeChild(container.firstChild);
  players.forEach((p) => {
    const item = document.createElement('div');
    item.className = 'player-item';

    const dot = document.createElement('div');
    dot.className = 'player-color-dot';
    const safeColor = sanitizeColor(p.color);
    dot.style.backgroundColor = safeColor;
    dot.style.boxShadow = `0 0 6px ${safeColor}`;

    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = p.name;

    item.appendChild(dot);
    item.appendChild(name);

    if (p.isHost) {
      const badge = document.createElement('span');
      badge.className = 'player-host-badge';
      badge.textContent = 'HOST';
      item.appendChild(badge);
    }

    container.appendChild(item);
  });
}
