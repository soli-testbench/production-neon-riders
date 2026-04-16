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
  private enabled = false;

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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Don't capture WASD keys when an input/textarea has focus
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

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
      // Only prevent default scrolling/gestures during active gameplay.
      // In the lobby/game-over screens we must let touches pass through
      // so users can scroll, tap inputs, and select text normally.
      if (this.enabled) {
        e.preventDefault();
      }
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    if (this.enabled) {
      e.preventDefault();
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (!this.enabled) return;
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
