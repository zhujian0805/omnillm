import { Database } from "bun:sqlite"
import consola from "consola"
import path from "node:path"

import { PATHS } from "./paths"

export interface ConfigRecord {
  key: string
  value: string
  created_at: string
  updated_at: string
}

export interface ProviderInstanceRecord {
  instance_id: string
  provider_id: string
  name: string
  priority: number
  activated: number // 0 or 1
  created_at: string
  updated_at: string
}

export interface TokenRecord {
  instance_id: string
  provider_id: string
  token_data: string // JSON string
  created_at: string
  updated_at: string
}

export interface ProviderModelStateRecord {
  instance_id: string
  model_id: string
  enabled: number // 0 or 1
  created_at: string
  updated_at: string
}

export interface ProviderConfigRecord {
  instance_id: string
  config_data: string // JSON string
  created_at: string
  updated_at: string
}

export interface ModelConfigRecord {
  instance_id: string
  model_id: string
  version: string
  config_data: string // JSON string - for model-specific configuration
  created_at: string
  updated_at: string
}

let db: Database | null = null

export function getDatabase(): Database {
  if (!db) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() first.",
    )
  }
  return db
}

export async function initializeDatabase(): Promise<void> {
  try {
    // Ensure config directory exists
    await Bun.$`mkdir -p ${PATHS.CONFIG_DIR}`.quiet()

    const dbPath = path.join(PATHS.CONFIG_DIR, "database.sqlite")
    consola.debug(`Initializing SQLite database at: ${dbPath}`)

    db = new Database(dbPath)

    // Enable WAL mode for better performance
    db.run("PRAGMA journal_mode = WAL")

    // Create tables
    createTables()

    consola.debug("SQLite database initialized successfully")
  } catch (error) {
    consola.error("Failed to initialize database:", error)
    throw error
  }
}

function createTables(): void {
  if (!db) return

  // Configuration table
  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Provider instances table
  db.run(`
    CREATE TABLE IF NOT EXISTS provider_instances (
      instance_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      activated INTEGER NOT NULL DEFAULT 0 CHECK (activated IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Tokens table
  db.run(`
    CREATE TABLE IF NOT EXISTS tokens (
      instance_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      token_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE
    )
  `)

  // Provider model states table
  db.run(`
    CREATE TABLE IF NOT EXISTS provider_model_states (
      instance_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (instance_id, model_id),
      FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE
    )
  `)

  // Provider configurations table
  db.run(`
    CREATE TABLE IF NOT EXISTS provider_configs (
      instance_id TEXT PRIMARY KEY,
      config_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE
    )
  `)

  // Model configurations table
  db.run(`
    CREATE TABLE IF NOT EXISTS model_configs (
      instance_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1',
      config_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (instance_id, model_id),
      FOREIGN KEY (instance_id) REFERENCES provider_instances (instance_id) ON DELETE CASCADE
    )
  `)

  // Chat sessions table
  db.run(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model_id TEXT NOT NULL,
      api_shape TEXT NOT NULL DEFAULT 'openai',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Chat messages table
  db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      message_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions (session_id) ON DELETE CASCADE
    )
  `)

  // Create indexes for better performance
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_provider_instances_provider_id
    ON provider_instances (provider_id);

    CREATE INDEX IF NOT EXISTS idx_provider_instances_priority
    ON provider_instances (priority);

    CREATE INDEX IF NOT EXISTS idx_provider_instances_activated
    ON provider_instances (activated);

    CREATE INDEX IF NOT EXISTS idx_tokens_provider_id
    ON tokens (provider_id);

    CREATE INDEX IF NOT EXISTS idx_provider_model_states_instance_id
    ON provider_model_states (instance_id);

    CREATE INDEX IF NOT EXISTS idx_provider_model_states_enabled
    ON provider_model_states (enabled);

    CREATE INDEX IF NOT EXISTS idx_model_configs_instance_id
    ON model_configs (instance_id);

    CREATE INDEX IF NOT EXISTS idx_model_configs_model_id
    ON model_configs (model_id);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id
    ON chat_messages (session_id);
  `)

  consola.debug("Database tables created successfully")
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    consola.debug("Database connection closed")
  }
}

// Configuration operations
export class ConfigStore {
  static get(key: string): string | null {
    const db = getDatabase()
    const stmt = db.prepare("SELECT value FROM config WHERE key = ?")
    const result = stmt.get(key) as { value: string } | undefined
    return result?.value || null
  }

  static set(key: string, value: string): void {
    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO config (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `)
    stmt.run(key, value)
  }

  static delete(key: string): void {
    const db = getDatabase()
    const stmt = db.prepare("DELETE FROM config WHERE key = ?")
    stmt.run(key)
  }

  static getAll(): Record<string, string> {
    const db = getDatabase()
    const stmt = db.prepare("SELECT key, value FROM config")
    const results = stmt.all() as Array<{ key: string; value: string }>
    return Object.fromEntries(results.map((r) => [r.key, r.value]))
  }
}

