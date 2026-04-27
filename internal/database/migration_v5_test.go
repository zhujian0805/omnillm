package database

// Tests for migration v5: rebuild the tokens table to remove the legacy
// provider_id TEXT NOT NULL column that exists in some older databases.
//
// Scenario coverage:
//   - A database that has the legacy tokens table (provider_id NOT NULL, no DEFAULT)
//     should be migrated so that subsequent INSERT statements succeed without
//     supplying provider_id.
//   - A fresh database (no legacy column) should be unaffected — the migration
//     is idempotent.
//   - Existing token rows are preserved across the migration.
//   - The legacy idx_tokens_provider_id index is dropped as part of the rebuild.

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// buildLegacyTokensDB creates a minimal SQLite database that replicates the
// schema seen in user databases that pre-date the removal of the provider_id
// column from the tokens table.  Migrations 1-4 are recorded as already applied
// so that only v5 runs when createTables() is called.
func buildLegacyTokensDB(t *testing.T) *Database {
	t.Helper()

	tmpDir := t.TempDir()
	rawDB, err := sql.Open("sqlite", filepath.Join(tmpDir, "legacy-tokens.sqlite"))
	if err != nil {
		t.Fatalf("open legacy DB: %v", err)
	}
	t.Cleanup(func() { _ = rawDB.Close() })

	statements := []string{
		// schema_migrations
		`CREATE TABLE schema_migrations (
			version    INTEGER PRIMARY KEY,
			applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
		)`,
		// provider_instances — needed for FK references
		`CREATE TABLE provider_instances (
			instance_id TEXT    PRIMARY KEY,
			provider_id TEXT    NOT NULL,
			name        TEXT    NOT NULL,
			subtitle    TEXT    NOT NULL DEFAULT '',
			priority    INTEGER NOT NULL DEFAULT 0,
			activated   INTEGER NOT NULL DEFAULT 0 CHECK (activated IN (0, 1)),
			created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
			updated_at  DATETIME NOT NULL DEFAULT (datetime('now'))
		)`,
		// Legacy tokens table: provider_id NOT NULL without DEFAULT — the broken schema
		`CREATE TABLE tokens (
			instance_id TEXT    PRIMARY KEY,
			provider_id TEXT    NOT NULL,
			token_data  TEXT    NOT NULL,
			created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
			updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE
		)`,
		// Legacy index on provider_id — migration v5 must drop this
		`CREATE INDEX idx_tokens_provider_id ON tokens (provider_id)`,
		// Minimal stubs for other required tables
		`CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT (datetime('now')), updated_at DATETIME NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE provider_model_states (instance_id TEXT NOT NULL, model_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT (datetime('now')), updated_at DATETIME NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (instance_id, model_id), FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE)`,
		`CREATE TABLE provider_configs (instance_id TEXT PRIMARY KEY, config_data TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT (datetime('now')), updated_at DATETIME NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE)`,
		`CREATE TABLE model_configs (instance_id TEXT NOT NULL, model_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, config_data TEXT NOT NULL DEFAULT '{}', created_at DATETIME NOT NULL DEFAULT (datetime('now')), updated_at DATETIME NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (instance_id, model_id), FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE)`,
		`CREATE TABLE provider_models_cache (instance_id TEXT PRIMARY KEY, models_data TEXT NOT NULL, cached_at DATETIME NOT NULL DEFAULT (datetime('now')), updated_at DATETIME, FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE)`,
		`CREATE TABLE chat_sessions (session_id TEXT PRIMARY KEY, title TEXT NOT NULL, model_id TEXT NOT NULL, api_shape TEXT NOT NULL DEFAULT 'openai', created_at DATETIME NOT NULL DEFAULT (datetime('now')), updated_at DATETIME NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE chat_messages (message_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('user','assistant','system')), content TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (session_id) REFERENCES chat_sessions (session_id) ON DELETE CASCADE)`,
		`CREATE TABLE virtual_models (virtual_model_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', api_shape TEXT NOT NULL DEFAULT 'openai', lb_strategy TEXT NOT NULL DEFAULT 'round-robin' CHECK (lb_strategy IN ('round-robin','random','priority','weighted')), enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), created_at DATETIME NOT NULL DEFAULT (datetime('now')), updated_at DATETIME NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE virtual_model_upstreams (id INTEGER PRIMARY KEY AUTOINCREMENT, virtual_model_id TEXT NOT NULL, provider_id TEXT NOT NULL DEFAULT '', model_id TEXT NOT NULL, weight INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (virtual_model_id) REFERENCES virtual_models (virtual_model_id) ON DELETE CASCADE)`,
		// Mark migrations 1-4 as already applied
		`INSERT INTO schema_migrations (version) VALUES (1),(2),(3),(4)`,
		// Seed a provider instance and an existing token row (with provider_id)
		`INSERT INTO provider_instances (instance_id, provider_id, name) VALUES ('existing-provider', 'mock', 'Existing Provider')`,
		`INSERT INTO tokens (instance_id, provider_id, token_data) VALUES ('existing-provider', 'mock', '{"access_token":"old-token"}')`,
	}

	for _, s := range statements {
		if _, err := rawDB.Exec(s); err != nil {
			t.Fatalf("seed legacy DB (%s...): %v", s[:min(60, len(s))], err)
		}
	}

	return &Database{db: rawDB}
}

