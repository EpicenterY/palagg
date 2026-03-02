# wedraw 토핑 메이커

## 프로젝트 개요

wedraw(위드로우)는 "제조를 간단하게"라는 미션 아래 온라인에서 셀프인테리어와 DIY를 위한 다양한 서비스를 운영하고 있다. 특히 제조 인프라에 쉽게 접근할 수 있는 다양한 웹 서비스를 제공하고 있다. 토핑 파츠 메이커는 wedraw의 서비스 중 하나로, IKEA SKÅDIS 페그보드와 같은 스테디 셀러제품에 토핑처럼 추가할 수 있는 커스텀 아이템을 손쉽게 생성하기 위해 개발되었다. 토핑 파츠를 브라우저에서 직접 설계하고 3MF 파일로 다운로드할 수 있으며 추후 3MF다운로드 뿐 아니라 바로 출력까지 연계하여 구매할 수 있는 파라메트릭 웹앱이다.

- **플랫폼**: https://wedraw.kr
- **언어**: 한국어 UI
- **용어**: "토핑 파츠" = 커스텀을 위한 위드로우 토핑의 다양한 파츠

## 기술 스택

| 역할 | 기술 |
|------|------|
| 빌드 | Vite 6 + TypeScript 5.7 (strict) |
| UI/상태 | twrl (Dyn\<T\> 반응형 상태, JSX) |
| 3D 렌더링 | Three.js (Orthographic + 커스텀 포스트프로세싱) |
| 3D 모델링 | Manifold-3D (WebAssembly CSG) |
| 파일 내보내기 | @jscadui/3mf-export + fflate |
| 서버 | Fastify 5 + SQLite (better-sqlite3) |
| 프린터 통신 | MQTT (mqtt.js) + FTPS (basic-ftp) |
| 폰트 | Pretendard Variable (한글) + Inter (영문) |

## 프로젝트 구조 (모노레포)

```
skapa/
├── packages/
│   ├── web/                    — 프론트엔드 (Vite SPA)
│   │   ├── src/
│   │   │   ├── main.ts         — 앱 진입점, 상태 관리, DOM, 이벤트 루프
│   │   │   ├── controls.tsx    — UI 컴포넌트 (twrl JSX)
│   │   │   ├── animate.ts      — 트위닝 엔진 (easeInOutCubic)
│   │   │   ├── style.css       — wedraw 디자인 시스템 (CSS 변수)
│   │   │   ├── print/          — 프린트 서버 연동 모듈(현재 UI 기본 플로우에서는 비활성)
│   │   │   ├── model/          — CSG 모델 생성, 3MF 변환, TMFLoader
│   │   │   └── rendering/      — Three.js 카메라, 셰이더 (outline, thicken, FXAA)
│   │   ├── index.html
│   │   └── vite.config.ts
│   ├── server/                 — 백엔드 (Fastify API 서버)
│   │   └── src/
│   │       ├── index.ts        — 서버 부트스트랩
│   │       ├── config.ts       — 환경변수
│   │       ├── db/             — SQLite 스키마, Job/Printer CRUD
│   │       ├── api/            — REST 라우트 (/api/jobs, /api/printers)
│   │       ├── ws/             — WebSocket (작업 상태, 카메라 릴레이)
│   │       └── services/       — 슬라이서, MQTT, FTP, 작업 오케스트레이터
│   └── shared/                 — 공유 타입 (Job, Printer, WsMessage)
│       └── src/types.ts
├── CLAUDE.md
└── package.json               — npm workspaces 루트
```

## 개발 명령어

```bash
# 프론트엔드
cd packages/web
npm run dev      # Vite 개발 서버 (localhost:5173)
npm run build    # tsc + vite build → dist/
npm run tsc      # 타입 체크만
npm run format   # Prettier 포매팅

# 백엔드
cd packages/server
npm run dev      # tsx watch (localhost:3000)
npm run build    # tsc → dist/
npm start        # node dist/index.js

# 전체 의존성
npm install      # 루트에서 실행 (workspaces)
```

## 코딩 컨벤션

### 네이밍

- 상수: `UPPER_SNAKE_CASE` (e.g. `CLIP_HEIGHT`, `START_RADIUS`)
- 변수/함수: `camelCase` (e.g. `modelDimensions`, `generateArc`)
- CSS 클래스: `kebab-case` (e.g. `.range-input-wrapper`)
- 타입: `PascalCase` (e.g. `ShapeType`, `PartPosition`)

### TypeScript

- `strict: true` — 모든 strict 옵션 활성화
- Discriminated union으로 복잡한 상태 표현 (`tag` 필드)
- `Dyn<T>`로 상태 관리, `.addListener()`로 사이드 이펙트 연결
- `Dyn.sequence([a, b]).map(...)` 패턴으로 파생 상태 계산

### twrl JSX 주의사항

