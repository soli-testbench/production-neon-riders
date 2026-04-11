import { Direction } from '../shared/types.js';

export type DirectionCallback = (direction: Direction) => void;

const SWIPE_THRESHOLD = 30;

export class InputHandler {
  private callback: DirectionCallback | null = null;
  private keyHandler: (e: KeyboardEvent) => void;
  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartHandler: (e: TouchEvent) => void;
  private touchMoveHandler: (e: TouchEvent) => void;
  private touchEndHandler: (e: TouchEvent) => void;

  constructor() {
    this.keyHandler = this.handleKeyDown.bind(this);
    window.addEventListener('keydown', this.keyHandler);

    this.touchStartHandler = this.handleTouchStart.bind(this);
    this.touchMoveHandler = this.handleTouchMove.bind(this);
    this.touchEndHandler = this.handleTouchEnd.bind(this);

    document.addEventListener('touchstart', this.touchStartHandler, { passive: false });
    document.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
    document.addEventListener('touchend', this.touchEndHandler, { passive: false });
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

  private handleTouchStart(e: TouchEvent): void {
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
      e.preventDefault();
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    e.preventDefault();
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      const dx = touch.clientX - this.touchStartX;
      const dy = touch.clientY - this.touchStartY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx < SWIPE_THRESHOLD && absDy < SWIPE_THRESHOLD) {
        return;
      }

      let direction: Direction | null = null;

      if (absDx > absDy) {
        direction = dx > 0 ? 'right' : 'left';
      } else {
        direction = dy > 0 ? 'down' : 'up';
      }

      if (direction && this.callback) {
        e.preventDefault();
        this.callback(direction);
      }
    }
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('touchstart', this.touchStartHandler);
    document.removeEventListener('touchmove', this.touchMoveHandler);
    document.removeEventListener('touchend', this.touchEndHandler);
  }
}
