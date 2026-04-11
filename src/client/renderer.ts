import { GameCanvas } from './canvas.js';
import { BikeState, ArenaConfig, Point, PowerUpState, sanitizeColor, MAX_TRAIL_LENGTH } from '../shared/types.js';
import { getTrailLength } from '../shared/bike.js';
import type { Particle } from './main.js';

export class Renderer {
  private gameCanvas: GameCanvas;
  private cameraX = 0;
  private cameraY = 0;
  private localPlayerId: string | null = null;
  private playerDead = false;
  private deathZoom = 1;
  private readonly DEATH_ZOOM_TARGET = 0.5;
  private readonly DEATH_ZOOM_SPEED = 0.02;
  private powerUpPulse = 0;

  constructor(gameCanvas: GameCanvas) {
    this.gameCanvas = gameCanvas;
  }

  private get ctx(): CanvasRenderingContext2D {
    return this.gameCanvas.ctx;
  }

  setLocalPlayerId(id: string): void {
    this.localPlayerId = id;
  }

  setPlayerDead(dead: boolean): void {
    if (dead && !this.playerDead) {
      this.playerDead = true;
    } else if (!dead) {
      this.playerDead = false;
      this.deathZoom = 1;
    }
  }

  private updateCamera(bikes: BikeState[]): void {
    if (!this.localPlayerId) return;

    const localBike = bikes.find((b) => b.id === this.localPlayerId);
    if (!localBike) return;

    if (!this.playerDead) {
      const viewW = this.gameCanvas.getWidth();
      const viewH = this.gameCanvas.getHeight();
      const leadOffset = 0.1;

      let offsetX = 0;
      let offsetY = 0;

      switch (localBike.direction) {
        case 'up':
          offsetY = -viewH * leadOffset;
          break;
        case 'down':
          offsetY = viewH * leadOffset;
          break;
        case 'left':
          offsetX = -viewW * leadOffset;
          break;
        case 'right':
          offsetX = viewW * leadOffset;
          break;
      }

      const targetX = localBike.x + offsetX - viewW / 2;
      const targetY = localBike.y + offsetY - viewH / 2;

      const smoothing = 0.15;
      this.cameraX += (targetX - this.cameraX) * smoothing;
      this.cameraY += (targetY - this.cameraY) * smoothing;
    }

    if (this.playerDead && this.deathZoom > this.DEATH_ZOOM_TARGET) {
      this.deathZoom = Math.max(this.DEATH_ZOOM_TARGET, this.deathZoom - this.DEATH_ZOOM_SPEED);
    }
  }

  clear(): void {
    this.gameCanvas.clear();
  }

  private getVisibleBounds(): { visLeft: number; visTop: number; visRight: number; visBottom: number } {
    const viewW = this.gameCanvas.getWidth();
    const viewH = this.gameCanvas.getHeight();
    const effectiveZoom = this.playerDead ? this.deathZoom : 1;
    const visLeft = this.cameraX - viewW * (1 / effectiveZoom - 1) / 2;
    const visTop = this.cameraY - viewH * (1 / effectiveZoom - 1) / 2;
    const visRight = visLeft + viewW / effectiveZoom;
    const visBottom = visTop + viewH / effectiveZoom;
    return { visLeft, visTop, visRight, visBottom };
  }

  private applyCamera(ctx: CanvasRenderingContext2D): void {
    const viewW = this.gameCanvas.getWidth();
    const viewH = this.gameCanvas.getHeight();

    if (this.playerDead && this.deathZoom < 1) {
      const centerX = viewW / 2;
      const centerY = viewH / 2;
      ctx.translate(centerX, centerY);
      ctx.scale(this.deathZoom, this.deathZoom);
      ctx.translate(-centerX, -centerY);
    }
  }

  drawGrid(arena: ArenaConfig, bikes: BikeState[]): void {
    const ctx = this.ctx;
    this.updateCamera(bikes);

    ctx.save();
    this.applyCamera(ctx);

    const camOffX = -this.cameraX;
    const camOffY = -this.cameraY;
    const { visLeft, visTop, visRight, visBottom } = this.getVisibleBounds();

    // Draw arena background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(camOffX, camOffY, arena.width, arena.height);

    // Draw grid lines with neon glow (only visible ones)
    ctx.save();
    ctx.strokeStyle = '#1a1a3e';
    ctx.lineWidth = 0.5;
    ctx.shadowColor = '#1a1a3e';
    ctx.shadowBlur = 2;

    const gridSize = arena.gridSize;

    const startX = Math.max(0, Math.floor(visLeft / gridSize) * gridSize);
    const endX = Math.min(arena.width, Math.ceil(visRight / gridSize) * gridSize);
    for (let x = startX; x <= endX; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(camOffX + x, camOffY + Math.max(0, visTop));
      ctx.lineTo(camOffX + x, camOffY + Math.min(arena.height, visBottom));
      ctx.stroke();
    }

    const startY = Math.max(0, Math.floor(visTop / gridSize) * gridSize);
    const endY = Math.min(arena.height, Math.ceil(visBottom / gridSize) * gridSize);
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(camOffX + Math.max(0, visLeft), camOffY + y);
      ctx.lineTo(camOffX + Math.min(arena.width, visRight), camOffY + y);
      ctx.stroke();
    }

