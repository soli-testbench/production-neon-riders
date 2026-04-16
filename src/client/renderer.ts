import { GameCanvas } from './canvas.js';
import { BikeState, ArenaConfig, Point, PowerUpState, RampState, sanitizeColor } from '../shared/types.js';
import { getTrailLength } from '../shared/bike.js';
import type { Particle } from './main.js';

export class Renderer {
  private gameCanvas: GameCanvas;
  private cameraX = 0;
  private cameraY = 0;
  private localPlayerId: string | null = null;
  private followTargetId: string | null = null;
  private playerDead = false;
  private deathZoom = 1;
  private readonly BASE_ZOOM = 2.5;
  private readonly DEATH_ZOOM_TARGET = 0.5;
  private readonly DEATH_ZOOM_SPEED = 0.02;
  private powerUpPulse = 0;
  private trailDissolvePhase = 0;
  private rampPulse = 0;

  constructor(gameCanvas: GameCanvas) {
    this.gameCanvas = gameCanvas;
  }

  private get ctx(): CanvasRenderingContext2D {
    return this.gameCanvas.ctx;
  }

  setLocalPlayerId(id: string): void {
    this.localPlayerId = id;
    this.followTargetId = id;
  }

  setFollowTarget(id: string): void {
    this.followTargetId = id;
  }

  getFollowTargetId(): string | null {
    return this.followTargetId;
  }

  setPlayerDead(dead: boolean): void {
    if (dead && !this.playerDead) {
      this.playerDead = true;
      this.deathZoom = this.BASE_ZOOM;
    } else if (!dead) {
      this.playerDead = false;
      this.deathZoom = this.BASE_ZOOM;
    }
  }

