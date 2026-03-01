import "dotenv/config";
import { resolve } from "node:path";

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing env: ${key}`);
  return val;
}

export const config = {
  port: parseInt(env("PORT", "3000"), 10),
  host: env("HOST", "0.0.0.0"),
  corsOrigin: env("CORS_ORIGIN", "http://localhost:5173").split(","),

  dataDir: env("DATA_DIR", resolve("C:/palagg-data")),
  get uploadsDir() { return resolve(this.dataDir, "uploads"); },
  get slicedDir() { return resolve(this.dataDir, "sliced"); },
  get dbPath() { return resolve(this.dataDir, "jobs.db"); },

  slicerPath: env("SLICER_PATH", "C:/Program Files/Bambu Studio/bambu-studio.exe"),

  printer: {
    id: env("PRINTER_ID", "bambu_x1c_01"),
    name: env("PRINTER_NAME", "Bambu X1C"),
    model: env("PRINTER_MODEL", "X1C"),
    ip: env("PRINTER_IP", "192.168.1.100"),
    accessCode: env("PRINTER_ACCESS_CODE", ""),
    serial: env("PRINTER_SERIAL", ""),
    cameraType: env("PRINTER_CAMERA_TYPE", "rtsps") as "rtsps" | "tcp_jpeg",
  },
} as const;
