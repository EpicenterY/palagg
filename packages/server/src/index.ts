import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { ensureDefaultPrinter } from "./db/schema.js";
import { jobRoutes } from "./api/jobs.js";
import { printerRoutes } from "./api/printers.js";
import { jobWsRoutes } from "./ws/jobs.js";
import { cameraWsRoutes } from "./ws/camera.js";
import { startOrchestrator, stopOrchestrator } from "./services/job-orchestrator.js";
import { connectMqtt, disconnectMqtt } from "./services/printer-mqtt.js";
import { mkdir } from "node:fs/promises";

async function main() {
  // Ensure data directories exist
  await mkdir(config.uploadsDir, { recursive: true });
  await mkdir(config.slicedDir, { recursive: true });

  // Initialize database and default printer
  ensureDefaultPrinter();

  const app = Fastify({ logger: true });

  // Plugins
  await app.register(cors, { origin: config.corsOrigin });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max
  await app.register(websocket);

  // Routes
  await app.register(jobRoutes);
  await app.register(printerRoutes);
  await app.register(jobWsRoutes);
  await app.register(cameraWsRoutes);

  // Health check
  app.get("/api/health", async () => ({ status: "ok", mode: config.connectionMode }));

  // Start
  await app.listen({ port: config.port, host: config.host });

  // Connect to printer MQTT
  if (config.connectionMode === "cloud") {
    // Cloud mode: need access token or email/password
    if (config.cloud.accessToken || (config.cloud.email && config.cloud.password)) {
      try {
        await connectMqtt(config.printer.id);
      } catch (err) {
        app.log.warn({ err }, "Failed to connect Cloud MQTT - printer features disabled");
      }
    } else {
      app.log.warn("Cloud mode requires BAMBU_ACCESS_TOKEN or BAMBU_EMAIL+BAMBU_PASSWORD");
    }
  } else {
    // LAN mode: need access code and serial
    if (config.printer.accessCode && config.printer.serial) {
      try {
        await connectMqtt(config.printer.id);
      } catch (err) {
        app.log.warn({ err }, "Failed to connect LAN MQTT - printer features disabled");
      }
    } else {
      app.log.warn("LAN mode requires PRINTER_ACCESS_CODE and PRINTER_SERIAL");
    }
  }

  // Start job orchestrator
  startOrchestrator();

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    stopOrchestrator();
    disconnectMqtt();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
