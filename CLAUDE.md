# wedraw 토핑 메이커

## 프로젝트 개요

wedraw(위드로우)는 "제조를 간단하게"라는 미션 아래 온라인에서 셀프인테리어와 DIY를 위한 다양한 서비스를 운영하고 있다. 토핑 파츠 메이커는 IKEA SKÅDIS 페그보드에 토핑처럼 추가할 수 있는 커스텀 아이템을 브라우저에서 직접 설계하고 3MF 파일로 다운로드할 수 있는 파라메트릭 웹앱이다.

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
| 폰트 | Pretendard Variable (한글) + Inter (영문) |

## 프로젝트 구조

```
skapa/
├── packages/
│   ├── web/                    — 프론트엔드 (Vite SPA)
│   │   ├── src/
│   │   │   ├── main.ts         — 앱 진입점, 상태 관리, DOM, 모달, 이벤트 루프
│   │   │   ├── controls.tsx    — UI 컴포넌트 (twrl JSX)
│   │   │   ├── iconify.ts      — Iconify API 클라이언트 (아이콘 검색/변환)
│   │   │   ├── icon-store.ts   — 커스텀 아이콘 localStorage 영속화
│   │   │   ├── animate.ts      — 트위닝 엔진 (easeInOutCubic)
│   │   │   ├── style.css       — wedraw 디자인 시스템 (CSS 변수)
│   │   │   ├── model/          — CSG 모델 생성, 3MF 변환, TMFLoader
│   │   │   └── rendering/      — Three.js 카메라, 셰이더 (outline, thicken, FXAA)
│   │   ├── index.html
│   │   └── vite.config.ts
│   ├── server/                 — 백엔드 (Fastify, 프린트 파이프라인 — 프론트엔드 미연동)
│   └── shared/                 — 공유 타입
├── CLAUDE.md
├── vercel.json                — Vercel 배포 설정
└── package.json               — npm workspaces 루트
```

## 개발 명령어

```bash
cd packages/web
npm run dev      # Vite 개발 서버 (localhost:5173)
npm run build    # tsc + vite build → dist/
npm run tsc      # 타입 체크만
npm run format   # Prettier 포매팅

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

## 현재 프론트엔드 UX 기준

### 핵심 사용자 플로우

1. 형상 선택 (Box / Grid / Tag 토글)
2. 치수 조절 (Levels, Width, Depth, Top Extra)
3. Grid 모드: Row / Column 조절
4. Tag 모드: 텍스트 입력 또는 이모지/아이콘 선택
5. 실시간 3D 프리뷰 + 애니메이션
6. **단건**: `3MF 다운로드` 클릭
7. **다건**: `+ 주문서에 추가` → 여러 설정 누적 → `한번에 주문하기` 클릭 시 ZIP 일괄 다운로드

### 주문서 동작

- 동일 스펙은 항목을 늘리지 않고 수량(`xN`)으로 합산
- 삭제 버튼은 `×` 아이콘(회색)
- 요약 문구: `총 N개의 PÅLÄGG`

### 형태/치수 컨트롤

- 형태 토글: `Box / Grid`
- **Levels**: 스테퍼(+/- 버튼), 범위 1~5
- **Top Extra**: 기본 숨김(최소값 0), `+` 버튼으로 펼쳐서 조절, 범위 0~20mm
- **Width / Depth**: 슬라이더 + 숫자 입력, mm 단위

### Grid 컨트롤 (organizer 모드 전용)

- **Row** / **Column** 두 줄로 분리된 스테퍼(+/- 버튼)
- 표시값 = 칸 수, 내부값 = divider 수 (`internal = display - 1`)
- 양쪽 모두 최소 display 1 (internal 0) 허용
- **1×1 방지 제약**: 한쪽을 1로 내리려 할 때 상대쪽도 1이면 상대쪽을 자동으로 2로 올림
  - 예: 2×1에서 Column [-] → 1×2 (Row 자동 증가)
  - 예: 1×2에서 Row [-] → 2×1 (Column 자동 증가)
- 직접 숫자 입력 시에도 동일한 제약 적용

### Tag 컨트롤 (tag 모드 전용)

- **Text**: 자유 텍스트 입력, `measureTextWidth()`로 너비 제한 검사
- **Width**: 슬라이더 25~200mm, 텍스트/이모지에 따라 자동 확장
- **Icon**: 24개 내장 프리셋 (Material Symbols / Lucide 기반) + Iconify 검색
- **"+" 버튼**: 이모지 그리드 끝에 위치, 클릭 시 Iconify 아이콘 검색 모달 열림
- 선택된 커스텀 아이콘은 `localStorage`에 영속화, 새로고침 후에도 유지

### Iconify 아이콘 검색

- **API**: `https://api.iconify.design` (무료, CORS 지원, API 키 불필요)
- **검색 범위**: Material Symbols (15,000+ 아이콘, arc 명령 미사용 → `parseSvgPath` 호환)
- **데이터 흐름**: `searchIcons()` → `fetchIconData()` → `iconifyToPreset()` → `EMOJI_PRESETS.push()`
- **영속화**: `icon-store.ts` — `palagg-custom-icons` localStorage 키
- **ID 규칙**: 커스텀 아이콘 `id = "iconify:{prefix}:{name}"` (내장 프리셋과 충돌 방지)

