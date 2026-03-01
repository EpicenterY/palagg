import { listJobs, updateJobStatus } from "../db/jobs.js";
import { broadcast } from "../ws/jobs.js";
import { sliceJob, isSlicerBusy } from "./slicer.js";
import { uploadSlicedFile, type UploadResult } from "./printer-upload.js";
import { sendPrintCommand } from "./printer-mqtt.js";
import { createTask } from "./bambu-cloud-auth.js";
import { config } from "../config.js";
import { getPrinterWithCredentials } from "../db/printers.js";
import { basename } from "node:path";

let timer: ReturnType<typeof setInterval> | null = null;

/** Cache upload results so processPendingPrint can access cloud URL/MD5 */
const uploadCache = new Map<string, UploadResult>();

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
    const result = await uploadSlicedFile(job.printer_id, job.output_path, remoteFilename);

    // Cache result for use in processPendingPrint
    uploadCache.set(job.id, result);

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
    const cached = uploadCache.get(job.id);

    let taskId: string | undefined;
    let subtaskId: string | undefined;

    // In cloud mode, try to create a task before sending the MQTT print command
    if (config.connectionMode === "cloud" && cached?.projectId && cached.modelId && cached.profileId) {
      const printer = getPrinterWithCredentials(job.printer_id);
      const deviceId = printer?.dev_id || printer?.serial || "";
      try {
        const result = await createTask({
          projectId: cached.projectId,
          modelId: cached.modelId,
          profileId: cached.profileId,
          deviceId,
          title: job.filename,
        });
        taskId = result.taskId;
        subtaskId = result.subtaskId;
      } catch (err) {
        // Task creation may fail — continue with MQTT command using project IDs only
        console.warn(`[Orchestrator] Task creation failed, proceeding with project IDs:`, err instanceof Error ? err.message : err);
      }
    }

    sendPrintCommand({
      filename: remoteFilename,
      cloudUrl: cached?.cloudUrl,
      md5: cached?.md5,
      projectId: cached?.projectId,
      profileId: cached?.profileId,
      taskId,
      subtaskId,
    });

    // Clean up cache entry
    uploadCache.delete(job.id);

    updateJobStatus(job.id, "printing");
    broadcast({ type: "job:status", jobId: job.id, status: "printing", progress: 0, updatedAt: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateJobStatus(job.id, "print_failed", { error_message: msg });
    broadcast({ type: "job:status", jobId: job.id, status: "print_failed", progress: 0, updatedAt: new Date().toISOString() });
  }
}
