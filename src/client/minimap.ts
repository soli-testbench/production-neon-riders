import { BikeState, ArenaConfig, PowerUpState, sanitizeColor } from '../shared/types.js';

const MINIMAP_WIDTH = 150;
const MINIMAP_HEIGHT = 120;
const MINIMAP_PADDING = 12;
const MINIMAP_BG_ALPHA = 0.7;
const DOT_RADIUS = 3;
const LOCAL_DOT_RADIUS = 4;

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pulsePhase = 0;
  private lastBikes: BikeState[] = [];
  private lastArena: ArenaConfig | null = null;
  private onBikeClick: ((bikeId: string) => void) | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap-canvas';
    this.canvas.width = MINIMAP_WIDTH;
    this.canvas.height = MINIMAP_HEIGHT;
    this.canvas.style.position = 'fixed';
    this.canvas.style.bottom = `${MINIMAP_PADDING}px`;
    this.canvas.style.left = `${MINIMAP_PADDING}px`;
    this.canvas.style.zIndex = '10';
    this.canvas.style.pointerEvents = 'auto';
    this.canvas.style.display = 'none';
    this.canvas.style.cursor = 'pointer';
    document.body.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get minimap 2D context');
    this.ctx = ctx;

    this.canvas.addEventListener('click', (e: MouseEvent) => {
      if (!this.onBikeClick || !this.lastArena) return;
      const rect = this.canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const scaleX = MINIMAP_WIDTH / this.lastArena.width;
      const scaleY = MINIMAP_HEIGHT / this.lastArena.height;

      let closestId: string | null = null;
      let closestDist = Infinity;
      for (const bike of this.lastBikes) {
        if (!bike.alive) continue;
        const mx = bike.x * scaleX;
        const my = bike.y * scaleY;
        const dist = Math.sqrt((clickX - mx) ** 2 + (clickY - my) ** 2);
        if (dist < 15 && dist < closestDist) {
          closestDist = dist;
          closestId = bike.id;
        }
      }
      if (closestId) {
        this.onBikeClick(closestId);
      }
    });
  }

  setOnBikeClick(cb: (bikeId: string) => void): void {
    this.onBikeClick = cb;
  }

  show(): void {
    this.canvas.style.display = 'block';
  }

  hide(): void {
    this.canvas.style.display = 'none';
  }

  render(arena: ArenaConfig, bikes: BikeState[], localPlayerId: string | null, powerUps?: PowerUpState[]): void {
    this.lastBikes = bikes;
    this.lastArena = arena;

    const ctx = this.ctx;
    const w = MINIMAP_WIDTH;
    const h = MINIMAP_HEIGHT;

    this.pulsePhase += 0.05;

    // Scale factors from arena to minimap
    const scaleX = w / arena.width;
    const scaleY = h / arena.height;

    // Clear and draw background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = `rgba(10, 10, 20, ${MINIMAP_BG_ALPHA})`;
    ctx.fillRect(0, 0, w, h);

    // Draw arena border
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 4;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.shadowBlur = 0;

    // Draw trails
    for (const bike of bikes) {
      if (bike.trail.length < 2) continue;

      const color = sanitizeColor(bike.color);
      const alpha = bike.alive ? 0.6 : 0.2;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(bike.trail[0].x * scaleX, bike.trail[0].y * scaleY);
      for (let i = 1; i < bike.trail.length; i++) {
        ctx.lineTo(bike.trail[i].x * scaleX, bike.trail[i].y * scaleY);
      }
      // Draw live segment to current position if alive
      if (bike.alive) {
        ctx.lineTo(bike.x * scaleX, bike.y * scaleY);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Draw power-up indicators
    if (powerUps) {
      for (const pu of powerUps) {
        if (!pu.active) continue;
        const pux = pu.x * scaleX;
        const puy = pu.y * scaleY;

        ctx.save();
        ctx.fillStyle = '#ffff00';
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 3;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(pux, puy, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Draw bike dots
    for (const bike of bikes) {
      const color = sanitizeColor(bike.color);
      const mx = bike.x * scaleX;
      const my = bike.y * scaleY;
      const isLocal = bike.id === localPlayerId;

      ctx.save();

      if (!bike.alive) {
        ctx.globalAlpha = 0.3;
      }

      if (isLocal && bike.alive) {
        // Pulsing glow for local player
        const pulse = 0.6 + 0.4 * Math.sin(this.pulsePhase);
        const radius = LOCAL_DOT_RADIUS + pulse;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6 * pulse;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(mx, my, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(mx, my, radius * 0.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 3;
        ctx.beginPath();
        ctx.arc(mx, my, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }
}
