import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { config } from "../config.js";
import { createJob, getJob, listJobs, updateJobStatus, deleteJob } from "../db/jobs.js";
import { broadcast } from "../ws/jobs.js";
import type { JobStatus } from "@palagg/shared";

export async function jobRoutes(app: FastifyInstance) {
  // POST /api/jobs - Submit a new print job (multipart 3MF upload)
  app.post("/api/jobs", async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    const fields = data.fields as Record<string, { value?: string }>;
    const printerId = fields["printer_id"]?.value ?? config.printer.id;
    const profile = fields["profile"]?.value ?? "default";

    const id = randomUUID();
    const filename = data.filename || `${id}.3mf`;

    // Save uploaded file
    await mkdir(config.uploadsDir, { recursive: true });
    const inputPath = resolve(config.uploadsDir, `${id}.3mf`);
    await pipeline(data.file, createWriteStream(inputPath));

    // Create job record and transition to pending_slice
    createJob(id, printerId, filename, inputPath, profile);
    const updated = updateJobStatus(id, "pending_slice")!;
    broadcast({ type: "job:created", job: updated });

    return reply.code(201).send({ job: updated });
  });

  // GET /api/jobs
  app.get("/api/jobs", async (req, reply) => {
    const query = req.query as { status?: string; limit?: string };
    const jobs = listJobs(
      query.status as JobStatus | undefined,
      query.limit ? parseInt(query.limit, 10) : 50,
    );
    return reply.send({ jobs });
  });

  // GET /api/jobs/:id
  app.get("/api/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    return reply.send({ job });
  });

  // DELETE /api/jobs/:id
  app.delete("/api/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = deleteJob(id);
    if (!deleted) {
      return reply.code(400).send({ error: "Cannot delete job (not found or currently printing)" });
    }
    return reply.send({ success: true });
  });
}
