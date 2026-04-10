import { BikeState, Direction, Point, BIKE_SPEED } from './types.js';

export function createBike(
  id: string,
  x: number,
  y: number,
  direction: Direction,
  color: string,
  name: string,
): BikeState {
  return {
    id,
    x,
    y,
    direction,
    speed: BIKE_SPEED,
    trail: [{ x, y }],
    alive: true,
    color,
    name,
  };
}

export function turnBike(bike: BikeState, newDirection: Direction): void {
  // Prevent 180-degree turns
  const opposites: Record<Direction, Direction> = {
    up: 'down',
    down: 'up',
    left: 'right',
    right: 'left',
  };
  if (opposites[bike.direction] === newDirection) return;
  bike.direction = newDirection;
}

export function moveBike(bike: BikeState, dt: number): void {
  if (!bike.alive) return;

  const distance = bike.speed * dt;
  const prevX = bike.x;
  const prevY = bike.y;

  switch (bike.direction) {
    case 'up':
      bike.y -= distance;
      break;
    case 'down':
      bike.y += distance;
      break;
    case 'left':
      bike.x -= distance;
      break;
    case 'right':
      bike.x += distance;
      break;
  }

  // Add trail point if direction matters for rendering
  const lastTrail = bike.trail[bike.trail.length - 1];
  if (lastTrail) {
    const dx = Math.abs(bike.x - lastTrail.x);
    const dy = Math.abs(bike.y - lastTrail.y);
    // Add intermediate points for smooth trail rendering at turns
    if (dx > 0 && dy > 0) {
      bike.trail.push({ x: prevX, y: prevY });
    }
  }
}

export function getBikeHead(bike: BikeState): Point {
  return { x: bike.x, y: bike.y };
}

export function killBike(bike: BikeState): void {
  bike.alive = false;
  // Freeze trail at death position
  bike.trail.push({ x: bike.x, y: bike.y });
}
