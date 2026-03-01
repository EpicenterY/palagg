import Database from "better-sqlite3";
import { config } from "../config.js";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS printers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      model       TEXT NOT NULL,
      ip          TEXT NOT NULL,
      access_code TEXT NOT NULL,
      serial      TEXT NOT NULL,
      camera_type TEXT NOT NULL DEFAULT 'rtsps',
      status      TEXT NOT NULL DEFAULT 'idle',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id              TEXT PRIMARY KEY,
      printer_id      TEXT NOT NULL REFERENCES printers(id),
      status          TEXT NOT NULL DEFAULT 'created',
      filename        TEXT NOT NULL,
      input_path      TEXT,
      output_path     TEXT,
      slicer_profile  TEXT NOT NULL DEFAULT 'default',
      progress        INTEGER NOT NULL DEFAULT 0,
      error_message   TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_printer ON jobs(printer_id);
  `);
}

export function ensureDefaultPrinter() {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM printers WHERE id = ?").get(config.printer.id);
  if (!existing) {
    db.prepare(`
      INSERT INTO printers (id, name, model, ip, access_code, serial, camera_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      config.printer.id,
      config.printer.name,
      config.printer.model,
      config.printer.ip,
      config.printer.accessCode,
      config.printer.serial,
      config.printer.cameraType,
    );
  }
}
