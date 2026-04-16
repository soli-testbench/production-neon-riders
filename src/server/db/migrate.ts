import { Pool } from 'pg';

const MIGRATIONS = [
  {
    name: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS players (
        name TEXT PRIMARY KEY,
        total_games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        total_survival_time BIGINT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS match_results (
        id SERIAL PRIMARY KEY,
        match_id TEXT NOT NULL,
        player_name TEXT NOT NULL,
        placement INTEGER NOT NULL,
        survival_time BIGINT NOT NULL,
        is_bot BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_match_results_match_id ON match_results(match_id);
      CREATE INDEX IF NOT EXISTS idx_match_results_player_name ON match_results(player_name);
      CREATE INDEX IF NOT EXISTS idx_players_wins ON players(wins DESC);
    `,
  },
];

export async function runMigrations(pool: Pool): Promise<void> {
  // Ensure schema_migrations table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const migration of MIGRATIONS) {
    const result = await pool.query(
      'SELECT name FROM schema_migrations WHERE name = $1',
      [migration.name],
    );

    if (result.rows.length === 0) {
      console.log(`Running migration: ${migration.name}`);
      await pool.query(migration.sql);
      await pool.query(
        'INSERT INTO schema_migrations (name) VALUES ($1)',
        [migration.name],
      );
      console.log(`Migration ${migration.name} applied successfully`);
    }
  }
}
