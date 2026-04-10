// Package database provides SQLite-based persistence for OmniModel
package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/rs/zerolog/log"
	_ "modernc.org/sqlite"
)

// parseTime converts a string timestamp to time.Time
// SQLite returns timestamps as strings from modernc.org/sqlite
func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	// Try RFC3339 format first (ISO 8601 with timezone)
	t, err := time.Parse(time.RFC3339, s)
	if err == nil {
		return t
	}
	// Try RFC3339Nano format
	t, err = time.Parse(time.RFC3339Nano, s)
	if err == nil {
		return t
	}
	// Try SQLite datetime format
	t, err = time.Parse("2006-01-02 15:04:05", s)
	if err == nil {
		return t
	}
	// Return zero time if parsing fails
	return time.Time{}
}

type Database struct {
	db *sql.DB
}

type ConfigRecord struct {
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ProviderInstanceRecord struct {
	InstanceID string    `json:"instance_id"`
	ProviderID string    `json:"provider_id"`
	Name       string    `json:"name"`
	Priority   int       `json:"priority"`
	Activated  bool      `json:"activated"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type TokenRecord struct {
	InstanceID string    `json:"instance_id"`
	ProviderID string    `json:"provider_id"`
	TokenData  string    `json:"token_data"` // JSON string
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type ProviderModelStateRecord struct {
	InstanceID string    `json:"instance_id"`
	ModelID    string    `json:"model_id"`
	Enabled    bool      `json:"enabled"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type ProviderConfigRecord struct {
	InstanceID string    `json:"instance_id"`
	ConfigData string    `json:"config_data"` // JSON string
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type ModelConfigRecord struct {
	InstanceID string    `json:"instance_id"`
	ModelID    string    `json:"model_id"`
	Version    string    `json:"version"`
	ConfigData string    `json:"config_data"` // JSON string - for model-specific configuration
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type ChatSessionRecord struct {
	SessionID string    `json:"session_id"`
	Title     string    `json:"title"`
	ModelID   string    `json:"model_id"`
	APIShape  string    `json:"api_shape"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ChatMessageRecord struct {
	MessageID string    `json:"message_id"`
	SessionID string    `json:"session_id"`
	Role      string    `json:"role"` // user, assistant, system
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

var globalDB *Database

func InitializeDatabase(configDir string) error {
	// Ensure config directory exists
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	dbPath := filepath.Join(configDir, "database.sqlite")
	log.Debug().Str("path", dbPath).Msg("Initializing SQLite database")

	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL")
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	globalDB = &Database{db: db}

	if err := globalDB.createTables(); err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}

	log.Debug().Msg("SQLite database initialized successfully")
	return nil
}

func GetDatabase() *Database {
	if globalDB == nil {
		panic("Database not initialized. Call InitializeDatabase() first.")
	}
	return globalDB
}

func (db *Database) createTables() error {
	queries := []string{
		// Configuration table
		`CREATE TABLE IF NOT EXISTS config (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT (datetime('now')),
			updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
		)`,

		// Provider instances table
		`CREATE TABLE IF NOT EXISTS provider_instances (
			instance_id TEXT PRIMARY KEY,
			provider_id TEXT NOT NULL,
			name TEXT NOT NULL,
			priority INTEGER NOT NULL DEFAULT 0,
			activated INTEGER NOT NULL DEFAULT 0 CHECK (activated IN (0, 1)),
			created_at DATETIME NOT NULL DEFAULT (datetime('now')),
			updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
		)`,

		// Tokens table
		`CREATE TABLE IF NOT EXISTS tokens (
			instance_id TEXT PRIMARY KEY,
			provider_id TEXT NOT NULL,
			token_data TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT (datetime('now')),
			updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE
		)`,

		// Provider model states table
		`CREATE TABLE IF NOT EXISTS provider_model_states (
			instance_id TEXT NOT NULL,
			model_id TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
			created_at DATETIME NOT NULL DEFAULT (datetime('now')),
			updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (instance_id, model_id),
			FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE
		)`,

		// Provider configurations table
		`CREATE TABLE IF NOT EXISTS provider_configs (
			instance_id TEXT PRIMARY KEY,
			config_data TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT (datetime('now')),
			updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE
		)`,

		// Model configurations table
		`CREATE TABLE IF NOT EXISTS model_configs (
			instance_id TEXT NOT NULL,
			model_id TEXT NOT NULL,
			version TEXT NOT NULL DEFAULT '1',
			config_data TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME NOT NULL DEFAULT (datetime('now')),
			updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (instance_id, model_id),
			FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE
		)`,

		// Chat sessions table
		`CREATE TABLE IF NOT EXISTS chat_sessions (
			session_id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			model_id TEXT NOT NULL,
			api_shape TEXT NOT NULL DEFAULT 'openai',
			created_at DATETIME NOT NULL DEFAULT (datetime('now')),
			updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
		)`,

		// Chat messages table
		`CREATE TABLE IF NOT EXISTS chat_messages (
			message_id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
			content TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY (session_id) REFERENCES chat_sessions (session_id) ON DELETE CASCADE
		)`,
	}

	for _, query := range queries {
		if _, err := db.db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query: %w", err)
		}
	}

	// Create indexes
	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_provider_instances_provider_id ON provider_instances (provider_id)`,
		`CREATE INDEX IF NOT EXISTS idx_provider_instances_priority ON provider_instances (priority)`,
		`CREATE INDEX IF NOT EXISTS idx_provider_instances_activated ON provider_instances (activated)`,
		`CREATE INDEX IF NOT EXISTS idx_tokens_provider_id ON tokens (provider_id)`,
		`CREATE INDEX IF NOT EXISTS idx_provider_model_states_instance_id ON provider_model_states (instance_id)`,
		`CREATE INDEX IF NOT EXISTS idx_provider_model_states_enabled ON provider_model_states (enabled)`,
		`CREATE INDEX IF NOT EXISTS idx_model_configs_instance_id ON model_configs (instance_id)`,
		`CREATE INDEX IF NOT EXISTS idx_model_configs_model_id ON model_configs (model_id)`,
		`CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages (session_id)`,
	}

	for _, indexQuery := range indexes {
		if _, err := db.db.Exec(indexQuery); err != nil {
			return fmt.Errorf("failed to create index: %w", err)
		}
	}

	log.Debug().Msg("Database tables created successfully")
	return nil
}

func (db *Database) Close() error {
	if db.db != nil {
		log.Debug().Msg("Database connection closed")
		return db.db.Close()
	}
	return nil
}

// Configuration operations
type ConfigStore struct {
	db *Database
}

func NewConfigStore() *ConfigStore {
	return &ConfigStore{db: GetDatabase()}
}

func (cs *ConfigStore) Get(key string) (string, error) {
	var value string
	err := cs.db.db.QueryRow("SELECT value FROM config WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

func (cs *ConfigStore) Set(key, value string) error {
	_, err := cs.db.db.Exec(`
		INSERT INTO config (key, value, updated_at)
		VALUES (?, ?, datetime('now'))
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = datetime('now')
	`, key, value)
	return err
}

func (cs *ConfigStore) Delete(key string) error {
	_, err := cs.db.db.Exec("DELETE FROM config WHERE key = ?", key)
	return err
}

func (cs *ConfigStore) GetAll() (map[string]string, error) {
	rows, err := cs.db.db.Query("SELECT key, value FROM config")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		result[key] = value
	}
	return result, nil
}

// Provider instance operations
type ProviderInstanceStore struct {
	db *Database
}

func NewProviderInstanceStore() *ProviderInstanceStore {
	return &ProviderInstanceStore{db: GetDatabase()}
}

func (pis *ProviderInstanceStore) Get(instanceID string) (*ProviderInstanceRecord, error) {
	var record ProviderInstanceRecord
	var activated int
	var createdAtStr, updatedAtStr string
	err := pis.db.db.QueryRow(`
		SELECT instance_id, provider_id, name, priority, activated, created_at, updated_at
		FROM provider_instances WHERE instance_id = ?
	`, instanceID).Scan(&record.InstanceID, &record.ProviderID, &record.Name, &record.Priority, &activated, &createdAtStr, &updatedAtStr)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	record.Activated = activated != 0
	record.CreatedAt = parseTime(createdAtStr)
	record.UpdatedAt = parseTime(updatedAtStr)
	return &record, nil
}

func (pis *ProviderInstanceStore) GetAll() ([]ProviderInstanceRecord, error) {
	rows, err := pis.db.db.Query(`
		SELECT instance_id, provider_id, name, priority, activated, created_at, updated_at
		FROM provider_instances ORDER BY priority ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []ProviderInstanceRecord
	for rows.Next() {
		var record ProviderInstanceRecord
		var activated int
		var createdAtStr, updatedAtStr string
		if err := rows.Scan(&record.InstanceID, &record.ProviderID, &record.Name, &record.Priority, &activated, &createdAtStr, &updatedAtStr); err != nil {
			return nil, err
		}
		record.Activated = activated != 0
		record.CreatedAt = parseTime(createdAtStr)
		record.UpdatedAt = parseTime(updatedAtStr)
		records = append(records, record)
	}
	return records, nil
}

func (pis *ProviderInstanceStore) Save(record *ProviderInstanceRecord) error {
	activated := 0
	if record.Activated {
		activated = 1
	}

	_, err := pis.db.db.Exec(`
		INSERT INTO provider_instances
		(instance_id, provider_id, name, priority, activated, updated_at)
		VALUES (?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT(instance_id) DO UPDATE SET
			provider_id = excluded.provider_id,
			name = excluded.name,
			priority = excluded.priority,
			activated = excluded.activated,
			updated_at = datetime('now')
	`, record.InstanceID, record.ProviderID, record.Name, record.Priority, activated)
	return err
}

func (pis *ProviderInstanceStore) Delete(instanceID string) error {
	_, err := pis.db.db.Exec("DELETE FROM provider_instances WHERE instance_id = ?", instanceID)
	return err
}

func (pis *ProviderInstanceStore) SetActivation(instanceID string, activated bool) error {
	activatedInt := 0
	if activated {
		activatedInt = 1
	}

	_, err := pis.db.db.Exec(`
		UPDATE provider_instances
		SET activated = ?, updated_at = datetime('now')
		WHERE instance_id = ?
	`, activatedInt, instanceID)
	return err
}

// Token operations
type TokenStore struct {
	db *Database
}

func NewTokenStore() *TokenStore {
	return &TokenStore{db: GetDatabase()}
}

func (ts *TokenStore) Get(instanceID string) (*TokenRecord, error) {
	var record TokenRecord
	var createdAtStr, updatedAtStr string
	err := ts.db.db.QueryRow(`
		SELECT instance_id, provider_id, token_data, created_at, updated_at
		FROM tokens WHERE instance_id = ?
	`, instanceID).Scan(&record.InstanceID, &record.ProviderID, &record.TokenData, &createdAtStr, &updatedAtStr)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	record.CreatedAt = parseTime(createdAtStr)
	record.UpdatedAt = parseTime(updatedAtStr)
	return &record, nil
}

func (ts *TokenStore) Save(instanceID, providerID string, tokenData interface{}) error {
	tokenJSON, err := json.Marshal(tokenData)
	if err != nil {
		return err
	}

	_, err = ts.db.db.Exec(`
		INSERT INTO tokens (instance_id, provider_id, token_data, updated_at)
		VALUES (?, ?, ?, datetime('now'))
		ON CONFLICT(instance_id) DO UPDATE SET
			provider_id = excluded.provider_id,
			token_data = excluded.token_data,
			updated_at = datetime('now')
	`, instanceID, providerID, string(tokenJSON))
	return err
}

func (ts *TokenStore) Delete(instanceID string) error {
	_, err := ts.db.db.Exec("DELETE FROM tokens WHERE instance_id = ?", instanceID)
	return err
}

func (ts *TokenStore) GetAllByProvider(providerID string) ([]TokenRecord, error) {
	rows, err := ts.db.db.Query(`
		SELECT instance_id, provider_id, token_data, created_at, updated_at
		FROM tokens WHERE provider_id = ?
	`, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []TokenRecord
	for rows.Next() {
		var record TokenRecord
		var createdAtStr, updatedAtStr string
		if err := rows.Scan(&record.InstanceID, &record.ProviderID, &record.TokenData, &createdAtStr, &updatedAtStr); err != nil {
			return nil, err
		}
		record.CreatedAt = parseTime(createdAtStr)
		record.UpdatedAt = parseTime(updatedAtStr)
		records = append(records, record)
	}
	return records, nil
}

// Chat operations
type ChatStore struct {
	db *Database
}

func NewChatStore() *ChatStore {
	return &ChatStore{db: GetDatabase()}
}

func (cs *ChatStore) CreateSession(sessionID, title, modelID, apiShape string) error {
	_, err := cs.db.db.Exec(`
		INSERT INTO chat_sessions (session_id, title, model_id, api_shape)
		VALUES (?, ?, ?, ?)
	`, sessionID, title, modelID, apiShape)
	return err
}

func (cs *ChatStore) UpdateSessionTitle(sessionID, title string) error {
	_, err := cs.db.db.Exec(`
		UPDATE chat_sessions SET title = ?, updated_at = datetime('now')
		WHERE session_id = ?
	`, title, sessionID)
	return err
}

func (cs *ChatStore) TouchSession(sessionID string) error {
	_, err := cs.db.db.Exec(`
		UPDATE chat_sessions SET updated_at = datetime('now') WHERE session_id = ?
	`, sessionID)
	return err
}

func (cs *ChatStore) ListSessions() ([]ChatSessionRecord, error) {
	rows, err := cs.db.db.Query(`
		SELECT session_id, title, model_id, api_shape, created_at, updated_at
		FROM chat_sessions ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []ChatSessionRecord
	for rows.Next() {
		var session ChatSessionRecord
		var createdAtStr, updatedAtStr string
		if err := rows.Scan(&session.SessionID, &session.Title, &session.ModelID, &session.APIShape, &createdAtStr, &updatedAtStr); err != nil {
			return nil, err
		}
		session.CreatedAt = parseTime(createdAtStr)
		session.UpdatedAt = parseTime(updatedAtStr)
		sessions = append(sessions, session)
	}
	return sessions, nil
}

func (cs *ChatStore) GetSession(sessionID string) (*ChatSessionRecord, error) {
	var session ChatSessionRecord
	var createdAtStr, updatedAtStr string
	err := cs.db.db.QueryRow(`
		SELECT session_id, title, model_id, api_shape, created_at, updated_at
		FROM chat_sessions WHERE session_id = ?
	`, sessionID).Scan(&session.SessionID, &session.Title, &session.ModelID, &session.APIShape, &createdAtStr, &updatedAtStr)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	session.CreatedAt = parseTime(createdAtStr)
	session.UpdatedAt = parseTime(updatedAtStr)
	return &session, nil
}

func (cs *ChatStore) DeleteSession(sessionID string) error {
	_, err := cs.db.db.Exec("DELETE FROM chat_sessions WHERE session_id = ?", sessionID)
	return err
}

func (cs *ChatStore) DeleteAllSessions() error {
	_, err := cs.db.db.Exec("DELETE FROM chat_sessions")
	return err
}

func (cs *ChatStore) AddMessage(messageID, sessionID, role, content string) error {
	_, err := cs.db.db.Exec(`
		INSERT INTO chat_messages (message_id, session_id, role, content)
		VALUES (?, ?, ?, ?)
	`, messageID, sessionID, role, content)
	return err
}

func (cs *ChatStore) GetMessages(sessionID string) ([]ChatMessageRecord, error) {
	rows, err := cs.db.db.Query(`
		SELECT message_id, session_id, role, content, created_at
		FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []ChatMessageRecord
	for rows.Next() {
		var message ChatMessageRecord
		var createdAtStr string
		if err := rows.Scan(&message.MessageID, &message.SessionID, &message.Role, &message.Content, &createdAtStr); err != nil {
			return nil, err
		}
		message.CreatedAt = parseTime(createdAtStr)
		messages = append(messages, message)
	}
	return messages, nil
}

// Provider model state operations
type ModelStateStore struct {
	db *Database
}

func NewModelStateStore() *ModelStateStore {
	return &ModelStateStore{db: GetDatabase()}
}

func (ms *ModelStateStore) Get(instanceID, modelID string) (*ProviderModelStateRecord, error) {
	var record ProviderModelStateRecord
	var enabled int
	var createdAtStr, updatedAtStr string
	err := ms.db.db.QueryRow(`
		SELECT instance_id, model_id, enabled, created_at, updated_at
		FROM provider_model_states WHERE instance_id = ? AND model_id = ?
	`, instanceID, modelID).Scan(&record.InstanceID, &record.ModelID, &enabled, &createdAtStr, &updatedAtStr)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	record.Enabled = enabled != 0
	record.CreatedAt = parseTime(createdAtStr)
	record.UpdatedAt = parseTime(updatedAtStr)
	return &record, nil
}

func (ms *ModelStateStore) GetAllByInstance(instanceID string) ([]ProviderModelStateRecord, error) {
	rows, err := ms.db.db.Query(`
		SELECT instance_id, model_id, enabled, created_at, updated_at
		FROM provider_model_states WHERE instance_id = ?
	`, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []ProviderModelStateRecord
	for rows.Next() {
		var record ProviderModelStateRecord
		var enabled int
		var createdAtStr, updatedAtStr string
		if err := rows.Scan(&record.InstanceID, &record.ModelID, &enabled, &createdAtStr, &updatedAtStr); err != nil {
			return nil, err
		}
		record.Enabled = enabled != 0
		record.CreatedAt = parseTime(createdAtStr)
		record.UpdatedAt = parseTime(updatedAtStr)
		records = append(records, record)
	}
	return records, nil
}

func (ms *ModelStateStore) SetEnabled(instanceID, modelID string, enabled bool) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}

	_, err := ms.db.db.Exec(`
		INSERT INTO provider_model_states (instance_id, model_id, enabled, updated_at)
		VALUES (?, ?, ?, datetime('now'))
		ON CONFLICT(instance_id, model_id) DO UPDATE SET
			enabled = excluded.enabled,
			updated_at = datetime('now')
	`, instanceID, modelID, enabledInt)
	return err
}

func (ms *ModelStateStore) Delete(instanceID, modelID string) error {
	_, err := ms.db.db.Exec(
		"DELETE FROM provider_model_states WHERE instance_id = ? AND model_id = ?",
		instanceID, modelID,
	)
	return err
}

// Provider config operations
type ProviderConfigStore struct {
	db *Database
}

func NewProviderConfigStore() *ProviderConfigStore {
	return &ProviderConfigStore{db: GetDatabase()}
}

func (pcs *ProviderConfigStore) Get(instanceID string) (*ProviderConfigRecord, error) {
	var record ProviderConfigRecord
	var createdAtStr, updatedAtStr string
	err := pcs.db.db.QueryRow(`
		SELECT instance_id, config_data, created_at, updated_at
		FROM provider_configs WHERE instance_id = ?
	`, instanceID).Scan(&record.InstanceID, &record.ConfigData, &createdAtStr, &updatedAtStr)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	record.CreatedAt = parseTime(createdAtStr)
	record.UpdatedAt = parseTime(updatedAtStr)
	return &record, nil
}

func (pcs *ProviderConfigStore) Save(instanceID string, configData map[string]interface{}) error {
	configJSON, err := json.Marshal(configData)
	if err != nil {
		return err
	}

	_, err = pcs.db.db.Exec(`
		INSERT INTO provider_configs (instance_id, config_data, updated_at)
		VALUES (?, ?, datetime('now'))
		ON CONFLICT(instance_id) DO UPDATE SET
			config_data = excluded.config_data,
			updated_at = datetime('now')
	`, instanceID, string(configJSON))
	return err
}

func (pcs *ProviderConfigStore) Delete(instanceID string) error {
	_, err := pcs.db.db.Exec("DELETE FROM provider_configs WHERE instance_id = ?", instanceID)
	return err
}

// Model config operations
type ModelConfigStore struct {
	db *Database
}

func NewModelConfigStore() *ModelConfigStore {
	return &ModelConfigStore{db: GetDatabase()}
}

func (mcs *ModelConfigStore) Get(instanceID, modelID string) (*ModelConfigRecord, error) {
	var record ModelConfigRecord
	var createdAtStr, updatedAtStr string
	err := mcs.db.db.QueryRow(`
		SELECT instance_id, model_id, version, config_data, created_at, updated_at
		FROM model_configs WHERE instance_id = ? AND model_id = ?
	`, instanceID, modelID).Scan(&record.InstanceID, &record.ModelID, &record.Version, &record.ConfigData, &createdAtStr, &updatedAtStr)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	record.CreatedAt = parseTime(createdAtStr)
	record.UpdatedAt = parseTime(updatedAtStr)
	return &record, nil
}

func (mcs *ModelConfigStore) GetAllByInstance(instanceID string) ([]ModelConfigRecord, error) {
	rows, err := mcs.db.db.Query(`
		SELECT instance_id, model_id, version, config_data, created_at, updated_at
		FROM model_configs WHERE instance_id = ?
	`, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []ModelConfigRecord
	for rows.Next() {
		var record ModelConfigRecord
		var createdAtStr, updatedAtStr string
		if err := rows.Scan(&record.InstanceID, &record.ModelID, &record.Version, &record.ConfigData, &createdAtStr, &updatedAtStr); err != nil {
			return nil, err
		}
		record.CreatedAt = parseTime(createdAtStr)
		record.UpdatedAt = parseTime(updatedAtStr)
		records = append(records, record)
	}
	return records, nil
}

func (mcs *ModelConfigStore) SetVersion(instanceID, modelID, version string) error {
	_, err := mcs.db.db.Exec(`
		INSERT INTO model_configs (instance_id, model_id, version, updated_at)
		VALUES (?, ?, ?, datetime('now'))
		ON CONFLICT(instance_id, model_id) DO UPDATE SET
			version = excluded.version,
			updated_at = datetime('now')
	`, instanceID, modelID, version)
	return err
}

func (mcs *ModelConfigStore) Delete(instanceID, modelID string) error {
	_, err := mcs.db.db.Exec(
		"DELETE FROM model_configs WHERE instance_id = ? AND model_id = ?",
		instanceID, modelID,
	)
	return err
}