- `role`, `checked` 등 일부 HTML 속성 미지원 → `document.createElement()`로 직접 생성
- 컴포넌트가 DOM 요소를 직접 반환 (React와 다름)

### CSS

- wedraw 디자인 시스템 CSS 변수 사용 필수:
  - 색상: `--color-primary`, `--color-accent`, `--color-bg` 등
  - 둥글기: `--radius-sm` (6px), `--radius-md` (12px), `--radius-lg` (20px)
  - 폰트: `--font-sans`
  - 레이아웃: `--label-width`, `--control-gap`
- 새 하드코딩 색상/크기 추가 금지 — 반드시 CSS 변수 참조

## 아키텍처 핵심

### 데이터 흐름

```
사용자 입력 → Dyn.send() → Listener → Animate.startAnimationTo()
  → requestAnimationFrame 루프
    → manifold.ts (모델 재생성)
    → Three.js 메시 업데이트 + renderer.render()
    → TMFLoader (3MF 내보내기) → 다운로드 링크 갱신
```

### 렌더링 파이프라인

```
Scene → RenderOutlinePass (법선+깊이 에지) → ThickenPass (윤곽선 확장)
      → OutputPass → FXAAPass → Canvas
```

### 3D 모델 (manifold.ts)

- CSG 연산: `roundedRectangle()`, `clips()`, `base()`, `box()`, `drawerOrganizer()`
- SKÅDIS 클립 간격: 가로/세로 40mm, 클립 높이 12mm
- 상단 클립 chamfer: 서포트 없이 3D 프린팅 가능하도록 45° 처리

## 현재 프론트엔드 UX 기준 (2026-03)

### 핵심 사용자 플로우

- 기존 `Print Now` 버튼 제거
- 사용자는 현재 설정을 `+ 주문서에 추가`로 누적
- 주문서에서 항목 검토 후 `한번에 주문하기` 클릭 시 모든 항목 3MF를 ZIP으로 일괄 다운로드
- 기존 `3MF 다운로드`(단건) 버튼은 유지

### 주문서 동작

- 동일 스펙은 항목을 늘리지 않고 수량(`xN`)으로 합산
- 삭제 버튼은 `×` 아이콘(회색)
- 요약 문구: `총 N개의 PÅLÄGG`

### 형태/치수 컨트롤

- 형태 토글: `Box / Grid`
- `Top Extra`는 기본 숨김(최소값 0), `+` 버튼으로 펼쳐서 조절
- `Top Extra` 범위: 0~20mm (다음 훅 간격 40mm의 절반)
- `Top Extra`는 Box/Grid 모두 적용
- `Grid` 입력은 `3 X 2` 형태의 단일 항목으로 표시
  - 이 값은 **칸 수**를 의미
  - 내부 모델 파라미터는 divider 수로 변환 (`cols = 입력-1`, `rows = 입력-1`)
  - 최소 입력값은 `2 X 1`
  - 커스텀 스피너 버튼은 제거되었고, 숫자 입력 직접 편집 방식 사용
  - Grid 입력 UI는 우측 정렬 값 영역 규칙을 따름

### 입력 UI 일관성

- 컨트롤 패널 내 숫자 입력은 모두 동일한 텍스트 선택 하이라이트(`--color-accent-light`) 적용
- `Top Extra` 펼침/접힘은 부드러운 전환 애니메이션(max-height/opacity/transform) 사용

### 훅(클립) 동작 규칙

- Box와 Grid 모두 동일한 SKÅDIS 훅 생성 로직 사용
- `Top Extra` 변경 시 훅 배치 기준 높이는 `baseHeight(levels 기반)`를 사용해 훅 깜빡임/개수 변동 방지
- Level 증가 시 훅 증가는 최종 단계에서 반영되도록 애니메이션 기준 분리

## 커밋 메시지

- 영어로 작성
- 기능: "Add ...", 수정: "Fix ...", 리팩토링: "Refactor ...", 의존성: "Bump ..."
- 간결하게 1줄 요약, 필요시 본문에 상세 설명

## UI 작업 시 필수 루틴 (UI작업시에만 적용)

UI 코드 수정 후에는 반드시:
1. `npm run dev` 실행 확인
2. `http://localhost:5173` 스크린샷 촬영 (Playwright MCP)
3. 레이아웃 오류, 깨진 UI, 콘솔 에러 분석 후 수정
4. 정상 결과 나올 때까지 수정 → 스크린샷 → 분석 반복
5. 최종 스크린샷을 사용자에게 보여주고 마무리

---

## 프린트 파이프라인 (packages/server)

### 개요

웹에서 설계한 3MF를 Bambu Lab X1C 프린터로 출력하는 자동화 파이프라인.
작업 상태: `pending_slice → slicing → pending_upload → uploading → pending_print → printing`

### 핵심 파일

