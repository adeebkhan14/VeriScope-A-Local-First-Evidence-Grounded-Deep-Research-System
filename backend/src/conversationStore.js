import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const DEFAULT_DB_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "veriscope.db"
);

function normalizeStatus(status) {
  const safe = typeof status === "string" ? status : "completed";
  return ["streaming", "completed", "failed"].includes(safe) ? safe : "completed";
}

function normalizeRole(role) {
  const safe = typeof role === "string" ? role : "user";
  return ["user", "assistant", "system"].includes(safe) ? safe : "user";
}

function jsonValue(value) {
  if (value === undefined || value === null) return JSON.stringify([]);
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify([]);
  }
}

function parseJson(value, fallback = []) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function conversationTitleFromText(text) {
  const cleaned = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned) return "New conversation";
  const words = cleaned.split(" ").slice(0, 8).join(" ");
  return words.length > 0 ? words : "New conversation";
}

function isoNow() {
  return new Date().toISOString();
}

export function createConversationStore({ dbPath = DEFAULT_DB_PATH } = {}) {
  const dbDirectory = dirname(dbPath);
  mkdirSync(dbDirectory, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      query TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_references (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      source_id INTEGER,
      chunk_id INTEGER,
      title TEXT,
      url TEXT,
      snippet TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
  `);
  const evidenceColumns = db.prepare("PRAGMA table_info(evidence_references)").all();
  const evidenceColumnNames = new Set(evidenceColumns.map((column) => column.name));
  if (!evidenceColumnNames.has("evidence_id")) {
    db.exec("ALTER TABLE evidence_references ADD COLUMN evidence_id TEXT;");
  }
  if (!evidenceColumnNames.has("original_created_at")) {
    db.exec("ALTER TABLE evidence_references ADD COLUMN original_created_at TEXT;");
  }
  if (!evidenceColumnNames.has("original_research_turn")) {
    db.exec("ALTER TABLE evidence_references ADD COLUMN original_research_turn TEXT;");
  }
  if (!evidenceColumnNames.has("reused")) {
    db.exec("ALTER TABLE evidence_references ADD COLUMN reused INTEGER NOT NULL DEFAULT 0;");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      summarized_through_message_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summary_failures (
      conversation_id TEXT PRIMARY KEY,
      failed_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
      ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_evidence_references_message
      ON evidence_references(message_id);
    CREATE INDEX IF NOT EXISTS idx_research_runs_conversation_created
      ON research_runs(conversation_id, created_at);
  `);
  db.prepare(
    `UPDATE messages
     SET content = CASE
       WHEN content = '' THEN 'Research was interrupted by a backend restart.'
       ELSE content
     END,
     status = 'failed'
     WHERE status = 'streaming'`
  ).run();

  function touchConversation(conversationId, timestamp = isoNow()) {
    const existing = db
      .prepare("SELECT updated_at FROM conversations WHERE id = ?")
      .get(conversationId);
    const safeTimestamp =
      existing && timestamp <= existing.updated_at
        ? new Date(Date.parse(existing.updated_at) + 1).toISOString()
        : timestamp;
    db.prepare(
      "UPDATE conversations SET updated_at = ? WHERE id = ?"
    ).run(safeTimestamp, conversationId);
  }

  function ensureConversationExists(conversationId) {
    const row = db
      .prepare("SELECT id FROM conversations WHERE id = ?")
      .get(conversationId);
    if (!row) {
      const error = new Error(`Conversation not found: ${conversationId}`);
      error.code = "CONVERSATION_NOT_FOUND";
      throw error;
    }
    return row;
  }

  function runInTransaction(operation) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function serializeConversation(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      created_at: row.created_at,
      updatedAt: row.updated_at,
      updated_at: row.updated_at,
    };
  }

  function serializeMessage(row) {
    if (!row) return null;
    const evidenceReferences = db
      .prepare(
        `SELECT id, source_id, chunk_id, title, url, snippet, created_at,
                evidence_id, original_created_at, original_research_turn, reused
         FROM evidence_references
         WHERE message_id = ?
        ORDER BY created_at ASC, rowid ASC`
      )
      .all(row.id)
      .map((entry) => ({
        evidenceId: entry.evidence_id || entry.id,
        sourceId: entry.source_id,
        chunkId: entry.chunk_id,
        title: entry.title,
        url: entry.url,
        snippet: entry.snippet,
        createdAt: entry.original_created_at || entry.created_at,
        originalCreatedAt: entry.original_created_at || entry.created_at,
        originalResearchTurn: entry.original_research_turn || null,
        reused: Boolean(entry.reused),
      }));

    return {
      id: row.id,
      conversationId: row.conversation_id,
      conversation_id: row.conversation_id,
      role: row.role,
      content: row.content,
      status: row.status,
      createdAt: row.created_at,
      created_at: row.created_at,
      evidenceReferences,
    };
  }

  function createConversation({ title } = {}) {
    const conversationId = randomUUID();
    const createdAt = isoNow();
    const safeTitle =
      typeof title === "string" && title.trim()
        ? title.trim()
        : "New conversation";

    db.prepare(
      "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).run(conversationId, safeTitle, createdAt, createdAt);

    return serializeConversation(
      db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId)
    );
  }

  function ensureConversationWithTitle(conversationId, title) {
    const existing = db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(conversationId);
    if (existing) return serializeConversation(existing);
    const createdAt = isoNow();
    const safeTitle = typeof title === "string" && title.trim() ? title.trim() : "New conversation";
    db.prepare(
      "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).run(conversationId, safeTitle, createdAt, createdAt);
    return serializeConversation(
      db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId)
    );
  }

  function createConversationFromMessage(text) {
    const trimmed = typeof text === "string" ? text.trim() : "";
    const title = conversationTitleFromText(trimmed);
    return createConversation({ title });
  }

  function listConversations() {
    const rows = db
      .prepare(
        `SELECT c.id, c.title, c.created_at, c.updated_at,
                COUNT(m.id) AS message_count
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         GROUP BY c.id, c.title, c.created_at, c.updated_at
         ORDER BY c.updated_at DESC`
      )
      .all();

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      created_at: row.created_at,
      updatedAt: row.updated_at,
      updated_at: row.updated_at,
      messageCount: Number(row.message_count || 0),
    }));
  }

  function getConversation(conversationId) {
    const row = db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(conversationId);
    if (!row) return null;

    const messages = db
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ?
        ORDER BY created_at ASC, rowid ASC`
      )
      .all(conversationId)
      .map(serializeMessage)
      .filter(Boolean);

    const researchRuns = db
      .prepare(
        `SELECT r.id, r.message_id, r.query, r.created_at, r.metadata
         FROM research_runs r
         WHERE r.conversation_id = ?
         ORDER BY r.created_at ASC`
      )
      .all(conversationId)
      .map((researchRun) => ({
        id: researchRun.id,
        messageId: researchRun.message_id,
        message_id: researchRun.message_id,
        query: researchRun.query,
        createdAt: researchRun.created_at,
        created_at: researchRun.created_at,
        metadata: parseJson(researchRun.metadata, {}),
      }));

    return {
      ...serializeConversation(row),
      messages,
      researchRuns,
    };
  }

  function saveMessage({
    conversationId,
    role,
    content,
    status = "completed",
    evidenceReferences = [],
  }) {
    return runInTransaction(() => {
      ensureConversationExists(conversationId);

      const messageId = randomUUID();
      const createdAt = isoNow();
      const safeRole = normalizeRole(role);
      const safeStatus = normalizeStatus(status);
      const safeContent = String(content ?? "").trim();

      if (!safeContent && safeStatus !== "streaming") {
        const error = new Error("Message content cannot be empty.");
        error.code = "INVALID_MESSAGE";
        throw error;
      }

      db.prepare(
        "INSERT INTO messages (id, conversation_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(messageId, conversationId, safeRole, safeContent, safeStatus, createdAt);

      const normalizedReferences = Array.isArray(evidenceReferences)
        ? evidenceReferences.filter(Boolean)
        : [];

      for (const reference of normalizedReferences) {
        const referenceId = randomUUID();
        const sourceId = Number.isInteger(reference.sourceId) ? reference.sourceId : null;
        const chunkId = Number.isInteger(reference.chunkId) ? reference.chunkId : null;
        db.prepare(
          "INSERT INTO evidence_references (id, conversation_id, message_id, source_id, chunk_id, title, url, snippet, created_at, evidence_id, original_created_at, original_research_turn, reused) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          referenceId,
          conversationId,
          messageId,
          sourceId,
          chunkId,
          typeof reference.title === "string" ? reference.title : null,
          typeof reference.url === "string" ? reference.url : null,
          typeof reference.snippet === "string" ? reference.snippet : null,
          createdAt,
          typeof reference.evidenceId === "string" ? reference.evidenceId : null,
          typeof reference.originalCreatedAt === "string" ? reference.originalCreatedAt : null,
          typeof reference.originalResearchTurn === "string" ? reference.originalResearchTurn : null,
          reference.reused === true ? 1 : 0
        );
      }

      touchConversation(conversationId, createdAt);
      return serializeMessage(
        db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId)
      );
    });
  }

  function saveAssistantMessage({
    conversationId,
    content,
    status = "completed",
    evidenceReferences = [],
  }) {
    return saveMessage({
      conversationId,
      role: "assistant",
      content,
      status,
      evidenceReferences,
    });
  }

  function saveResearchRun({ conversationId, messageId, query, metadata = {} }) {
    return runInTransaction(() => {
      ensureConversationExists(conversationId);
      const runId = randomUUID();
      const createdAt = isoNow();
      const safeQuery = typeof query === "string" ? query.trim() : "";
      if (!safeQuery) {
        const error = new Error("Research query cannot be empty.");
        error.code = "INVALID_RESEARCH_QUERY";
        throw error;
      }

      db.prepare(
        "INSERT INTO research_runs (id, conversation_id, message_id, query, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(runId, conversationId, messageId, safeQuery, createdAt, jsonValue(metadata));

      touchConversation(conversationId, createdAt);
      return {
        id: runId,
        conversationId,
        messageId,
        query: safeQuery,
        createdAt,
        created_at: createdAt,
        metadata: typeof metadata === "object" && metadata ? metadata : {},
      };
    });
  }

  function deleteConversation(conversationId) {
    const existing = db
      .prepare("SELECT id FROM conversations WHERE id = ?")
      .get(conversationId);
    if (!existing) {
      const error = new Error(`Conversation not found: ${conversationId}`);
      error.code = "CONVERSATION_NOT_FOUND";
      throw error;
    }

    db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
    return { id: conversationId, deleted: true };
  }

  function getMessages(conversationId) {
    return getConversationMessages(conversationId);
  }

  function getConversationMessages(
    conversationId,
    { excludeMessageId, completedOnly = false } = {}
  ) {
    ensureConversationExists(conversationId);
    const conditions = ["conversation_id = ?"];
    const parameters = [conversationId];
    if (excludeMessageId) {
      conditions.push("id != ?");
      parameters.push(excludeMessageId);
    }
    if (completedOnly) conditions.push("status = 'completed'");

    return db
      .prepare(
        `SELECT * FROM messages
         WHERE ${conditions.join(" AND ")}
        ORDER BY created_at ASC, rowid ASC`
      )
      .all(...parameters)
      .map(serializeMessage)
      .filter(Boolean);
  }

  function getConversationSummary(conversationId) {
    ensureConversationExists(conversationId);
    const row = db
      .prepare(
        `SELECT summary, summarized_through_message_id, updated_at
         FROM conversation_summaries
         WHERE conversation_id = ?`
      )
      .get(conversationId);
    if (!row) return null;
    return {
      conversationId,
      summary: row.summary,
      summarizedThroughMessageId: row.summarized_through_message_id,
      updatedAt: row.updated_at,
    };
  }

  function updateConversationSummary({
    conversationId,
    summary,
    summarizedThroughMessageId,
  }) {
    ensureConversationExists(conversationId);
    const safeSummary = typeof summary === "string" ? summary.trim() : "";
    if (!safeSummary) {
      const error = new Error("Conversation summary cannot be empty.");
      error.code = "INVALID_CONVERSATION_SUMMARY";
      throw error;
    }
    if (typeof summarizedThroughMessageId !== "string") {
      const error = new Error("Summary boundary message ID is required.");
      error.code = "INVALID_CONVERSATION_SUMMARY";
      throw error;
    }
    const boundary = db
      .prepare(
        "SELECT id FROM messages WHERE id = ? AND conversation_id = ? AND status = 'completed'"
      )
      .get(summarizedThroughMessageId, conversationId);
    if (!boundary) {
      const error = new Error("Summary boundary must be a completed message in this conversation.");
      error.code = "INVALID_CONVERSATION_SUMMARY";
      throw error;
    }

    const updatedAt = isoNow();
    db.prepare(
      `INSERT INTO conversation_summaries
         (conversation_id, summary, summarized_through_message_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         summary = excluded.summary,
         summarized_through_message_id = excluded.summarized_through_message_id,
         updated_at = excluded.updated_at`
    ).run(
      conversationId,
      safeSummary,
      summarizedThroughMessageId,
      updatedAt
    );
    return getConversationSummary(conversationId);
  }

  function getConversationSummaryFailure(conversationId) {
    ensureConversationExists(conversationId);
    const row = db
      .prepare(
        "SELECT failed_at FROM conversation_summary_failures WHERE conversation_id = ?"
      )
      .get(conversationId);
    return row?.failed_at || null;
  }

  function recordConversationSummaryFailure(conversationId) {
    ensureConversationExists(conversationId);
    db.prepare(
      `INSERT INTO conversation_summary_failures (conversation_id, failed_at)
       VALUES (?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET failed_at = excluded.failed_at`
    ).run(conversationId, isoNow());
  }

  function clearConversationSummaryFailure(conversationId) {
    ensureConversationExists(conversationId);
    db.prepare(
      "DELETE FROM conversation_summary_failures WHERE conversation_id = ?"
    ).run(conversationId);
  }

  function updateMessage({
    messageId,
    conversationId,
    content,
    status,
    evidenceReferences,
  }) {
    return runInTransaction(() => {
      ensureConversationExists(conversationId);
      const existing = db
        .prepare(
          "SELECT * FROM messages WHERE id = ? AND conversation_id = ?"
        )
        .get(messageId, conversationId);
      if (!existing) {
        const error = new Error(`Message not found: ${messageId}`);
        error.code = "MESSAGE_NOT_FOUND";
        throw error;
      }

      const safeStatus = normalizeStatus(status ?? existing.status);
      const safeContent =
        content === undefined ? existing.content : String(content).trim();
      if (!safeContent && safeStatus !== "streaming") {
        const error = new Error("Message content cannot be empty.");
        error.code = "INVALID_MESSAGE";
        throw error;
      }
      const updatedAt = isoNow();
      db.prepare(
        "UPDATE messages SET content = ?, status = ? WHERE id = ? AND conversation_id = ?"
      ).run(safeContent, safeStatus, messageId, conversationId);

      if (Array.isArray(evidenceReferences)) {
        db.prepare("DELETE FROM evidence_references WHERE message_id = ?").run(
          messageId
        );
        for (const reference of evidenceReferences.filter(Boolean)) {
          db.prepare(
            "INSERT INTO evidence_references (id, conversation_id, message_id, source_id, chunk_id, title, url, snippet, created_at, evidence_id, original_created_at, original_research_turn, reused) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          ).run(
            randomUUID(),
            conversationId,
            messageId,
            Number.isInteger(reference.sourceId) ? reference.sourceId : null,
            Number.isInteger(reference.chunkId) ? reference.chunkId : null,
            typeof reference.title === "string" ? reference.title : null,
            typeof reference.url === "string" ? reference.url : null,
            typeof reference.snippet === "string" ? reference.snippet : null,
            updatedAt,
            typeof reference.evidenceId === "string" ? reference.evidenceId : null,
            typeof reference.originalCreatedAt === "string" ? reference.originalCreatedAt : null,
            typeof reference.originalResearchTurn === "string" ? reference.originalResearchTurn : null,
            reference.reused === true ? 1 : 0
          );
        }
      }

      touchConversation(conversationId, updatedAt);
      return serializeMessage(
        db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId)
      );
    });
  }

  return {
    db,
    createConversation,
    createConversationFromMessage,
    ensureConversationWithTitle,
    listConversations,
    getConversation,
    getMessages,
    getConversationMessages,
    getConversationSummary,
    updateConversationSummary,
    getConversationSummaryFailure,
    recordConversationSummaryFailure,
    clearConversationSummaryFailure,
    saveMessage,
    saveAssistantMessage,
    updateMessage,
    saveResearchRun,
    deleteConversation,
    touchConversation,
    normalizeStatus,
    normalizeRole,
    close: () => db.close(),
  };
}
