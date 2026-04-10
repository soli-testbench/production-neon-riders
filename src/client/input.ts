import { Direction } from '../shared/types.js';

export type DirectionCallback = (direction: Direction) => void;

export class InputHandler {
  private callback: DirectionCallback | null = null;
  private keyHandler: (e: KeyboardEvent) => void;

  constructor() {
    this.keyHandler = this.handleKeyDown.bind(this);
    window.addEventListener('keydown', this.keyHandler);
  }

  onDirection(cb: DirectionCallback): void {
    this.callback = cb;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    let direction: Direction | null = null;

    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        direction = 'up';
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        direction = 'down';
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        direction = 'left';
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        direction = 'right';
        break;
    }

    if (direction && this.callback) {
      e.preventDefault();
      this.callback(direction);
    }
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyHandler);
  }
}
