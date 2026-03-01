import mqtt from "mqtt";
import type { Printer} from "@palagg/shared";
import { updatePrinterStatus, getPrinterWithCredentials } from "../db/printers.js";
import { broadcast } from "../ws/jobs.js";

let client: mqtt.MqttClient | null = null;
let currentPrinter: (Printer & { access_code: string }) | null = null;

export function connectMqtt(printerId: string): void {
  const printer = getPrinterWithCredentials(printerId);
  if (!printer) throw new Error(`Printer ${printerId} not found`);

  currentPrinter = printer;

  client = mqtt.connect(`mqtts://${printer.ip}:8883`, {
    username: "bblp",
    password: printer.access_code,
    rejectUnauthorized: false,
    protocolVersion: 4,
  });

  client.on("connect", () => {
    console.log(`[MQTT] Connected to ${printer.ip}`);
    client!.subscribe(`device/${printer.serial}/report`);
    updatePrinterStatus(printerId, "idle");
    broadcast({ type: "printer:status", printerId, status: "idle" });

    // Request full status
    client!.publish(`device/${printer.serial}/request`, JSON.stringify({
      pushing: { sequence_id: "0", command: "pushall" },
    }));
  });

  client.on("message", (_topic, payload) => {
    try {
      const msg = JSON.parse(payload.toString());
      handlePrinterReport(printerId, msg);
    } catch {
      // ignore malformed messages
    }
  });

  client.on("error", (err) => {
    console.error(`[MQTT] Error:`, err.message);
    updatePrinterStatus(printerId, "error");
    broadcast({ type: "printer:status", printerId, status: "error" });
  });

  client.on("close", () => {
    console.log(`[MQTT] Disconnected from ${printer.ip}`);
    updatePrinterStatus(printerId, "offline");
    broadcast({ type: "printer:status", printerId, status: "offline" });
  });
}

function handlePrinterReport(printerId: string, msg: Record<string, unknown>) {
  const print = msg.print as Record<string, unknown> | undefined;
  if (!print) return;

  const gcodeState = print.gcode_state as string | undefined;
  if (gcodeState) {
    let status: "idle" | "printing" | "paused" | "error" = "idle";
    if (gcodeState === "RUNNING") status = "printing";
    else if (gcodeState === "PAUSE") status = "paused";
    else if (gcodeState === "FAILED") status = "error";
    else if (gcodeState === "IDLE" || gcodeState === "FINISH") status = "idle";

    updatePrinterStatus(printerId, status);
    broadcast({ type: "printer:status", printerId, status });
  }
}

export function sendPrintCommand(filename: string): void {
  if (!client || !currentPrinter) throw new Error("MQTT not connected");

  client.publish(`device/${currentPrinter.serial}/request`, JSON.stringify({
    print: {
      sequence_id: "0",
      command: "gcode_file",
      param: `ftp:///cache/${filename}`,
      subtask_name: filename.replace(/\.[^/.]+$/, ""),
    },
  }));
}

export function sendCommand(command: "pause" | "resume" | "stop"): void {
  if (!client || !currentPrinter) throw new Error("MQTT not connected");

  const mqttCommand = command === "stop" ? "print.stop"
    : command === "pause" ? "print.pause"
    : "print.resume";

  client.publish(`device/${currentPrinter.serial}/request`, JSON.stringify({
    print: { sequence_id: "0", command: mqttCommand },
  }));
}

export function disconnectMqtt(): void {
  client?.end();
  client = null;
  currentPrinter = null;
}
