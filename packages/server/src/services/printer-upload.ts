import { config } from "../config.js";
import { uploadToPrinter } from "./printer-ftp.js";
import { uploadToCloud } from "./cloud-upload.js";

export interface UploadResult {
  /** Cloud URL (only set in cloud mode) */
  cloudUrl?: string;
  /** File MD5 hash (only set in cloud mode) */
  md5?: string;
  /** Cloud project ID (only set in cloud mode) */
  projectId?: string;
  /** Cloud model ID (only set in cloud mode) */
  modelId?: string;
  /** Cloud profile ID (only set in cloud mode) */
  profileId?: string;
  /** The remote filename */
  remoteFilename: string;
}

/**
 * Upload a sliced file to the printer.
 * Routes to Cloud (S3) or LAN (FTPS) based on connectionMode.
 */
export async function uploadSlicedFile(
  printerId: string,
  localPath: string,
  remoteFilename: string,
): Promise<UploadResult> {
  if (config.connectionMode === "cloud") {
    const result = await uploadToCloud(localPath);
    return {
      cloudUrl: result.url,
      md5: result.md5,
      projectId: result.projectId,
      modelId: result.modelId,
      profileId: result.profileId,
      remoteFilename,
    };
  } else {
    await uploadToPrinter(printerId, localPath, remoteFilename);
    return { remoteFilename };
  }
}