    ctx.restore();

    // Draw arena border with glow
    ctx.save();
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 15;
    ctx.strokeRect(camOffX, camOffY, arena.width, arena.height);
    ctx.restore();

    ctx.restore();
  }

  private isSegmentVisible(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    visLeft: number,
    visTop: number,
    visRight: number,
    visBottom: number,
  ): boolean {
    const margin = 20;
    const minX = Math.min(ax, bx) - margin;
    const maxX = Math.max(ax, bx) + margin;
    const minY = Math.min(ay, by) - margin;
    const maxY = Math.max(ay, by) + margin;
    return maxX >= visLeft && minX <= visRight && maxY >= visTop && minY <= visBottom;
  }

  private drawSingleBike(
    bike: BikeState,
    camOffX: number,
    camOffY: number,
    visLeft: number,
    visTop: number,
    visRight: number,
    visBottom: number,
  ): void {
    if (!bike.alive && bike.trail.length === 0) return;

    const ctx = this.ctx;
    const color = sanitizeColor(bike.color);

    // Draw trail with fade effect for segments near removal threshold
    if (bike.trail.length > 1) {
      const totalTrailLen = getTrailLength(bike.trail);
      const fadeFraction = 0.4;
      const fadeLength = MAX_TRAIL_LENGTH * fadeFraction;

      let accumulatedDist = 0;

      for (let i = 0; i < bike.trail.length - 1; i++) {
        const a = bike.trail[i];
        const b = bike.trail[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen = Math.sqrt(dx * dx + dy * dy);

        // Culling: skip segments outside viewport
        if (!this.isSegmentVisible(a.x, a.y, b.x, b.y, visLeft, visTop, visRight, visBottom)) {
          accumulatedDist += segLen;
          continue;
        }

        // Calculate fade alpha based on position in trail
        // Oldest segments fade smoothly to 0.0 before being trimmed
        let alpha = 1.0;
        if (totalTrailLen > MAX_TRAIL_LENGTH * 0.5) {
          if (accumulatedDist < fadeLength) {
            alpha = accumulatedDist / fadeLength;
          }
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(camOffX + a.x, camOffY + a.y);
        ctx.lineTo(camOffX + b.x, camOffY + b.y);
        ctx.stroke();

        // Glow layer
        ctx.shadowBlur = 25;
        ctx.lineWidth = 1;
        ctx.globalAlpha = alpha * 0.5;
        ctx.stroke();

        ctx.restore();

        accumulatedDist += segLen;
      }

      // Draw live segment (last trail point to current position) if alive
      if (bike.alive) {
        const lastPt = bike.trail[bike.trail.length - 1];
        if (this.isSegmentVisible(lastPt.x, lastPt.y, bike.x, bike.y, visLeft, visTop, visRight, visBottom)) {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          ctx.beginPath();
          ctx.moveTo(camOffX + lastPt.x, camOffY + lastPt.y);
          ctx.lineTo(camOffX + bike.x, camOffY + bike.y);
          ctx.stroke();

          ctx.shadowBlur = 25;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.5;
          ctx.stroke();

          ctx.restore();
        }
      }
    }

    // Draw bike head as directional arrow
    if (bike.alive) {
      if (
        bike.x >= visLeft - 20 &&
        bike.x <= visRight + 20 &&
        bike.y >= visTop - 20 &&
        bike.y <= visBottom + 20
      ) {
        const cx = camOffX + bike.x;
        const cy = camOffY + bike.y;
        const size = 6;

        // Rotation angle based on direction
        let angle = 0;
        switch (bike.direction) {
          case 'right':
            angle = 0;
            break;
          case 'down':
            angle = Math.PI / 2;
            break;
          case 'left':
            angle = Math.PI;
            break;
          case 'up':
            angle = -Math.PI / 2;
            break;
        }

        // Outer white glow arrow
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = color;
        ctx.shadowBlur = 20;

        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(-size * 0.7, -size * 0.7);
        ctx.lineTo(-size * 0.3, 0);
        ctx.lineTo(-size * 0.7, size * 0.7);
        ctx.closePath();
        ctx.fill();

        // Inner colored arrow
        ctx.fillStyle = color;
        ctx.shadowBlur = 10;
        const inner = 0.7;
        ctx.beginPath();
        ctx.moveTo(size * inner, 0);
        ctx.lineTo(-size * 0.7 * inner, -size * 0.7 * inner);
        ctx.lineTo(-size * 0.3 * inner, 0);
        ctx.lineTo(-size * 0.7 * inner, size * 0.7 * inner);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }
    }
  }

  drawBikes(bikes: BikeState[]): void {
    const ctx = this.ctx;

    ctx.save();
    this.applyCamera(ctx);

    const camOffX = -this.cameraX;
    const camOffY = -this.cameraY;
    const { visLeft, visTop, visRight, visBottom } = this.getVisibleBounds();

    for (const bike of bikes) {
      this.drawSingleBike(bike, camOffX, camOffY, visLeft, visTop, visRight, visBottom);
    }

    ctx.restore();
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

  drawParticles(particles: Particle[]): void {
    if (particles.length === 0) return;

    const ctx = this.ctx;
    ctx.save();
    this.applyCamera(ctx);

    const camOffX = -this.cameraX;
    const camOffY = -this.cameraY;

    for (const p of particles) {
      const alpha = Math.max(0, p.life);
      if (alpha <= 0) continue;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 15 * alpha;

      ctx.beginPath();
      ctx.arc(camOffX + p.x, camOffY + p.y, p.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
      ctx.fill();

      // Extra glow layer
      ctx.globalAlpha = alpha * 0.4;
      ctx.shadowBlur = 25 * alpha;
      ctx.beginPath();
      ctx.arc(camOffX + p.x, camOffY + p.y, p.size * (0.8 + alpha * 0.5), 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    ctx.restore();
  }

  drawPowerUps(powerUps: PowerUpState[], _arena: ArenaConfig): void {
    const ctx = this.ctx;
    this.powerUpPulse += 0.06;

    ctx.save();
    this.applyCamera(ctx);

    const camOffX = -this.cameraX;
    const camOffY = -this.cameraY;
    const { visLeft, visTop, visRight, visBottom } = this.getVisibleBounds();

    for (const pu of powerUps) {
      if (!pu.active) continue;

      // Culling
      if (pu.x < visLeft - 30 || pu.x > visRight + 30 || pu.y < visTop - 30 || pu.y > visBottom + 30) continue;

      const px = camOffX + pu.x;
      const py = camOffY + pu.y;
      const pulse = 0.8 + 0.2 * Math.sin(this.powerUpPulse);
      const radius = 10 * pulse;

      // Outer glow
      ctx.save();
      ctx.fillStyle = '#ffff00';
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 25 * pulse;
      ctx.globalAlpha = 0.4 * pulse;
      ctx.beginPath();
      ctx.arc(px, py, radius * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Inner bright core
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 15;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(px, py, radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Middle ring
      ctx.save();
      ctx.strokeStyle = '#ffff00';
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Lightning bolt icon
      ctx.save();
      ctx.fillStyle = '#ffff00';
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 8;
      ctx.globalAlpha = 0.9;
      const s = radius * 0.4;
      ctx.beginPath();
      ctx.moveTo(px - s * 0.3, py - s);
      ctx.lineTo(px + s * 0.5, py - s * 0.1);
      ctx.lineTo(px, py + s * 0.1);
      ctx.lineTo(px + s * 0.3, py + s);
      ctx.lineTo(px - s * 0.5, py + s * 0.1);
      ctx.lineTo(px, py - s * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  drawBoostHUD(boostEndTime: number | null): void {
    if (!boostEndTime) return;

    const now = Date.now();
    const remaining = boostEndTime - now;
    if (remaining <= 0) return;

    const ctx = this.ctx;
    const w = this.gameCanvas.getWidth();

    const barWidth = 160;
    const barHeight = 8;
    const x = (w - barWidth) / 2;
    const y = 40;
    const progress = remaining / 3000;

    ctx.save();

    // Label
    ctx.fillStyle = '#ffff00';
    ctx.shadowColor = '#ffff00';
    ctx.shadowBlur = 8;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SPEED BOOST', w / 2, y - 4);

    // Bar background
    ctx.fillStyle = 'rgba(255, 255, 0, 0.15)';
    ctx.fillRect(x, y, barWidth, barHeight);

    // Bar fill
    ctx.fillStyle = '#ffff00';
    ctx.shadowColor = '#ffff00';
    ctx.shadowBlur = 10;
    ctx.fillRect(x, y, barWidth * progress, barHeight);

    // Bar border
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.strokeRect(x, y, barWidth, barHeight);

    ctx.restore();
  }

  screenToArena(screenX: number, screenY: number): Point {
    return {
      x: screenX + this.cameraX,
      y: screenY + this.cameraY,
    };
  }
}
