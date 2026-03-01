import type { FastifyInstance } from "fastify";
import mqtt from "mqtt";
import { listPrinters, getPrinter, updatePrinter, getPrinterWithCredentials } from "../db/printers.js";

export async function printerRoutes(app: FastifyInstance) {
  // GET /api/printers
  app.get("/api/printers", async (_req, reply) => {
    const printers = listPrinters();
    return reply.send({ printers });
  });

  // GET /api/printers/:id
  app.get("/api/printers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const printer = getPrinter(id);
    if (!printer) return reply.code(404).send({ error: "Printer not found" });
    return reply.send({ printer });
  });

  // POST /api/printers/:id/cmd
  app.post("/api/printers/:id/cmd", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { command: string };
    const printer = getPrinter(id);
    if (!printer) return reply.code(404).send({ error: "Printer not found" });

    const validCommands = ["pause", "resume", "stop"];
    if (!validCommands.includes(body.command)) {
      return reply.code(400).send({ error: `Invalid command. Must be one of: ${validCommands.join(", ")}` });
    }

    // TODO: Send MQTT command to printer via PrinterMqttService
    app.log.info({ printerId: id, command: body.command }, "Printer command received (not yet implemented)");

    return reply.send({ success: true, message: `Command '${body.command}' queued` });
  });

  // PATCH /api/printers/:id — update printer settings
  app.patch("/api/printers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; ip?: string; access_code?: string; serial?: string };

    const existing = getPrinter(id);
    if (!existing) return reply.code(404).send({ error: "Printer not found" });

    const updated = updatePrinter(id, body);
    return reply.send({ printer: updated });
  });

  // POST /api/printers/:id/test — test MQTT connection to printer
  app.post("/api/printers/:id/test", async (req, reply) => {
    const { id } = req.params as { id: string };
    const printer = getPrinterWithCredentials(id);
    if (!printer) return reply.code(404).send({ error: "Printer not found" });

    if (!printer.ip || printer.ip === "192.168.0.0") {
      return reply.send({ success: false, message: "프린터 IP가 설정되지 않았습니다" });
    }

    try {
      const result = await new Promise<{ success: boolean; message: string }>((resolve) => {
        const timeout = setTimeout(() => {
          testClient.end(true);
          resolve({ success: false, message: "연결 시간 초과 (5초)" });
        }, 5000);

        const testClient = mqtt.connect(`mqtts://${printer.ip}:8883`, {
          username: "bblp",
          password: printer.access_code,
          rejectUnauthorized: false,
          protocolVersion: 4,
          connectTimeout: 5000,
        });

        testClient.on("connect", () => {
          clearTimeout(timeout);
          testClient.end();
          resolve({ success: true, message: "연결 성공" });
        });

        testClient.on("error", (err) => {
          clearTimeout(timeout);
          testClient.end(true);
          resolve({ success: false, message: `연결 실패: ${err.message}` });
        });
      });

      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.send({ success: false, message: `오류: ${msg}` });
    }
  });
}
