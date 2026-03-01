// Job status lifecycle
export type JobStatus =
  | "created"
  | "pending_slice"
  | "slicing"
  | "slice_failed"
  | "pending_upload"
  | "uploading"
  | "upload_failed"
  | "pending_print"
  | "printing"
  | "print_failed"
  | "completed"
  | "cancelled";

export type PrinterStatus = "idle" | "printing" | "paused" | "error" | "offline";

export type CameraType = "rtsps" | "tcp_jpeg";

export interface Job {
  id: string;
  printer_id: string;
  status: JobStatus;
  filename: string;
  input_path: string | null;
  output_path: string | null;
  slicer_profile: string;
  progress: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Printer {
  id: string;
  name: string;
  model: string;
  ip: string;
  serial: string;
  camera_type: CameraType;
  status: PrinterStatus;
  created_at: string;
}

// REST API request/response types
export interface CreateJobRequest {
  printer_id: string;
  profile?: string;
}

export interface CreateJobResponse {
  job: Job;
}

export interface PrinterCommand {
  command: "pause" | "resume" | "stop";
}

// WebSocket message types
export type WsMessage =
  | { type: "job:created"; job: Job }
  | { type: "job:status"; jobId: string; status: JobStatus; progress: number; updatedAt: string }
  | { type: "printer:status"; printerId: string; status: PrinterStatus }
  | { type: "error"; message: string };
