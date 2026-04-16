import { BikeState, ArenaConfig, Point } from './types.js';

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

export function checkWallCollision(bike: BikeState, arena: ArenaConfig): boolean {
  if (!bike.alive) return false;
  return bike.x <= 0 || bike.x >= arena.width || bike.y <= 0 || bike.y >= arena.height;
}

export function checkTrailCollision(
  bike: BikeState,
  trails: { trail: Point[]; id: string; alive: boolean; x: number; y: number; jumping?: boolean }[],
  collisionRadius: number = 3,
): string | null {
  // Jumping bikes ignore trail collisions
  if (bike.jumping) return null;

  const head: Point = { x: bike.x, y: bike.y };

  for (const other of trails) {
    const trail = other.trail;
    // For own trail, skip the last few segments to avoid self-collision at start
    const isSelf = other.id === bike.id;
    const endIdx = isSelf ? trail.length - 3 : trail.length - 1;

    for (let i = 0; i < endIdx; i++) {
      const a = trail[i];
      const b = trail[i + 1];
      if (!a || !b) continue;

      const dist = distanceToSegment(head, a, b);
      if (dist < collisionRadius) {
        return other.id;
      }
    }

    // Also check collision with the live segment (from last trail point to current head)
    // but only for other bikes
    if (!isSelf && other.alive) {
      const lastPoint = trail[trail.length - 1];
      if (lastPoint) {
        const liveEnd: Point = { x: other.x, y: other.y };
        const dist = distanceToSegment(head, lastPoint, liveEnd);
        if (dist < collisionRadius) {
          return other.id;
        }
      }
    }
  }

  return null;
}

export function checkAllCollisions(
  bikes: BikeState[],
  arena: ArenaConfig,
): { bikeId: string; reason: string }[] {
  const deaths: { bikeId: string; reason: string }[] = [];

  for (const bike of bikes) {
    if (!bike.alive) continue;

    if (checkWallCollision(bike, arena)) {
      deaths.push({ bikeId: bike.id, reason: 'Hit the wall' });
      continue;
    }

    const hitId = checkTrailCollision(bike, bikes);
    if (hitId !== null) {
      if (hitId === bike.id) {
        deaths.push({ bikeId: bike.id, reason: 'Hit own trail' });
      } else {
        const otherBike = bikes.find((b) => b.id === hitId);
        deaths.push({
          bikeId: bike.id,
          reason: `Hit ${otherBike?.name || 'another rider'}'s trail`,
        });
      }
    }
  }

  return deaths;
}
