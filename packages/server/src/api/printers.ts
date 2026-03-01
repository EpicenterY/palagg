import type { FastifyInstance } from "fastify";
import { listPrinters, getPrinter } from "../db/printers.js";

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
}