| 파일 | 역할 |
|------|------|
| `services/job-orchestrator.ts` | 1초 간격 tick — 슬라이스 → 업로드 → 프린트 순차 처리 |
| `services/slicer.ts` | BambuStudio CLI로 3MF 슬라이싱 |
| `services/printer-upload.ts` | LAN: FTPS / Cloud: S3 업로드 분기 |
| `services/cloud-upload.ts` | Cloud 업로드 (S3 PUT + 알림 + 패치) |
| `services/bambu-cloud-auth.ts` | Cloud API 인증, 프로젝트/태스크 생성, 알림 |
| `services/printer-mqtt.ts` | MQTT 연결, 상태 수신, 프린트 명령 전송 |
| `config.ts` | 환경변수 (CONNECTION_MODE, 토큰, 프린터 정보) |

### 연결 모드 (CONNECTION_MODE)

#### Cloud 모드 (`cloud`) — 현재 구현됨, 제한 있음

```
슬라이싱 → createProject() → S3 PUT → notifyUploadComplete()
→ patchProject() → createTask() → MQTT project_file 명령
```

**구현 완료 (정상 작동):**
- `createProject()` — 프로젝트 생성, S3 pre-signed URL + ticket 반환
- S3 PUT 업로드 — 슬라이싱된 3MF 파일 업로드
- `notifyUploadComplete()` — PUT 알림 + GET 폴링 (running → success)
- `patchProject()` — 모델-프로젝트 연결

**PUT notification 올바른 포맷:**
```json
{
  "upload": {
    "origin_file_name": "filename.3mf",
    "ticket": "uploader:uid:modelId:profileId:timestamp"
  }
}
```
- ticket은 project 응답의 `upload_ticket`에서 `_`를 `:`로 치환
- GET 폴링: 2초 간격, 최대 30회, `message: "success"` 까지 대기

**근본적 제한 (해결 불가):**
1. **Task API 거부** — API로 업로드한 모델은 `POST /v1/user-service/my/task`에서 빈 400 반환. BambuStudio의 비공개 `bambu_networking.dll`로 업로드한 모델만 태스크 생성 성공. DLL이 추가 서명/단계를 포함하는 것으로 추정.
2. **MQTT 명령 검증** — 프린터 펌웨어가 써드파티 MQTT 명령 차단 (`err_code: 84033543`, `reason: "mqtt message verify failed"`). Developer Mode 활성화 시 우회 가능하나 LAN 전용.

**결론: 현재 펌웨어로 써드파티 Cloud 프린팅 불가능.**

#### LAN 모드 (`lan`) — 전환 예정

```
슬라이싱 → FTPS 업로드 (printer:990) → MQTT project_file (ftp:///cache/파일명)
```

- Developer Mode 필요 (프린터 터치스크린에서 활성화)
- FTPS: `bblp` / `{access_code}` @ `{printer_ip}:990`
- MQTT: `bblp` / `{access_code}` @ `{printer_ip}:8883`
- Cloud 연결 불가 (Developer Mode는 LAN 전용)
- 코드 이미 구현됨 (`printer-upload.ts`, `printer-mqtt.ts`)

### Bambu Connect 검토 결과 (불채택)

Bambu Connect는 데스크톱 미들웨어 앱으로 URL scheme(`bambu-connect://import-file`)으로만 연동 가능. REST API 없음, 사용자 UI 조작 필요, 서버 자동화 불가. 우리 파이프라인(웹 서버 자동 프린트)에 부적합.

대안인 **Bambu Local Server (Enterprise SDK)**는 Docker 기반 REST API를 제공하나 접근권 신청 필요 (`devpartner@bambulab.com`).

### Cloud API 엔드포인트 참조

| 엔드포인트 | 메서드 | 용도 |
|------------|--------|------|
| `/v1/user-service/user/login` | POST | 로그인 (accessToken 반환) |
| `/v1/design-user-service/my/preference` | GET | UID 조회 (MQTT username용) |
| `/v1/iot-service/api/user/bind` | GET | 바인딩된 프린터 목록 |
| `/v1/iot-service/api/user/project` | POST | 프로젝트 생성 (upload URL + ticket) |
| `/v1/iot-service/api/user/project/{id}` | PATCH | 프로젝트 패치 (모델 연결) |
| `/v1/iot-service/api/user/notification` | PUT | 업로드 완료 알림 |
| `/v1/iot-service/api/user/notification?action=upload&ticket=...` | GET | 서버 처리 상태 폴링 |
| `/v1/user-service/my/task` | POST | 프린트 태스크 생성 |

### TODO: LAN 모드 전환

1. 프린터에서 Developer Mode 활성화
2. `.env`에서 `CONNECTION_MODE=lan` 으로 변경
3. `PRINTER_IP`, `PRINTER_ACCESS_CODE` 환경변수 확인
4. FTPS 업로드 → MQTT 프린트 명령 E2E 테스트
5. Cloud 전용 코드(task 생성 등)는 유지하되, LAN 경로가 기본값
