export class GameCanvas {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  private resizeHandler: () => void;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!this.canvas) {
      throw new Error(`Canvas element #${canvasId} not found`);
    }

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D context');
    }
    this.ctx = ctx;

    this.resizeHandler = this.resize.bind(this);
    window.addEventListener('resize', this.resizeHandler);
    this.resize();
  }

  resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  clear(): void {
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  getWidth(): number {
    return this.canvas.width;
  }

  getHeight(): number {
    return this.canvas.height;
  }

  destroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
  }
}
