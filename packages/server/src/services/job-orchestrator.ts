import { listJobs, updateJobStatus } from "../db/jobs.js";
import { broadcast } from "../ws/jobs.js";
import { sliceJob, isSlicerBusy } from "./slicer.js";
import { uploadToPrinter } from "./printer-ftp.js";
import { sendPrintCommand } from "./printer-mqtt.js";
import { basename } from "node:path";

let timer: ReturnType<typeof setInterval> | null = null;

export function startOrchestrator() {
  if (timer) return;
  timer = setInterval(tick, 1000);
  console.log("[Orchestrator] Started (1s interval)");
}

export function stopOrchestrator() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick() {
  try {
    await processPendingSlice();
    await processPendingUpload();
    await processPendingPrint();
  } catch (err) {
    console.error("[Orchestrator] tick error:", err);
  }
}

async function processPendingSlice() {
  if (isSlicerBusy()) return;

  const jobs = listJobs("pending_slice" as const, 1);
  if (jobs.length === 0) return;

  const job = jobs[0];
  console.log(`[Orchestrator] Slicing job ${job.id}`);

  try {
    await sliceJob(job);
  } catch (err) {
    console.error(`[Orchestrator] Slice failed for ${job.id}:`, err);
  }
}

async function processPendingUpload() {
  const jobs = listJobs("pending_upload" as const, 1);
  if (jobs.length === 0) return;

  const job = jobs[0];
  if (!job.output_path) {
    updateJobStatus(job.id, "upload_failed", { error_message: "No output file" });
    return;
  }

  console.log(`[Orchestrator] Uploading job ${job.id}`);
  updateJobStatus(job.id, "uploading");
  broadcast({ type: "job:status", jobId: job.id, status: "uploading", progress: 100, updatedAt: new Date().toISOString() });

  try {
    const remoteFilename = basename(job.output_path);
    await uploadToPrinter(job.printer_id, job.output_path, remoteFilename);

    updateJobStatus(job.id, "pending_print");
    broadcast({ type: "job:status", jobId: job.id, status: "pending_print", progress: 100, updatedAt: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateJobStatus(job.id, "upload_failed", { error_message: msg });
    broadcast({ type: "job:status", jobId: job.id, status: "upload_failed", progress: 0, updatedAt: new Date().toISOString() });
  }
}

async function processPendingPrint() {
  const jobs = listJobs("pending_print" as const, 1);
  if (jobs.length === 0) return;

  const job = jobs[0];
  if (!job.output_path) return;

  console.log(`[Orchestrator] Sending print command for job ${job.id}`);

  try {
    const remoteFilename = basename(job.output_path);
    sendPrintCommand(remoteFilename);

    updateJobStatus(job.id, "printing");
    broadcast({ type: "job:status", jobId: job.id, status: "printing", progress: 0, updatedAt: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateJobStatus(job.id, "print_failed", { error_message: msg });
    broadcast({ type: "job:status", jobId: job.id, status: "print_failed", progress: 0, updatedAt: new Date().toISOString() });
  }
}
