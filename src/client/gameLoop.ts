export type UpdateFn = (dt: number) => void;
export type RenderFn = () => void;

export class GameLoop {
  private lastTime = 0;
  private running = false;
  private rafId = 0;
  private updateFn: UpdateFn;
  private renderFn: RenderFn;
  private fps = 0;
  private frameCount = 0;
  private fpsTime = 0;

  constructor(updateFn: UpdateFn, renderFn: RenderFn) {
    this.updateFn = updateFn;
    this.renderFn = renderFn;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.fpsTime = this.lastTime;
    this.frameCount = 0;
    this.loop(this.lastTime);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getFPS(): number {
    return this.fps;
  }

  private loop = (now: number): void => {
    if (!this.running) return;

    const dt = Math.min((now - this.lastTime) / 1000, 0.1); // Cap at 100ms
    this.lastTime = now;

    // FPS tracking
    this.frameCount++;
    if (now - this.fpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTime = now;
    }

    this.updateFn(dt);
    this.renderFn();

    this.rafId = requestAnimationFrame(this.loop);
  };
}
