import { BikeState, Direction, BIKE_SPEED } from '../shared/types.js';

interface BikeSnapshot {
  x: number;
  y: number;
  direction: Direction;
  alive: boolean;
  timestamp: number;
}

interface BikeInterpolationState {
  prev: BikeSnapshot;
  current: BikeSnapshot;
}

const DIRECTION_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export class BikeInterpolator {
  private states: Map<string, BikeInterpolationState> = new Map();

  pushServerState(bikes: BikeState[], serverTimestamp: number): void {
    const now = serverTimestamp || performance.now();

    for (const bike of bikes) {
      const existing = this.states.get(bike.id);
      const snapshot: BikeSnapshot = {
        x: bike.x,
        y: bike.y,
        direction: bike.direction,
        alive: bike.alive,
        timestamp: now,
      };

      if (existing) {
        existing.prev = existing.current;
        existing.current = snapshot;
      } else {
        this.states.set(bike.id, {
          prev: snapshot,
          current: snapshot,
        });
      }
    }

    // Remove states for bikes no longer present
    for (const id of this.states.keys()) {
      if (!bikes.find((b) => b.id === id)) {
        this.states.delete(id);
      }
    }
  }

  getInterpolatedBikes(bikes: BikeState[]): BikeState[] {
    const now = performance.now();

    return bikes.map((bike) => {
      const state = this.states.get(bike.id);

      // No interpolation data or bike is dead - use server state directly
      if (!state || !bike.alive) {
        return bike;
      }

      const { prev, current } = state;
      const tickDuration = current.timestamp - prev.timestamp;

      // If we don't have two distinct snapshots yet, extrapolate from current
      if (tickDuration <= 0) {
        return this.extrapolate(bike, current, now);
      }

      const elapsed = now - current.timestamp;
      const t = elapsed / tickDuration;

      if (t <= 1.0) {
        // Interpolate between prev and current
        const x = prev.x + (current.x - prev.x) * t;
        const y = prev.y + (current.y - prev.y) * t;
        return {
          ...bike,
          x,
          y,
          direction: current.direction,
        };
      } else {
        // Extrapolate beyond current state using direction + speed
        return this.extrapolate(bike, current, now);
      }
    });
  }

  private extrapolate(bike: BikeState, snapshot: BikeSnapshot, now: number): BikeState {
    const elapsed = (now - snapshot.timestamp) / 1000; // convert to seconds
    // Cap extrapolation to avoid bikes flying off-screen
    const cappedElapsed = Math.min(elapsed, 0.1);
    const vec = DIRECTION_VECTORS[snapshot.direction];
    const distance = BIKE_SPEED * (bike.speedMultiplier ?? 1) * cappedElapsed;

    return {
      ...bike,
      x: snapshot.x + vec.dx * distance,
      y: snapshot.y + vec.dy * distance,
      direction: snapshot.direction,
    };
  }

  clear(): void {
    this.states.clear();
  }
}