  private updateCamera(bikes: BikeState[]): void {
    const targetId = this.followTargetId || this.localPlayerId;
    if (!targetId) return;

    const targetBike = bikes.find((b) => b.id === targetId);
    if (!targetBike) return;

    // When spectating (following a different player) or alive, track the target
    const isSpectating = this.playerDead && this.followTargetId && this.followTargetId !== this.localPlayerId;

    if (!this.playerDead || isSpectating) {
      const viewW = this.gameCanvas.getWidth();
      const viewH = this.gameCanvas.getHeight();
      const leadOffset = 0.25;

      let offsetX = 0;
      let offsetY = 0;

      switch (targetBike.direction) {
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

      const targetX = targetBike.x + offsetX - viewW / 2;
      const targetY = targetBike.y + offsetY - viewH / 2;

      const smoothing = 0.15;
      this.cameraX += (targetX - this.cameraX) * smoothing;
      this.cameraY += (targetY - this.cameraY) * smoothing;
    }

    if (this.playerDead && !isSpectating && this.deathZoom > this.DEATH_ZOOM_TARGET) {
      this.deathZoom = Math.max(this.DEATH_ZOOM_TARGET, this.deathZoom - this.DEATH_ZOOM_SPEED);
    }
  }

  clear(): void {
    this.gameCanvas.clear();
  }

  private getEffectiveZoom(): number {
    if (this.playerDead) {
      const isSpectating = this.followTargetId && this.followTargetId !== this.localPlayerId;
      return isSpectating ? this.BASE_ZOOM : this.deathZoom;
    }
    return this.BASE_ZOOM;
  }

  private getVisibleBounds(): { visLeft: number; visTop: number; visRight: number; visBottom: number } {
    const viewW = this.gameCanvas.getWidth();
    const viewH = this.gameCanvas.getHeight();
    const effectiveZoom = this.getEffectiveZoom();
    const visLeft = this.cameraX - viewW * (1 / effectiveZoom - 1) / 2;
    const visTop = this.cameraY - viewH * (1 / effectiveZoom - 1) / 2;
    const visRight = visLeft + viewW / effectiveZoom;
    const visBottom = visTop + viewH / effectiveZoom;
    return { visLeft, visTop, visRight, visBottom };
  }

  private applyCamera(ctx: CanvasRenderingContext2D): void {
    const viewW = this.gameCanvas.getWidth();
    const viewH = this.gameCanvas.getHeight();
    const effectiveZoom = this.getEffectiveZoom();

    if (effectiveZoom !== 1) {
      const centerX = viewW / 2;
      const centerY = viewH / 2;
      ctx.translate(centerX, centerY);
      ctx.scale(effectiveZoom, effectiveZoom);
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

    // Draw trail with fade effect — always show visible fade gradient at tail end
    if (bike.trail.length > 1) {
      const totalTrailLen = getTrailLength(bike.trail);
      const fadeFraction = 0.4;
      const fadeLength = totalTrailLen * fadeFraction;

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

        // Always apply fade gradient at the tail end (oldest segments)
        let alpha = 1.0;
        if (accumulatedDist < fadeLength && fadeLength > 0) {
          alpha = accumulatedDist / fadeLength;
          alpha = Math.max(0.05, alpha); // minimum visibility
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

        // Draw dissolve sparkle particles at the very tail of the trail
        if (i === 0 && accumulatedDist < 10) {
          this.drawTrailDissolveEffect(ctx, camOffX + a.x, camOffY + a.y, color);
        }

        accumulatedDist += segLen;
      }

      // Draw live segment (last trail point to current position) if alive and not jumping
      if (bike.alive && !bike.jumping) {
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
        const isJumping = bike.jumping;
        const size = isJumping ? 9 : 6; // Larger when jumping

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

        // Draw shadow underneath when jumping
        if (isJumping) {
          ctx.save();
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.beginPath();
          ctx.ellipse(cx + 3, cy + 3, 8, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Outer white glow arrow
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = color;
        ctx.shadowBlur = isJumping ? 30 : 20;

        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(-size * 0.7, -size * 0.7);
        ctx.lineTo(-size * 0.3, 0);
        ctx.lineTo(-size * 0.7, size * 0.7);
        ctx.closePath();
        ctx.fill();

        // Inner colored arrow
        ctx.fillStyle = color;
        ctx.shadowBlur = isJumping ? 15 : 10;
        const inner = 0.7;
        ctx.beginPath();
        ctx.moveTo(size * inner, 0);
        ctx.lineTo(-size * 0.7 * inner, -size * 0.7 * inner);
        ctx.lineTo(-size * 0.3 * inner, 0);
        ctx.lineTo(-size * 0.7 * inner, size * 0.7 * inner);
        ctx.closePath();
        ctx.fill();

        ctx.restore();

        // Draw player name label above the arrow head
        const isLocal = bike.id === this.localPlayerId;
        const labelOffsetY = -18;
        const effectiveZoom = this.getEffectiveZoom();
        const fontSize = Math.max(8, Math.min(14, 11 / effectiveZoom * 2.5));

        ctx.save();
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = isLocal ? 4 : 8;
        ctx.globalAlpha = isLocal ? 0.5 : 0.9;
        ctx.fillText(bike.name, cx, cy + labelOffsetY);
        ctx.restore();
      }
    }
  }

  drawBikes(bikes: BikeState[]): void {
    const ctx = this.ctx;

    // Increment dissolve phase once per frame, not per bike
    this.trailDissolvePhase += 0.03;

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

  private drawTrailDissolveEffect(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    const sparkleCount = 5;
    for (let i = 0; i < sparkleCount; i++) {
      const angle = (Math.PI * 2 * i) / sparkleCount + this.trailDissolvePhase;
      const radius = 4 + Math.sin(this.trailDissolvePhase * 2 + i) * 3;
      const sx = x + Math.cos(angle) * radius;
      const sy = y + Math.sin(angle) * radius;
      const sparkleAlpha = 0.4 + 0.3 * Math.sin(this.trailDissolvePhase * 3 + i * 1.5);

      ctx.save();
      ctx.globalAlpha = sparkleAlpha;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Central dissolve glow
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(this.trailDissolvePhase * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawRamps(ramps: RampState[], _arena: ArenaConfig): void {
    if (ramps.length === 0) return;

    const ctx = this.ctx;
    this.rampPulse += 0.04;

    ctx.save();
    this.applyCamera(ctx);

    const camOffX = -this.cameraX;
    const camOffY = -this.cameraY;
    const { visLeft, visTop, visRight, visBottom } = this.getVisibleBounds();

    for (const ramp of ramps) {
      // Culling
      if (
        ramp.x < visLeft - ramp.width ||
        ramp.x > visRight + ramp.width ||
        ramp.y < visTop - ramp.height ||
        ramp.y > visBottom + ramp.height
      ) continue;

      const rx = camOffX + ramp.x;
      const ry = camOffY + ramp.y;
      const halfW = ramp.width / 2;
      const halfH = ramp.height / 2;
      const pulse = 0.6 + 0.4 * Math.sin(this.rampPulse);

      // Determine rotation angle based on ramp direction
      let angle = 0;
      switch (ramp.direction) {
        case 'right': angle = 0; break;
        case 'down': angle = Math.PI / 2; break;
        case 'left': angle = Math.PI; break;
        case 'up': angle = -Math.PI / 2; break;
      }

      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(angle);

      // Outer glow
      ctx.fillStyle = `rgba(0, 255, 200, ${0.15 * pulse})`;
      ctx.shadowColor = '#00ffc8';
      ctx.shadowBlur = 20 * pulse;
      ctx.fillRect(-halfW - 4, -halfH - 4, ramp.width + 8, ramp.height + 8);

      // Ramp base
      ctx.fillStyle = `rgba(0, 255, 200, ${0.25 * pulse})`;
      ctx.shadowBlur = 10;
      ctx.fillRect(-halfW, -halfH, ramp.width, ramp.height);

      // Border
      ctx.strokeStyle = `rgba(0, 255, 200, ${0.7 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 8;
      ctx.strokeRect(-halfW, -halfH, ramp.width, ramp.height);

      // Chevron arrows pointing in the ramp direction
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 * pulse})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00ffc8';
      ctx.shadowBlur = 6;
      for (let c = 0; c < 3; c++) {
        const offset = -halfW * 0.5 + c * halfW * 0.5;
        ctx.beginPath();
        ctx.moveTo(offset - 5, -halfH * 0.5);
        ctx.lineTo(offset + 5, 0);
        ctx.lineTo(offset - 5, halfH * 0.5);
        ctx.stroke();
      }

      ctx.restore();
    }

    ctx.restore();
  }

  drawVignette(): void {
    const ctx = this.ctx;
    const w = this.gameCanvas.getWidth();
    const h = this.gameCanvas.getHeight();

    // Radial gradient vignette from transparent center to dark edges
    const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.85, 'rgba(0, 0, 10, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 0, 10, 0.7)');

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  screenToArena(screenX: number, screenY: number): Point {
    return {
      x: screenX + this.cameraX,
      y: screenY + this.cameraY,
    };
  }
}
