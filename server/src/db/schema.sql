-- GOLD RING — relational schema equivalent to the JSON store.
--
-- The shipped server uses a JSON file so the project runs with no native build
-- step. This schema is the production target (PostgreSQL 14+); the repository
-- methods in server/src/db/store.ts map one-to-one onto these tables.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archer_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bow_class   TEXT NOT NULL CHECK (bow_class IN ('recurve', 'compound', 'barebow')),
  format_id   TEXT NOT NULL,
  score       INTEGER NOT NULL CHECK (score >= 0),
  x_count     INTEGER NOT NULL DEFAULT 0 CHECK (x_count >= 0),
  played_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scores_leaderboard_idx
  ON scores (bow_class, format_id, score DESC, x_count DESC);

CREATE TABLE IF NOT EXISTS equipment (
  archer_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  gear        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      TEXT NOT NULL,
  bow_class    TEXT NOT NULL,
  format_id    TEXT NOT NULL,
  player_a     TEXT NOT NULL REFERENCES users(id),
  player_b     TEXT NOT NULL REFERENCES users(id),
  winner_id    TEXT REFERENCES users(id),
  score_a      INTEGER NOT NULL DEFAULT 0,
  score_b      INTEGER NOT NULL DEFAULT 0,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);

-- One row per arrow, including the replay result. The server writes this row
-- only after validateShot() accepts the shot.
CREATE TABLE IF NOT EXISTS shots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  archer_id     TEXT NOT NULL REFERENCES users(id),
  end_index     INTEGER NOT NULL,
  arrow_index   INTEGER NOT NULL,
  aim_x         DOUBLE PRECISION NOT NULL,
  aim_y         DOUBLE PRECISION NOT NULL,
  draw_fraction DOUBLE PRECISION NOT NULL,
  hold_seconds  DOUBLE PRECISION NOT NULL,
  release_quality DOUBLE PRECISION NOT NULL,
  cant_rad      DOUBLE PRECISION NOT NULL,
  torque_rad    DOUBLE PRECISION NOT NULL,
  wind_seed     BIGINT NOT NULL,
  impact_x      DOUBLE PRECISION NOT NULL,
  impact_y      DOUBLE PRECISION NOT NULL,
  value         INTEGER NOT NULL CHECK (value BETWEEN 0 AND 10),
  is_x          BOOLEAN NOT NULL DEFAULT false,
  accepted      BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shots_match_idx ON shots (match_id, end_index, arrow_index);

CREATE TABLE IF NOT EXISTS daily_seeds (
  challenge_id TEXT PRIMARY KEY,
  seed         BIGINT NOT NULL,
  bow_class    TEXT NOT NULL,
  distance_m   DOUBLE PRECISION NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL
);
