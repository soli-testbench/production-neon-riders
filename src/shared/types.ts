export interface Point {
  x: number;
  y: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export const VALID_DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

export function isValidDirection(dir: unknown): dir is Direction {
  return typeof dir === 'string' && VALID_DIRECTIONS.includes(dir as Direction);
}

export interface BikeState {
  id: string;
  x: number;
  y: number;
  direction: Direction;
  speed: number;
  trail: Point[];
  alive: boolean;
  color: string;
  name: string;
}

export interface ArenaConfig {
  width: number;
  height: number;
  gridSize: number;
}

export const DEFAULT_ARENA: ArenaConfig = {
  width: 2400,
  height: 1800,
  gridSize: 20,
};

export const NEON_COLORS = [
  '#00ffff', // cyan
  '#ff00ff', // magenta
  '#00ff00', // green
  '#ff6600', // orange
  '#ffff00', // yellow
  '#ff0066', // pink
  '#6600ff', // purple
  '#00ff99', // mint
];

export const BIKE_SPEED = 180;

/** Maximum trail length in distance units before oldest segments are trimmed */
export const MAX_TRAIL_LENGTH = 3000;

export function isValidNeonColor(color: string): boolean {
  return NEON_COLORS.includes(color);
}

export function sanitizeColor(color: string): string {
  return isValidNeonColor(color) ? color : NEON_COLORS[0];
}

export function sanitizeName(name: string): string {
  return name.slice(0, 16).replace(/[<>&"'/]/g, '');
}