// Provider instance operations
export class ProviderInstanceStore {
  static get(instanceId: string): ProviderInstanceRecord | null {
    const db = getDatabase()
    const stmt = db.prepare(
      "SELECT * FROM provider_instances WHERE instance_id = ?",
    )
    return stmt.get(instanceId) as ProviderInstanceRecord | null
  }

  static getAll(): Array<ProviderInstanceRecord> {
    const db = getDatabase()
    const stmt = db.prepare(
      "SELECT * FROM provider_instances ORDER BY priority ASC",
    )
    return stmt.all() as Array<ProviderInstanceRecord>
  }

  static save(
    record: Omit<ProviderInstanceRecord, "created_at" | "updated_at">,
  ): void {
    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO provider_instances
      (instance_id, provider_id, name, priority, activated, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(instance_id) DO UPDATE SET
        provider_id = excluded.provider_id,
        name = excluded.name,
        priority = excluded.priority,
        activated = excluded.activated,
        updated_at = datetime('now')
    `)
    stmt.run(
      record.instance_id,
      record.provider_id,
      record.name,
      record.priority,
      record.activated,
    )
  }

  static delete(instanceId: string): void {
    const db = getDatabase()
    const stmt = db.prepare(
      "DELETE FROM provider_instances WHERE instance_id = ?",
    )
    stmt.run(instanceId)
  }

  static setActivation(instanceId: string, activated: boolean): void {
    const db = getDatabase()
    const stmt = db.prepare(`
      UPDATE provider_instances
      SET activated = ?, updated_at = datetime('now')
      WHERE instance_id = ?
    `)
    stmt.run(activated ? 1 : 0, instanceId)
  }
}

// Token operations
export class TokenStore {
  static get(instanceId: string): TokenRecord | null {
    const db = getDatabase()
    const stmt = db.prepare("SELECT * FROM tokens WHERE instance_id = ?")
    return stmt.get(instanceId) as TokenRecord | null
  }

  static save(instanceId: string, providerId: string, tokenData: object): void {
    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO tokens (instance_id, provider_id, token_data, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(instance_id) DO UPDATE SET
        provider_id = excluded.provider_id,
        token_data = excluded.token_data,
        updated_at = datetime('now')
    `)
    stmt.run(instanceId, providerId, JSON.stringify(tokenData))
  }

  static delete(instanceId: string): void {
    const db = getDatabase()
    const stmt = db.prepare("DELETE FROM tokens WHERE instance_id = ?")
    stmt.run(instanceId)
  }

  static getAllByProvider(providerId: string): Array<TokenRecord> {
    const db = getDatabase()
    const stmt = db.prepare("SELECT * FROM tokens WHERE provider_id = ?")
    return stmt.all(providerId) as Array<TokenRecord>
  }
}

// Provider model state operations
export class ModelStateStore {
  static get(
    instanceId: string,
    modelId: string,
  ): ProviderModelStateRecord | null {
    const db = getDatabase()
    const stmt = db.prepare(
      "SELECT * FROM provider_model_states WHERE instance_id = ? AND model_id = ?",
    )
    return stmt.get(instanceId, modelId) as ProviderModelStateRecord | null
  }

  static getAllForInstance(
    instanceId: string,
  ): Array<ProviderModelStateRecord> {
    const db = getDatabase()
    const stmt = db.prepare(
      "SELECT * FROM provider_model_states WHERE instance_id = ?",
    )
    return stmt.all(instanceId) as Array<ProviderModelStateRecord>
  }

  static set(instanceId: string, modelId: string, enabled: boolean): void {
    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO provider_model_states (instance_id, model_id, enabled, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(instance_id, model_id) DO UPDATE SET
        enabled = excluded.enabled,
        updated_at = datetime('now')
    `)
    stmt.run(instanceId, modelId, enabled ? 1 : 0)
  }

  static delete(instanceId: string, modelId?: string): void {
    const db = getDatabase()
    if (modelId) {
      const stmt = db.prepare(
        "DELETE FROM provider_model_states WHERE instance_id = ? AND model_id = ?",
      )
      stmt.run(instanceId, modelId)
    } else {
      // Delete all model states for instance
      const stmt = db.prepare(
        "DELETE FROM provider_model_states WHERE instance_id = ?",
      )
      stmt.run(instanceId)
    }
  }

  static getDisabledModels(instanceId: string): Set<string> {
    const db = getDatabase()
    const stmt = db.prepare(
      "SELECT model_id FROM provider_model_states WHERE instance_id = ? AND enabled = 0",
    )
    const results = stmt.all(instanceId) as Array<{ model_id: string }>
    return new Set(results.map((r) => r.model_id))
  }
}

// Provider config operations
export class ProviderConfigStore {
  static get(instanceId: string): ProviderConfigRecord | null {
    const db = getDatabase()
    const stmt = db.prepare(
      "SELECT * FROM provider_configs WHERE instance_id = ?",
    )
    return stmt.get(instanceId) as ProviderConfigRecord | null
  }

  static save(instanceId: string, configData: object): void {
    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO provider_configs (instance_id, config_data, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(instance_id) DO UPDATE SET
        config_data = excluded.config_data,
        updated_at = datetime('now')
    `)
    stmt.run(instanceId, JSON.stringify(configData))
  }

