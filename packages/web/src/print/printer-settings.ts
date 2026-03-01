import type { Printer, PrinterStatus } from "@palagg/shared";
import { getPrinters, updatePrinter, testPrinterConnection } from "./api";

const STATUS_LABELS: Record<PrinterStatus, string> = {
  idle: "대기",
  printing: "프린팅 중",
  paused: "일시정지",
  error: "오류",
  offline: "오프라인",
};

let modalEl: HTMLDivElement | null = null;

export function initPrinterSettings() {
  const actionButtons = document.querySelector(".action-buttons");
  if (!actionButtons) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "printer-settings-btn";
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  btn.title = "프린터 설정";
  btn.addEventListener("click", openSettings);
  actionButtons.appendChild(btn);
}

async function openSettings() {
  if (modalEl) return;

  const overlay = document.createElement("div");
  overlay.className = "printer-modal-overlay";
  modalEl = overlay;

  const modal = document.createElement("div");
  modal.className = "printer-modal";

  modal.innerHTML = `
    <h3 class="printer-modal-title">프린터 설정</h3>
    <div class="printer-modal-loading">불러오는 중...</div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  try {
    const printers = await getPrinters();
    if (printers.length === 0) {
      modal.querySelector(".printer-modal-loading")!.textContent = "등록된 프린터가 없습니다";
      return;
    }
    renderPrinterForm(modal, printers[0]);
  } catch {
    modal.querySelector(".printer-modal-loading")!.textContent = "프린터 정보를 불러올 수 없습니다";
  }
}

function renderPrinterForm(modal: HTMLDivElement, printer: Printer) {
  const loading = modal.querySelector(".printer-modal-loading");
  if (loading) loading.remove();

  const form = document.createElement("div");
  form.className = "printer-modal-form";
  form.innerHTML = `
    <div class="printer-form-field">
      <label>프린터</label>
      <div class="printer-form-readonly">
        <span class="printer-form-name">${printer.name}</span>
        <span class="printer-status-badge" data-status="${printer.status}">${STATUS_LABELS[printer.status] ?? printer.status}</span>
      </div>
    </div>
    <div class="printer-form-field">
      <label for="printer-ip">IP 주소</label>
      <input type="text" id="printer-ip" placeholder="192.168.0.100" value="${printer.ip === "192.168.0.0" ? "" : printer.ip}" />
    </div>
    <div class="printer-form-field">
      <label for="printer-access-code">Access Code</label>
      <input type="text" id="printer-access-code" placeholder="프린터 화면에서 확인" value="" />
    </div>
    <div class="printer-form-actions">
      <button type="button" class="printer-btn-test">연결 테스트</button>
      <button type="button" class="printer-btn-save">저장</button>
    </div>
    <div class="printer-form-message" hidden></div>
  `;

  modal.appendChild(form);

  const ipInput = form.querySelector("#printer-ip") as HTMLInputElement;
  const codeInput = form.querySelector("#printer-access-code") as HTMLInputElement;
  const testBtn = form.querySelector(".printer-btn-test") as HTMLButtonElement;
  const saveBtn = form.querySelector(".printer-btn-save") as HTMLButtonElement;
  const messageEl = form.querySelector(".printer-form-message") as HTMLDivElement;

  function showMessage(text: string, type: "success" | "error" | "info") {
    messageEl.hidden = false;
    messageEl.textContent = text;
    messageEl.className = `printer-form-message printer-form-message--${type}`;
  }

  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    testBtn.textContent = "테스트 중...";
    showMessage("연결 테스트 중...", "info");

    // Save IP/code first if changed
    const patch: Record<string, string> = {};
    if (ipInput.value) patch.ip = ipInput.value;
    if (codeInput.value) patch.access_code = codeInput.value;

    try {
      if (Object.keys(patch).length > 0) {
        await updatePrinter(printer.id, patch);
      }
      const result = await testPrinterConnection(printer.id);
      showMessage(result.message, result.success ? "success" : "error");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showMessage(`오류: ${msg}`, "error");
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = "연결 테스트";
    }
  });

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중...";

    const patch: Record<string, string> = {};
    if (ipInput.value) patch.ip = ipInput.value;
    if (codeInput.value) patch.access_code = codeInput.value;

    if (Object.keys(patch).length === 0) {
      showMessage("변경된 내용이 없습니다", "info");
      saveBtn.disabled = false;
      saveBtn.textContent = "저장";
      return;
    }

    try {
      await updatePrinter(printer.id, patch);
      showMessage("저장 완료", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showMessage(`저장 실패: ${msg}`, "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "저장";
    }
  });
}

function closeModal() {
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
  }
}
