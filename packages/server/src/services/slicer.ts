import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../config.js";
import { updateJobStatus } from "../db/jobs.js";
import { broadcast } from "../ws/jobs.js";
import type { Job } from "@palagg/shared";

let busy = false;

export function isSlicerBusy(): boolean {
  return busy;
}

export async function sliceJob(job: Job): Promise<void> {
  if (busy) throw new Error("Slicer is busy");
  busy = true;

  try {
    updateJobStatus(job.id, "slicing", { progress: 0 });
    broadcast({ type: "job:status", jobId: job.id, status: "slicing", progress: 0, updatedAt: new Date().toISOString() });

    await mkdir(config.slicedDir, { recursive: true });
    const outputPath = resolve(config.slicedDir, `${job.id}.gcode.3mf`);

    await new Promise<void>((res, rej) => {
      const proc = spawn(config.slicerPath, [
        "--slice", "0",
        "--export-3mf", outputPath,
        job.input_path!,
      ], { stdio: ["ignore", "pipe", "pipe"] });

      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        // Try to parse progress from stdout
        const match = text.match(/(\d+)%/);
        if (match) {
          const progress = parseInt(match[1], 10);
          updateJobStatus(job.id, "slicing", { progress });
          broadcast({ type: "job:status", jobId: job.id, status: "slicing", progress, updatedAt: new Date().toISOString() });
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          updateJobStatus(job.id, "pending_upload", { progress: 100, output_path: outputPath });
          broadcast({ type: "job:status", jobId: job.id, status: "pending_upload", progress: 100, updatedAt: new Date().toISOString() });
          res();
        } else {
          const msg = stderr.trim() || `Slicer exited with code ${code}`;
          updateJobStatus(job.id, "slice_failed", { error_message: msg });
          broadcast({ type: "job:status", jobId: job.id, status: "slice_failed", progress: 0, updatedAt: new Date().toISOString() });
          rej(new Error(msg));
        }
      });

      proc.on("error", (err) => {
        updateJobStatus(job.id, "slice_failed", { error_message: err.message });
        broadcast({ type: "job:status", jobId: job.id, status: "slice_failed", progress: 0, updatedAt: new Date().toISOString() });
        rej(err);
      });
    });
  } finally {
    busy = false;
  }
}
