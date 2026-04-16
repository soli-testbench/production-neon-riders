import { BikeState, Direction, Point, BIKE_SPEED, MAX_TRAIL_LENGTH } from './types.js';

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
  if (bike.direction === newDirection) return;

  // Record the corner position as a trail waypoint BEFORE changing direction.
  // This ensures sharp 90-degree corners and pixel-perfect collision detection
  // at turns. The moveBike() dx/dy check remains as a fallback safety net.
  // Skip when jumping — jumping bikes intentionally do not lay trail.
  if (!bike.jumping) {
    const last = bike.trail[bike.trail.length - 1];
    if (!last || last.x !== bike.x || last.y !== bike.y) {
      bike.trail.push({ x: bike.x, y: bike.y });
    }
  }

  bike.direction = newDirection;
}

export function moveBike(bike: BikeState, dt: number): void {
  if (!bike.alive) return;

  const multiplier = bike.speedMultiplier ?? 1;
  const distance = bike.speed * multiplier * dt;
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

  // While jumping, do not add trail points
  if (bike.jumping) {
    // If this is the first frame of a jump, cap the trail at current position
    const lastTrail = bike.trail[bike.trail.length - 1];
    if (lastTrail) {
      const dx = Math.abs(prevX - lastTrail.x);
      const dy = Math.abs(prevY - lastTrail.y);
      if (dx > 1 || dy > 1) {
        // Only add the pre-jump position once to close the trail segment
        bike.trail.push({ x: prevX, y: prevY });
      }
    }
    trimTrail(bike);
    return;
  }

  // If we just landed from a jump, start a new trail segment at current position
  const lastTrail = bike.trail[bike.trail.length - 1];
  if (lastTrail) {
    const gapX = Math.abs(bike.x - lastTrail.x);
    const gapY = Math.abs(bike.y - lastTrail.y);
    // If there's a large gap (from jumping), insert current position to start new segment
    if (gapX > 20 || gapY > 20) {
      bike.trail.push({ x: prevX, y: prevY });
    }
  }

  // Add trail point if direction matters for rendering
  const lastTrail2 = bike.trail[bike.trail.length - 1];
  if (lastTrail2) {
    const dx = Math.abs(bike.x - lastTrail2.x);
    const dy = Math.abs(bike.y - lastTrail2.y);
    // Add intermediate points for smooth trail rendering at turns
    if (dx > 0 && dy > 0) {
      bike.trail.push({ x: prevX, y: prevY });
    }
  }

  // Trim trail if it exceeds MAX_TRAIL_LENGTH
  trimTrail(bike);
}

export function getTrailLength(trail: Point[]): number {
  let length = 0;
  for (let i = 1; i < trail.length; i++) {
    const dx = trail[i].x - trail[i - 1].x;
    const dy = trail[i].y - trail[i - 1].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

export function trimTrail(bike: BikeState): void {
  if (bike.trail.length < 2) return;

  // Calculate total trail length including live segment to current position
  let totalLength = 0;
  for (let i = 1; i < bike.trail.length; i++) {
    const dx = bike.trail[i].x - bike.trail[i - 1].x;
    const dy = bike.trail[i].y - bike.trail[i - 1].y;
    totalLength += Math.sqrt(dx * dx + dy * dy);
  }
  // Add live segment
  const lastPt = bike.trail[bike.trail.length - 1];
  const liveDx = bike.x - lastPt.x;
  const liveDy = bike.y - lastPt.y;
  totalLength += Math.sqrt(liveDx * liveDx + liveDy * liveDy);

  // Remove oldest points until under max length
  while (totalLength > MAX_TRAIL_LENGTH && bike.trail.length > 2) {
    const dx = bike.trail[1].x - bike.trail[0].x;
    const dy = bike.trail[1].y - bike.trail[0].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    bike.trail.shift();
    totalLength -= segLen;
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
