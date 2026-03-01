import { config } from "../config.js";

const API = config.cloud.apiBase;

interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

interface UserPreference {
  uid: string;
}

interface BoundDevice {
  dev_id: string;
  name: string;
  dev_model_name: string;
  dev_access_code: string;
  dev_connection_type: string;
  nozzle_diameter: number;
}

interface ProjectResponse {
  project_id: string;
  model_id: string;
  profile_id: string;
  upload_url: string;
  upload_ticket: string;
}

interface TaskResponse {
  id: string;
  status: string;
  subtask_id?: string;
}

let cachedToken: string | null = null;
let cachedUid: string | null = null;

/**
 * Log in to Bambu Cloud with email/password.
 * Returns an access token.
 */
export async function login(): Promise<string> {
  const { email, password } = config.cloud;
  if (!email || !password) {
    throw new Error("BAMBU_EMAIL and BAMBU_PASSWORD are required for cloud login");
  }

  const res = await fetch(`${API}/v1/user-service/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bambu Cloud login failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as LoginResponse;
  cachedToken = data.accessToken;
  return data.accessToken;
}

/**
 * Get the user's UID from Bambu Cloud.
 * The MQTT username is `u_{uid}`.
 */
export async function getUid(): Promise<string> {
  if (cachedUid) return cachedUid;

  const token = await ensureAuth();
  const res = await fetch(`${API}/v1/design-user-service/my/preference`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to get user preference (${res.status})`);
  }

  const data = (await res.json()) as UserPreference;
  cachedUid = data.uid;
  return data.uid;
}

/**
 * Get the list of printers bound to the user's Bambu Cloud account.
 */
export async function getDevices(): Promise<BoundDevice[]> {
  const token = await ensureAuth();
  const res = await fetch(`${API}/v1/iot-service/api/user/bind`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to get bound devices (${res.status})`);
  }

  const data = (await res.json()) as { devices: BoundDevice[] };
  return data.devices ?? [];
}

/**
 * Ensure we have a valid access token.
 * Prefers BAMBU_ACCESS_TOKEN env var, falls back to email/password login.
 */
export async function ensureAuth(): Promise<string> {
  // 1. Use the pre-configured access token if available
  if (config.cloud.accessToken) {
    cachedToken = config.cloud.accessToken;
    return cachedToken;
  }

  // 2. Use cached token if available
  if (cachedToken) return cachedToken;

  // 3. Login with email/password
  return login();
}

/**
 * Get MQTT connection credentials for Cloud mode.
 */
export async function getCloudCredentials(): Promise<{
  broker: string;
  port: number;
  username: string;
  password: string;
}> {
  const [token, uid] = await Promise.all([ensureAuth(), getUid()]);
  return {
    broker: config.cloud.mqttBroker,
    port: 8883,
    username: `u_${uid}`,
    password: token,
  };
}

/**
 * Create a project on Bambu Cloud and get the pre-signed upload URL.
 * This is the correct flow: create project → get upload_url + upload_ticket.
 */
export async function createProject(
  filename: string,
): Promise<{ projectId: string; modelId: string; profileId: string; uploadUrl: string; uploadTicket: string }> {
  const token = await ensureAuth();
  const res = await fetch(`${API}/v1/iot-service/api/user/project`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: filename }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create cloud project (${res.status}): ${text}`);
  }

  const data = (await res.json()) as ProjectResponse;

  if (!data.upload_url) {
    throw new Error("No upload_url in project response");
  }

  console.log(`[CloudAuth] Project response:`, JSON.stringify(data));

  return {
    projectId: data.project_id,
    modelId: data.model_id,
    profileId: data.profile_id,
    uploadUrl: data.upload_url,
    uploadTicket: data.upload_ticket,
  };
}

/**
 * Create a print task on Bambu Cloud.
 * This is required before sending the MQTT project_file command in cloud mode.
 */
export async function createTask(params: {
  projectId: string;
  modelId: string;
  profileId: string;
  deviceId: string;
  title: string;
}): Promise<{ taskId: string; subtaskId: string }> {
  const token = await ensureAuth();
  const reqBody = {
    designId: 0,
    modelId: params.modelId,
    title: params.title,
    cover: "https://public-cdn.bblmw.com/default-cover.png",
    profileId: parseInt(params.profileId, 10) || params.profileId,
    plateIndex: 1,
    deviceId: params.deviceId,
    amsDetailMapping: [],
    mode: "cloud_file",
    bedType: "auto",
  };
  console.log(`[CloudAuth] Task request body:`, JSON.stringify(reqBody));
  const res = await fetch(`${API}/v1/user-service/my/task`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reqBody),
  });

  const resText = await res.text();
  console.log(`[CloudAuth] Task API response (${res.status}):`, resText);

  if (!res.ok) {
    throw new Error(`Failed to create cloud task (${res.status}): ${resText}`);
  }

  const data = JSON.parse(resText) as TaskResponse;
  console.log(`[CloudAuth] Task response parsed:`, JSON.stringify(data));

  return {
    taskId: data.id,
    subtaskId: data.subtask_id ?? data.id,
  };
}

/**
 * Notify Bambu Cloud that an upload is complete.
 * Uses PUT with { upload: { origin_file_name, ticket } } body format.
 * The ticket format uses underscores from API, notification key uses colons.
 */
export async function notifyUploadComplete(uploadTicket: string, filename: string): Promise<void> {
  const token = await ensureAuth();
  const notificationKey = uploadTicket.replace(/_/g, ":");

  // Step 1: PUT notification to signal upload is complete
  const putRes = await fetch(`${API}/v1/iot-service/api/user/notification`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      upload: {
        origin_file_name: filename,
        ticket: notificationKey,
      },
    }),
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`Upload notification PUT failed (${putRes.status}): ${text}`);
  }
  console.log(`[CloudAuth] Upload notification PUT succeeded`);

  // Step 2: Poll GET notification until server finishes processing the 3MF
  const maxPolls = 30;
  for (let i = 0; i < maxPolls; i++) {
    const getRes = await fetch(
      `${API}/v1/iot-service/api/user/notification?action=upload&ticket=${encodeURIComponent(notificationKey)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (getRes.ok) {
      const data = await getRes.json() as { message?: string };
      console.log(`[CloudAuth] Notification poll ${i + 1}: ${data.message}`);
      if (data.message === "success") {
        console.log(`[CloudAuth] Server finished processing upload`);
        return;
      }
      // "running" means still processing, continue polling
    } else {
      const text = await getRes.text();
      console.warn(`[CloudAuth] Notification poll ${i + 1} failed (${getRes.status}): ${text}`);
      // If server says "Unzip 3mf exception", the file is invalid
      if (text.includes("Unzip 3mf exception")) {
        throw new Error("Server failed to process 3MF file (unzip exception)");
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  console.warn(`[CloudAuth] Notification polling timed out after ${maxPolls} attempts`);
}

/**
 * Patch a project after upload to associate the uploaded file with the model.
 * This is step 8 of the cloud print flow (PATCH_PROJECT).
 */
export async function patchProject(projectId: string, modelId: string, profileId: string): Promise<void> {
  const token = await ensureAuth();
  const res = await fetch(`${API}/v1/iot-service/api/user/project/${projectId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: modelId,
      profile_id: profileId,
      status: "ACTIVE",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`[CloudAuth] Patch project failed (${res.status}): ${text}`);
  } else {
    console.log(`[CloudAuth] Project ${projectId} patched successfully`);
  }
}
