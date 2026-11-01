-- Existing teams keep cycles enabled. Disabling pauses the feature without removing history.
ALTER TABLE teams ADD COLUMN cycles_enabled INTEGER NOT NULL DEFAULT 1 CHECK(cycles_enabled IN (0,1));
