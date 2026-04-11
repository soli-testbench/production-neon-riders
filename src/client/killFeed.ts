import { sanitizeColor } from '../shared/types.js';

export class KillFeed {
  private container: HTMLElement;

  constructor() {
    this.container = document.getElementById('kill-feed')!;
  }

  addEntry(playerName: string, playerColor: string, reason: string): void {
    const entry = document.createElement('div');
    entry.className = 'kill-feed-entry';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'kill-feed-name';
    nameSpan.textContent = playerName;
    const safeColor = sanitizeColor(playerColor);
    nameSpan.style.color = safeColor;
    nameSpan.style.textShadow = `0 0 6px ${safeColor}`;

    const reasonSpan = document.createElement('span');
    reasonSpan.className = 'kill-feed-reason';
    reasonSpan.textContent = reason;

    entry.appendChild(nameSpan);
    entry.appendChild(reasonSpan);
    this.container.appendChild(entry);

    // Trigger reflow then animate in
    entry.offsetHeight;
    entry.classList.add('visible');

    // Auto-dismiss after 4.5 seconds
    setTimeout(() => {
      entry.classList.remove('visible');
      entry.classList.add('fade-out');
      entry.addEventListener('transitionend', () => {
        entry.remove();
      });
    }, 4500);
  }

  show(): void {
    this.container.style.display = '';
  }

  hide(): void {
    this.container.style.display = 'none';
    // Clear all entries
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }
}
