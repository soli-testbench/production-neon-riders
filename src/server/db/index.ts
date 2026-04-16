import { Pool } from 'pg';
import { runMigrations } from './migrate.js';

let pool: Pool | null = null;

export interface MatchResultRecord {
  matchId: string;
  playerName: string;
  placement: number;
  survivalTime: number;
  isBot: boolean;
}

export interface LeaderboardEntry {
  name: string;
  wins: number;
  totalGames: number;
  totalSurvivalTime: number;
}

export async function initDatabase(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('DATABASE_URL not set, running without persistence');
    return false;
  }

  try {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: false },
    });

    // Test connection
    await pool.query('SELECT 1');
    console.log('Database connected successfully');

    // Run migrations
    await runMigrations(pool);

    return true;
  } catch (err) {
    console.error('Failed to connect to database:', err);
    pool = null;
    return false;
  }
}

export async function saveMatchResults(results: MatchResultRecord[]): Promise<void> {
  if (!pool) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const r of results) {
      // Insert match result
      await client.query(
        `INSERT INTO match_results (match_id, player_name, placement, survival_time, is_bot)
         VALUES ($1, $2, $3, $4, $5)`,
        [r.matchId, r.playerName, r.placement, r.survivalTime, r.isBot],
      );

      if (!r.isBot) {
        // Upsert player stats
        const isWin = r.placement === 1;
        await client.query(
          `INSERT INTO players (name, total_games, wins, total_survival_time)
           VALUES ($1, 1, $2, $3)
           ON CONFLICT (name) DO UPDATE SET
             total_games = players.total_games + 1,
             wins = players.wins + $2,
             total_survival_time = players.total_survival_time + $3`,
          [r.playerName, isWin ? 1 : 0, r.survivalTime],
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to save match results:', err);
  } finally {
    client.release();
  }
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!pool) return [];

  try {
    const result = await pool.query(
      `SELECT name, wins, total_games, total_survival_time
       FROM players
       ORDER BY wins DESC, total_games DESC
       LIMIT 10`,
    );

    return result.rows.map((row) => ({
      name: row.name,
      wins: Number(row.wins),
      totalGames: Number(row.total_games),
      totalSurvivalTime: Number(row.total_survival_time),
    }));
  } catch (err) {
    console.error('Failed to fetch leaderboard:', err);
    return [];
  }
}

export interface PlayerStats {
  games_played: number;
  wins: number;
  win_rate_percent: number;
  avg_survival_time: number;
}

export async function getPlayerStats(name: string): Promise<PlayerStats | null> {
  if (!pool) return null;

  try {
    const result = await pool.query(
      `SELECT total_games, wins, total_survival_time
       FROM players
       WHERE name = $1`,
      [name],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const totalGames = Number(row.total_games);
    const wins = Number(row.wins);
    const totalSurvivalTime = Number(row.total_survival_time);

    return {
      games_played: totalGames,
      wins,
      win_rate_percent: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
      avg_survival_time: totalGames > 0 ? Math.round(totalSurvivalTime / totalGames) : 0,
    };
  } catch (err) {
    console.error('Failed to fetch player stats:', err);
    return null;
  }
}

export function isDatabaseConnected(): boolean {
  return pool !== null;
}