### 훅(클립) 동작 규칙

- Box와 Grid 모두 동일한 SKÅDIS 훅 생성 로직 사용
- `Top Extra` 변경 시 훅 배치 기준 높이는 `baseHeight(levels 기반)`를 사용해 훅 깜빡임/개수 변동 방지
- Level 증가 시 훅 증가는 최종 단계에서 반영되도록 애니메이션 기준 분리

### SVG 경로 파싱 (model/text.ts)

- `parseSvgPath(d)` — SVG `d` 속성을 `Vec2[][]` 컨투어로 변환
- 지원 명령어: `M/m`, `L/l`, `H/h`, `V/v`, `C/c`, `S/s`, `Q/q`, `T/t`, `Z/z`
- `S/s` (smooth cubic): `lastC2` 반사로 첫 번째 제어점 자동 계산
- `T/t` (smooth quadratic): `lastQ1` 반사로 제어점 자동 계산
- `A/a` (arc): 미지원 — Material Symbols는 arc 미사용이므로 Iconify 호환 문제 없음
- `Z` 명령 시 시작점과 중복되는 마지막 점 제거 (degenerate edge 방지)

### 메시 변환 (model/export.ts)

- `mesh2geometry()`: `mesh.numProp` stride 사용 (하드코딩 `3` 금지)
- `computeCreaseNormals(geometry, π/6)` — 30° crease angle 곡면 스무딩

## STEP → CSG 변환 워크플로우

사용자가 STEP 파일을 전달하면 형상의 의도를 분석하고 Manifold-3D CSG 코드로 변환한다.

### STEP 파일 경로

- 전달 위치: `packages/web/src/model/` 디렉토리에 `.step` 또는 `.stp` 파일 배치
- 분석 요청: `"model/파일명.step 분석해줘"` 형태로 요청

### 분석 → 변환 프로세스

1. **STEP 읽기** — `Read` 도구로 ASCII STEP 파일을 텍스트로 읽음
2. **형상 의도 파악** — 프리미티브 구성(박스, 실린더, 필렛 등), 치수, 불리언 관계, 마운트 구조 분석
3. **CSG 수식 설계** — Manifold-3D API(`cube`, `cylinder`, `union`, `subtract`, `intersect`, `rotate`, `translate`)로 형상 재구성 계획 수립
4. **코드 작성** — `model/manifold.ts`에 새 생성 함수 추가 또는 기존 함수 수정
5. **파라메트릭화** — 사용자가 조절할 치수를 변수로 분리, 필요시 UI 컨트롤 연동
6. **검증** — dev 서버에서 3D 프리뷰 확인, STEP 원본 의도와 비교

### CSG 변환 적합도

| 잘 되는 형상 | 주의가 필요한 형상 |
|---|---|
| 직교 박스, 실린더, 구 조합 | 유기적 자유곡면 (NURBS) |
| 서랍, 트레이, 칸막이 | 복잡한 가변 필렛/챔퍼 |
| 후크, 홀더, 클립 | B-spline 곡선 프로파일 |
| 반복/패턴 구조 (루프) | 얇은 쉘 + 리브 복합 구조 |

### 주의사항

- STEP 파일은 ASCII 형식이어야 읽기 가능 (바이너리 STEP은 불가)
- 정밀 곡면은 다면체 근사로 변환되므로 원본과 미세한 차이 발생 가능
- 복잡한 형상은 단계별로 분해하여 변환하고, 중간 결과를 사용자에게 확인받음
- SKÅDIS 마운트 클립은 기존 `clips()` 함수를 재사용

## 배포

- **Vercel**: `main` 브랜치 push 시 자동 배포
- **URL**: https://palagg.vercel.app
- **설정** (`vercel.json`): `framework: "vite"`, `buildCommand: "npm run build -w @palagg/web"`, `outputDirectory: "packages/web/dist"`
- **주의**: 로컬 수정사항은 반드시 커밋 & 푸시해야 Vercel에 반영됨

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
