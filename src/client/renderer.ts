import { GameCanvas } from './canvas.js';
import { BikeState, ArenaConfig, Point, sanitizeColor } from '../shared/types.js';

export class Renderer {
  private gameCanvas: GameCanvas;
  private offsetX = 0;
  private offsetY = 0;

  constructor(gameCanvas: GameCanvas) {
    this.gameCanvas = gameCanvas;
  }

  private get ctx(): CanvasRenderingContext2D {
    return this.gameCanvas.ctx;
  }

  updateOffset(arena: ArenaConfig): void {
    this.offsetX = (this.gameCanvas.getWidth() - arena.width) / 2;
    this.offsetY = (this.gameCanvas.getHeight() - arena.height) / 2;
  }

  clear(): void {
    this.gameCanvas.clear();
  }

  drawGrid(arena: ArenaConfig): void {
    const ctx = this.ctx;
    this.updateOffset(arena);

    // Draw arena background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(this.offsetX, this.offsetY, arena.width, arena.height);

    // Draw grid lines with neon glow
    ctx.save();
    ctx.strokeStyle = '#1a1a3e';
    ctx.lineWidth = 0.5;
    ctx.shadowColor = '#1a1a3e';
    ctx.shadowBlur = 2;

    const gridSize = arena.gridSize;

    // Vertical lines
    for (let x = 0; x <= arena.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(this.offsetX + x, this.offsetY);
      ctx.lineTo(this.offsetX + x, this.offsetY + arena.height);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = 0; y <= arena.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(this.offsetX, this.offsetY + y);
      ctx.lineTo(this.offsetX + arena.width, this.offsetY + y);
      ctx.stroke();
    }

    ctx.restore();

    // Draw arena border with glow
    ctx.save();
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 15;
    ctx.strokeRect(this.offsetX, this.offsetY, arena.width, arena.height);
    ctx.restore();
  }

  drawBike(bike: BikeState): void {
    if (!bike.alive && bike.trail.length === 0) return;

    const ctx = this.ctx;
    const ox = this.offsetX;
    const oy = this.offsetY;
    const color = sanitizeColor(bike.color);

    // Draw trail
    if (bike.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(ox + bike.trail[0].x, oy + bike.trail[0].y);
      for (let i = 1; i < bike.trail.length; i++) {
        ctx.lineTo(ox + bike.trail[i].x, oy + bike.trail[i].y);
      }
      // Draw to current position if alive
      if (bike.alive) {
        ctx.lineTo(ox + bike.x, oy + bike.y);
      }
      ctx.stroke();

      // Draw a dimmer second layer for more glow
      ctx.shadowBlur = 25;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.stroke();

      ctx.restore();
    }

    // Draw bike head
    if (bike.alive) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;

      const size = 6;
      ctx.beginPath();
      ctx.arc(ox + bike.x, oy + bike.y, size, 0, Math.PI * 2);
      ctx.fill();

      // Inner glow
      ctx.fillStyle = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(ox + bike.x, oy + bike.y, size - 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  drawBikes(bikes: BikeState[]): void {
    for (const bike of bikes) {
      this.drawBike(bike);
    }
  }

  drawBackgroundGrid(): void {
    const ctx = this.ctx;
    const w = this.gameCanvas.getWidth();
    const h = this.gameCanvas.getHeight();

    ctx.save();
    ctx.strokeStyle = '#0d0d2b';
    ctx.lineWidth = 0.5;

    const gridSize = 40;

    for (let x = 0; x <= w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    for (let y = 0; y <= h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  screenToArena(screenX: number, screenY: number): Point {
    return {
      x: screenX - this.offsetX,
      y: screenY - this.offsetY,
    };
  }
}