  static delete(instanceId: string): void {
    const db = getDatabase()
    const stmt = db.prepare(
      "DELETE FROM provider_configs WHERE instance_id = ?",
    )
    stmt.run(instanceId)
  }

  static getConfig<T>(instanceId: string): T | null {
    const record = ProviderConfigStore.get(instanceId)
    if (!record) return null

    try {
      return JSON.parse(record.config_data) as T
    } catch {
      return null
    }
  }
}

// Model config operations
export class ModelConfigStore {
  static get(instanceId: string, modelId: string): ModelConfigRecord | null {
    const db = getDatabase()
    const stmt = db.prepare(
      "SELECT * FROM model_configs WHERE instance_id = ? AND model_id = ?",
    )
    return stmt.get(instanceId, modelId) as ModelConfigRecord | null
  }

  static getAllForInstance(instanceId: string): Array<ModelConfigRecord> {
    const db = getDatabase()
    const stmt = db.prepare("SELECT * FROM model_configs WHERE instance_id = ?")
    return stmt.all(instanceId) as Array<ModelConfigRecord>
  }

  static save(
    instanceId: string,
    modelId: string,
    version: string,
    configData: object = {},
  ): void {
    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO model_configs (instance_id, model_id, version, config_data, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(instance_id, model_id) DO UPDATE SET
        version = excluded.version,
        config_data = excluded.config_data,
        updated_at = datetime('now')
    `)
    stmt.run(instanceId, modelId, version, JSON.stringify(configData))
  }

  static setVersion(
    instanceId: string,
    modelId: string,
    version: string,
  ): void {
    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO model_configs (instance_id, model_id, version, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(instance_id, model_id) DO UPDATE SET
        version = excluded.version,
        updated_at = datetime('now')
    `)
    stmt.run(instanceId, modelId, version)
  }

  static getVersion(instanceId: string, modelId: string): string {
    const record = ModelConfigStore.get(instanceId, modelId)
    return record?.version || "1"
  }

  static delete(instanceId: string, modelId?: string): void {
    const db = getDatabase()
    if (modelId) {
      const stmt = db.prepare(
        "DELETE FROM model_configs WHERE instance_id = ? AND model_id = ?",
      )
      stmt.run(instanceId, modelId)
    } else {
      // Delete all model configs for instance
      const stmt = db.prepare("DELETE FROM model_configs WHERE instance_id = ?")
      stmt.run(instanceId)
    }
  }

  static getConfig<T>(instanceId: string, modelId: string): T | null {
    const record = ModelConfigStore.get(instanceId, modelId)
    if (!record) return null

    try {
      return JSON.parse(record.config_data) as T
    } catch {
      return null
    }
  }
}

// ─── Chat history types ───────────────────────────────────────────────────────

export interface ChatSessionRecord {
  session_id: string
  title: string
  model_id: string
  api_shape: string
  created_at: string
  updated_at: string
}

export interface ChatMessageRecord {
  message_id: string
  session_id: string
  role: "user" | "assistant" | "system"
  content: string
  created_at: string
}

// Chat session operations
export class ChatStore {
  static createSession(
    sessionId: string,
    title: string,
    modelId: string,
    apiShape: string,
  ): void {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO chat_sessions (session_id, title, model_id, api_shape)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, title, modelId, apiShape)
  }

  static updateSessionTitle(sessionId: string, title: string): void {
    const db = getDatabase()
    db.prepare(`
      UPDATE chat_sessions SET title = ?, updated_at = datetime('now')
      WHERE session_id = ?
    `).run(title, sessionId)
  }

  static touchSession(sessionId: string): void {
    const db = getDatabase()
    db.prepare(`
      UPDATE chat_sessions SET updated_at = datetime('now') WHERE session_id = ?
    `).run(sessionId)
  }

  static listSessions(): Array<ChatSessionRecord> {
    const db = getDatabase()
    return db.prepare(
      "SELECT * FROM chat_sessions ORDER BY updated_at DESC"
    ).all() as Array<ChatSessionRecord>
  }

  static getSession(sessionId: string): ChatSessionRecord | null {
    const db = getDatabase()
    return db.prepare(
      "SELECT * FROM chat_sessions WHERE session_id = ?"
    ).get(sessionId) as ChatSessionRecord | null
  }

  static deleteSession(sessionId: string): void {
    const db = getDatabase()
    db.prepare("DELETE FROM chat_sessions WHERE session_id = ?").run(sessionId)
  }

  static deleteAllSessions(): void {
    const db = getDatabase()
    db.prepare("DELETE FROM chat_sessions").run()
  }

  static addMessage(
    messageId: string,
    sessionId: string,
    role: "user" | "assistant" | "system",
    content: string,
  ): void {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO chat_messages (message_id, session_id, role, content)
      VALUES (?, ?, ?, ?)
    `).run(messageId, sessionId, role, content)
  }

  static getMessages(sessionId: string): Array<ChatMessageRecord> {
    const db = getDatabase()
    return db.prepare(
      "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC"
    ).all(sessionId) as Array<ChatMessageRecord>
  }
}
