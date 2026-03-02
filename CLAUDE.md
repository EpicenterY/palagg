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
│   │   │   ├── main.ts         — 앱 진입점, 상태 관리, DOM, 이벤트 루프
│   │   │   ├── controls.tsx    — UI 컴포넌트 (twrl JSX)
│   │   │   ├── animate.ts      — 트위닝 엔진 (easeInOutCubic)
│   │   │   ├── style.css       — wedraw 디자인 시스템 (CSS 변수)
│   │   │   ├── model/          — CSG 모델 생성, 3MF 변환, TMFLoader
│   │   │   └── rendering/      — Three.js 카메라, 셰이더 (outline, thicken, FXAA)
│   │   ├── index.html
│   │   └── vite.config.ts
│   ├── server/                 — 백엔드 (Fastify, 프린트 파이프라인 — 프론트엔드 미연동)
│   └── shared/                 — 공유 타입
├── CLAUDE.md
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

1. 형상 선택 (Box / Grid 토글)
2. 치수 조절 (Levels, Width, Depth, Top Extra)
3. Grid 모드: Row / Column 조절
4. 실시간 3D 프리뷰 + 애니메이션
5. **단건**: `3MF 다운로드` 클릭
6. **다건**: `+ 주문서에 추가` → 여러 설정 누적 → `한번에 주문하기` 클릭 시 ZIP 일괄 다운로드

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
