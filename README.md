# SKÅPA — wedraw 토핑 파츠 메이커

**IKEA SKÅDIS 페그보드 전용 3D 파츠 생성기**

<br/>
<br/>

<p align="center"><img width="300" alt="part animation" src="https://github.com/user-attachments/assets/bc1bfe6e-2d24-4042-95d5-efc531b7d486"></p>

<br/>
<br/>

[wedraw(위드로우)](https://wedraw.kr)는 "제조를 간단하게"라는 미션 아래 온라인에서 셀프인테리어와 DIY를 위한 다양한 서비스를 운영하고 있습니다. **토핑 파츠 메이커**는 wedraw의 서비스 중 하나로, IKEA [SKÅDIS](https://www.ikea.com/ch/en/cat/skadis-series-37813/) 페그보드에 토핑처럼 추가할 수 있는 커스텀 아이템을 브라우저에서 직접 설계하고 3MF 파일로 다운로드할 수 있는 파라메트릭 웹앱입니다.

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
│   │   │   ├── print/          — Print Now 기능 (API 통신, 작업 상태 UI)
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

## 개발 환경 설정

```bash
# 의존성 설치
npm install      # 루트에서 실행 (workspaces)

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
```

## 아키텍처

### 데이터 흐름

```
사용자 입력 → Dyn.send() → Listener → Animate.startAnimationTo()
  → requestAnimationFrame 루프
    → manifold.ts (모델 재생성)
    → Three.js 메시 업데이트 + renderer.render()
    → TMFLoader (3MF 내보내기) → 다운로드 링크 갱신
```

### 렌더링 파이프라인

커스텀 포스트프로세싱을 통해 IKEA 매뉴얼 스타일의 윤곽선 렌더링을 구현합니다.

```
Scene → RenderOutlinePass (법선+깊이 에지) → ThickenPass (윤곽선 확장)
      → OutputPass → FXAAPass → Canvas
```

### 3D 모델 (CSG)

- CSG 연산: `roundedRectangle()`, `clips()`, `base()`, `box()`, `drawerOrganizer()`
- SKÅDIS 클립 간격: 가로/세로 40mm, 클립 높이 12mm
- 상단 클립 chamfer: 서포트 없이 3D 프린팅 가능하도록 45° 처리

## wedraw 브랜드 컬러

| 이름 | 색상 코드 |
|------|-----------|
| Primary | `#36583D` (dark green) |
| Accent | `#BDCF9B` (light green) |
| Neutral | `#B9B8AF` |
| Warm BG | `#F7E6CA` |
| Background | `#F4F4F2` |

## 로드맵

- SKÅDIS 페그보드 외 다른 IKEA 제품용 3D 프린팅 액세서리 확장
- 고급 모드: 벽 두께 및 바닥 두께 커스터마이징
- 3MF 다운로드뿐 아니라 바로 출력 연계 구매 기능
