# Palagg — wedraw 토핑 파츠 메이커

**Wedraw의 IKEA SKÅDIS 전용 3D 파츠 생성기, PÅLÄGG**

<br/>
<br/>

<p align="center"><img width="300" alt="part animation" src="https://github.com/user-attachments/assets/bc1bfe6e-2d24-4042-95d5-efc531b7d486"></p>

<br/>
<br/>

[wedraw(위드로우)](https://wedraw.kr)는 "제조를 간단하게"라는 미션 아래 온라인에서 셀프인테리어와 DIY를 위한 다양한 서비스를 운영하고 있습니다. **토핑 파츠 메이커**는 wedraw의 서비스 중 하나로, IKEA [SKÅDIS](https://www.ikea.com/ch/en/cat/skadis-series-37813/) 페그보드에 토핑처럼 추가할 수 있는 커스텀 아이템을 브라우저에서 직접 설계하고 3MF 파일로 다운로드할 수 있는 파라메트릭 웹앱입니다.

## 주요 기능

- **Box / Grid 형상 선택** — 단순 박스 또는 칸막이가 있는 정리함
- **실시간 3D 프리뷰** — IKEA 매뉴얼 스타일의 윤곽선 렌더링, 터치/마우스로 회전
- **파라메트릭 치수 조절** — Levels, Width, Depth, Top Extra를 슬라이더와 스테퍼로 조절
- **Grid 컨트롤** — Row / Column 스테퍼로 칸 수 조절 (1×1 방지 제약 포함)
- **주문서** — 여러 설정을 누적한 뒤 ZIP으로 일괄 다운로드
- **단건 다운로드** — 현재 설정을 바로 3MF로 다운로드

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
palagg/
├── packages/
│   └── web/                    — 프론트엔드 (Vite SPA)
│       ├── src/
│       │   ├── main.ts         — 앱 진입점, 상태 관리, DOM, 이벤트 루프
│       │   ├── controls.tsx    — UI 컴포넌트 (twrl JSX)
│       │   ├── animate.ts      — 트위닝 엔진 (easeInOutCubic)
│       │   ├── style.css       — wedraw 디자인 시스템 (CSS 변수)
│       │   ├── model/          — CSG 모델 생성, 3MF 변환, TMFLoader
│       │   └── rendering/      — Three.js 카메라, 셰이더 (outline, thicken, FXAA)
│       ├── index.html
│       └── vite.config.ts
├── CLAUDE.md
└── package.json               — npm workspaces 루트
```

## 개발 환경 설정

```bash
# 의존성 설치
npm install

# 개발 서버
cd packages/web
npm run dev      # localhost:5173

# 빌드
npm run build    # tsc + vite build → dist/

# 타입 체크
npm run tsc
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

## 사용자 플로우

1. **형상 선택** — Box 또는 Grid 토글
2. **치수 조절** — Levels(스테퍼), Width·Depth(슬라이더), Top Extra(접이식 슬라이더)
3. **Grid 모드** — Row·Column 스테퍼로 칸 수 조절
4. **3D 프리뷰** — 실시간 애니메이션, 터치/마우스 회전
5. **다운로드** — 단건 3MF 다운로드 또는 주문서에 추가 후 ZIP 일괄 다운로드

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
