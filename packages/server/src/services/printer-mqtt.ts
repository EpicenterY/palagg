import mqtt from "mqtt";
import type { Printer } from "@palagg/shared";
import { config } from "../config.js";
import { updatePrinterStatus, getPrinterWithCredentials } from "../db/printers.js";
import { broadcast } from "../ws/jobs.js";
import { getCloudCredentials } from "./bambu-cloud-auth.js";

let client: mqtt.MqttClient | null = null;
let currentPrinter: (Printer & { access_code: string }) | null = null;

export async function connectMqtt(printerId: string): Promise<void> {
  const printer = getPrinterWithCredentials(printerId);
  if (!printer) throw new Error(`Printer ${printerId} not found`);

  currentPrinter = printer;

  let brokerUrl: string;
  let username: string;
  let password: string;

  if (config.connectionMode === "cloud") {
    // Cloud mode: connect to Bambu Cloud MQTT broker
    const creds = await getCloudCredentials();
    brokerUrl = `mqtts://${creds.broker}:${creds.port}`;
    username = creds.username;
    password = creds.password;
  } else {
    // LAN mode: connect directly to printer
    brokerUrl = `mqtts://${printer.ip}:8883`;
    username = "bblp";
    password = printer.access_code;
  }

  client = mqtt.connect(brokerUrl, {
    username,
    password,
    rejectUnauthorized: false,
    protocolVersion: 4,
  });

  client.on("connect", () => {
    const target = config.connectionMode === "cloud" ? config.cloud.mqttBroker : printer.ip;
    console.log(`[MQTT] Connected to ${target} (${config.connectionMode} mode)`);
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
      const print = msg.print as Record<string, unknown> | undefined;
      if (print) {
        const state = print.gcode_state ?? "";
        const pct = print.mc_percent ?? "";
        const err = print.print_error ?? print.error ?? "";
        const result = print.result ?? "";
        console.log(`[MQTT] Report: gcode_state=${state}, mc_percent=${pct}, error=${err}, result=${result}`);
      }
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
    const target = config.connectionMode === "cloud" ? config.cloud.mqttBroker : printer.ip;
    console.log(`[MQTT] Disconnected from ${target}`);
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

export interface PrintCommandOptions {
  filename: string;
  cloudUrl?: string;
  md5?: string;
  projectId?: string;
  profileId?: string;
  taskId?: string;
  subtaskId?: string;
}

export function sendPrintCommand(options: PrintCommandOptions): void {
  if (!client || !currentPrinter) throw new Error("MQTT not connected");

  const { filename, cloudUrl, md5, projectId, profileId, taskId, subtaskId } = options;
  let payload: Record<string, unknown>;

  if (config.connectionMode === "cloud" && cloudUrl) {
    // Cloud mode: project_file command with cloud URL and task IDs
    payload = {
      print: {
        sequence_id: "0",
        command: "project_file",
        param: "Metadata/plate_1.gcode",
        project_id: projectId ?? "0",
        profile_id: profileId ?? "0",
        task_id: taskId ?? "0",
        subtask_id: subtaskId ?? "0",
        subtask_name: filename.replace(/\.[^/.]+$/, ""),
        file: "",
        url: cloudUrl,
        md5,
        timelapse: false,
        bed_type: "auto",
        bed_levelling: true,
        flow_cali: true,
        vibration_cali: true,
        layer_inspect: false,
        ams_mapping: [],
        use_ams: false,
      },
    };
  } else {
    // LAN mode: gcode_file command with FTP path
    payload = {
      print: {
        sequence_id: "0",
        command: "project_file",
        param: "Metadata/plate_1.gcode",
        project_id: "0",
        profile_id: "0",
        task_id: "0",
        subtask_id: "0",
        subtask_name: filename.replace(/\.[^/.]+$/, ""),
        file: filename,
        url: `ftp:///cache/${filename}`,
        md5: "",
        timelapse: false,
        bed_type: "auto",
        bed_levelling: true,
        flow_cali: true,
        vibration_cali: true,
        layer_inspect: false,
        ams_mapping: [],
        use_ams: false,
      },
    };
  }

  const topic = `device/${currentPrinter.serial}/request`;
  const payloadStr = JSON.stringify(payload);
  console.log(`[MQTT] Publishing to ${topic}:`, payloadStr.slice(0, 300));
  client.publish(topic, payloadStr);
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
