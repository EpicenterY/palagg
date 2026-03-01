import { getDb } from "./schema.js";
import type { Job, JobStatus } from "@palagg/shared";

export function createJob(
  id: string,
  printerId: string,
  filename: string,
  inputPath: string,
  profile: string,
): Job {
  const db = getDb();
  db.prepare(`
    INSERT INTO jobs (id, printer_id, status, filename, input_path, slicer_profile)
    VALUES (?, ?, 'created', ?, ?, ?)
  `).run(id, printerId, filename, inputPath, profile);
  return getJob(id)!;
}

export function getJob(id: string): Job | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
}

export function listJobs(status?: JobStatus, limit = 50): Job[] {
  const db = getDb();
  if (status) {
    return db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?")
      .all(status, limit) as Job[];
  }
  return db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Job[];
}

export function updateJobStatus(
  id: string,
  status: JobStatus,
  extra?: { progress?: number; error_message?: string; output_path?: string },
): Job | undefined {
  const db = getDb();
  const sets = ["status = ?", "updated_at = datetime('now')"];
  const params: unknown[] = [status];

  if (extra?.progress !== undefined) {
    sets.push("progress = ?");
    params.push(extra.progress);
  }
  if (extra?.error_message !== undefined) {
    sets.push("error_message = ?");
    params.push(extra.error_message);
  }
  if (extra?.output_path !== undefined) {
    sets.push("output_path = ?");
    params.push(extra.output_path);
  }

  params.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getJob(id);
}

export function deleteJob(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM jobs WHERE id = ? AND status NOT IN ('printing')").run(id);
  return result.changes > 0;
}
