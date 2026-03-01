import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { createProject, notifyUploadComplete, patchProject } from "./bambu-cloud-auth.js";
import type { CloudUploadResult } from "@palagg/shared";

/**
 * Upload a sliced file to Bambu Cloud via project-based flow:
 * 1. Create project → get pre-signed upload URL + ticket
 * 2. PUT file to S3 URL
 * 3. Notify Bambu Cloud that upload is complete
 * 4. Patch the project to associate the uploaded file
 */
export async function uploadToCloud(localPath: string): Promise<CloudUploadResult> {
  const filename = basename(localPath);
  const fileBuffer = await readFile(localPath);
  const fileSize = (await stat(localPath)).size;

  // Compute MD5 hash
  const md5 = createHash("md5").update(fileBuffer).digest("hex");

  // Step 1: Create project and get upload URL
  const { projectId, modelId, profileId, uploadUrl, uploadTicket } = await createProject(filename);
  console.log(`[CloudUpload] Created project ${projectId} for ${filename}`);

  // Step 2: Upload file to S3 pre-signed URL
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: fileBuffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cloud upload failed (${res.status}): ${text}`);
  }

  console.log(`[CloudUpload] Uploaded ${filename} (${fileSize} bytes, md5: ${md5})`);

  // Step 3: Notify Bambu Cloud that upload is complete
  await notifyUploadComplete(uploadTicket);

  // Step 4: Patch the project to associate the uploaded file
  await patchProject(projectId, modelId, profileId);

  // The cloud file URL is the upload URL without query params
  const cloudFileUrl = uploadUrl.split("?")[0];

  return { url: cloudFileUrl, md5, projectId, modelId, profileId };
}
