import type { Job, JobStatus, WsMessage } from "@palagg/shared";
import { submitPrintJob, connectJobWs, checkServerHealth } from "./api";
import type { TMFLoader } from "../model/load";

const STATUS_LABELS: Record<JobStatus, string> = {
  created: "생성됨",
  pending_slice: "슬라이싱 대기",
  slicing: "슬라이싱 중...",
  slice_failed: "슬라이싱 실패",
  pending_upload: "업로드 대기",
  uploading: "업로드 중...",
  upload_failed: "업로드 실패",
  pending_print: "프린팅 대기",
  printing: "프린팅 중...",
  print_failed: "프린팅 실패",
  completed: "완료",
  cancelled: "취소됨",
};

let currentJobId: string | null = null;
let wsConnected = false;

export function initPrintButton(tmfLoader: TMFLoader) {
  const btn = document.getElementById("print-now") as HTMLButtonElement;
  const statusPanel = document.getElementById("job-status") as HTMLDivElement;

  // Check server availability on load
  checkServerHealth().then((healthy) => {
    if (!healthy) {
      btn.disabled = true;
      btn.title = "프린트 서버에 연결할 수 없습니다";
    }
  });

  btn.addEventListener("click", async () => {
    const result = tmfLoader.latest();
    if (!result) return;

    btn.disabled = true;
    btn.classList.add("submitting");
    btn.textContent = "Submitting...";

    try {
      const job = await submitPrintJob(result.blob, result.filename);
      currentJobId = job.id;
      showJobStatus(statusPanel, job);
      ensureWsConnection(statusPanel);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(statusPanel, msg);
    } finally {
      btn.disabled = false;
      btn.classList.remove("submitting");
      btn.textContent = "Print Now";
    }
  });
}

function ensureWsConnection(statusPanel: HTMLDivElement) {
  if (wsConnected) return;
  wsConnected = true;

  connectJobWs((msg: WsMessage) => {
    if (msg.type === "job:status" && msg.jobId === currentJobId) {
      updateJobStatusUI(statusPanel, msg.status, msg.progress);
    }
  });
}

function showJobStatus(panel: HTMLDivElement, job: Job) {
  panel.hidden = false;
  panel.innerHTML = `
    <div class="job-status-header">
      <span class="job-status-label">프린트 작업</span>
      <span class="job-status-state" data-status="${job.status}">
        ${STATUS_LABELS[job.status] ?? job.status}
      </span>
    </div>
    <div class="job-progress">
      <div class="job-progress-bar" style="width: ${job.progress}%"></div>
    </div>
  `;
}

function updateJobStatusUI(panel: HTMLDivElement, status: JobStatus, progress: number) {
  const stateEl = panel.querySelector(".job-status-state");
  const barEl = panel.querySelector(".job-progress-bar") as HTMLDivElement | null;

  if (stateEl) {
    stateEl.textContent = STATUS_LABELS[status] ?? status;
    stateEl.setAttribute("data-status", status);
  }
  if (barEl) {
    barEl.style.width = `${progress}%`;
  }
}

function showError(panel: HTMLDivElement, message: string) {
  panel.hidden = false;
  panel.innerHTML = `
    <div class="job-status-header">
      <span class="job-status-label">프린트 작업</span>
      <span class="job-status-state" data-status="failed" style="color: #b33;">오류</span>
    </div>
    <div class="job-error">${message}</div>
  `;
}
