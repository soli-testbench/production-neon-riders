export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  alive: boolean;
}

export function renderPlayerList(container: HTMLElement, players: PlayerInfo[]): void {
  container.innerHTML = '';
  players.forEach((p) => {
    const item = document.createElement('div');
    item.className = 'player-item';

    const dot = document.createElement('div');
    dot.className = 'player-color-dot';
    dot.style.backgroundColor = p.color;
    dot.style.boxShadow = `0 0 6px ${p.color}`;

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
