import { getDb } from "./schema.js";
import type { Printer, PrinterStatus } from "@palagg/shared";

export function getPrinter(id: string): Printer | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM printers WHERE id = ?").get(id) as
    | (Printer & { access_code: string })
    | undefined;
  if (!row) return undefined;
  // Strip access_code from the response
  const { access_code: _, ...printer } = row;
  return printer as Printer;
}

export function listPrinters(): Printer[] {
  const db = getDb();
  return (db.prepare("SELECT id, name, model, ip, serial, dev_id, camera_type, status, created_at FROM printers").all()) as Printer[];
}

export function updatePrinterStatus(id: string, status: PrinterStatus) {
  const db = getDb();
  db.prepare("UPDATE printers SET status = ? WHERE id = ?").run(status, id);
}

export function getPrinterWithCredentials(id: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM printers WHERE id = ?").get(id) as
    | (Printer & { access_code: string })
    | undefined;
}