// TestMigrationV5_FixesLegacyTokensTableConstraint verifies that after
// applying migration v5 against a legacy database, INSERT into tokens succeeds
// without providing a provider_id column.
func TestMigrationV5_FixesLegacyTokensTableConstraint(t *testing.T) {
	db := buildLegacyTokensDB(t)

	if err := db.createTables(); err != nil {
		t.Fatalf("createTables (migration v5): %v", err)
	}

	// The INSERT must succeed without supplying provider_id.
	_, err := db.db.Exec(
		`INSERT INTO provider_instances (instance_id, provider_id, name) VALUES ('new-provider', 'mock', 'New')`,
	)
	if err != nil {
		t.Fatalf("insert provider_instances: %v", err)
	}
	_, err = db.db.Exec(
		`INSERT INTO tokens (instance_id, token_data) VALUES ('new-provider', '{"access_token":"new-token"}')`,
	)
	if err != nil {
		t.Fatalf("insert into tokens after migration v5 failed: %v", err)
	}
}

// TestMigrationV5_PreservesExistingTokenRows verifies that token rows that
// existed before the migration are still present after it runs.
func TestMigrationV5_PreservesExistingTokenRows(t *testing.T) {
	db := buildLegacyTokensDB(t)

	if err := db.createTables(); err != nil {
		t.Fatalf("createTables: %v", err)
	}

	var tokenData string
	err := db.db.QueryRow(
		`SELECT token_data FROM tokens WHERE instance_id = 'existing-provider'`,
	).Scan(&tokenData)
	if err != nil {
		t.Fatalf("existing token row not found after migration: %v", err)
	}
	if tokenData != `{"access_token":"old-token"}` {
		t.Errorf("unexpected token_data after migration: %q", tokenData)
	}
}

// TestMigrationV5_LegacyIndexDropped verifies that the idx_tokens_provider_id
// index is removed after migration v5 runs.
func TestMigrationV5_LegacyIndexDropped(t *testing.T) {
	db := buildLegacyTokensDB(t)

	if err := db.createTables(); err != nil {
		t.Fatalf("createTables: %v", err)
	}

	var count int
	err := db.db.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_tokens_provider_id'`,
	).Scan(&count)
	if err != nil {
		t.Fatalf("query sqlite_master: %v", err)
	}
	if count != 0 {
		t.Errorf("expected idx_tokens_provider_id to be dropped, but it still exists")
	}
}

// TestMigrationV5_NoProviderIDColumnAfterMigration verifies that the
// provider_id column no longer exists in the tokens table.
func TestMigrationV5_NoProviderIDColumnAfterMigration(t *testing.T) {
	db := buildLegacyTokensDB(t)

	if err := db.createTables(); err != nil {
		t.Fatalf("createTables: %v", err)
	}

	rows, err := db.db.Query(`PRAGMA table_info(tokens)`)
	if err != nil {
		t.Fatalf("PRAGMA table_info: %v", err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, colType string
		var notNull int
		var dfltValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			t.Fatalf("scan column info: %v", err)
		}
		if name == "provider_id" {
			t.Error("provider_id column still present in tokens table after migration v5")
		}
	}
}

// TestMigrationV5_IdempotentOnFreshDatabase verifies that running createTables
// on a fresh database (no legacy provider_id column) does not break anything —
// the tokens table already has the correct schema, so migration v5 is a no-op.
func TestMigrationV5_IdempotentOnFreshDatabase(t *testing.T) {
	tmpDir := t.TempDir()
	rawDB, err := sql.Open("sqlite", filepath.Join(tmpDir, "fresh.sqlite"))
	if err != nil {
		t.Fatalf("open fresh DB: %v", err)
	}
	defer rawDB.Close()

	fresh := &Database{db: rawDB}

	// First call — sets up tables including the correct tokens schema.
	if err := fresh.createTables(); err != nil {
		t.Fatalf("first createTables: %v", err)
	}

	// Second call — must be idempotent.
	if err := fresh.createTables(); err != nil {
		t.Fatalf("second createTables call: %v", err)
	}

	// INSERT without provider_id must work on the fresh database.
	if _, err := rawDB.Exec(
		`INSERT INTO provider_instances (instance_id, provider_id, name) VALUES ('fresh-p1', 'mock', 'Fresh')`,
	); err != nil {
		t.Fatalf("insert provider_instances: %v", err)
	}
	if _, err := rawDB.Exec(
		`INSERT INTO tokens (instance_id, token_data) VALUES ('fresh-p1', '{"access_token":"x"}')`,
	); err != nil {
		t.Fatalf("insert token on fresh DB: %v", err)
	}
}

// TestMigrationV5_MigrationRecordedInSchemaTable verifies that version 5 is
// written to schema_migrations after the migration runs on a legacy database.
func TestMigrationV5_MigrationRecordedInSchemaTable(t *testing.T) {
	db := buildLegacyTokensDB(t)

	if err := db.createTables(); err != nil {
		t.Fatalf("createTables: %v", err)
	}

	var count int
	if err := db.db.QueryRow(
		`SELECT COUNT(*) FROM schema_migrations WHERE version = 5`,
	).Scan(&count); err != nil {
		t.Fatalf("query schema_migrations: %v", err)
	}
	if count != 1 {
		t.Errorf("expected migration v5 to be recorded, got count=%d", count)
	}
}
