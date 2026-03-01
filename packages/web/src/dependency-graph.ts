import "./dependency-graph.css";

import mermaid from "mermaid";

const graphMarkup = `
graph TD
    index[index.html] --> main[src/main.ts]

    main --> styleCss[src/style.css]
    main --> controls[src/controls.tsx]
    main --> animate[src/animate.ts]
    main --> renderer[src/rendering/renderer.ts]
    main --> manifold[src/model/manifold.ts]
    main --> exportM[src/model/export.ts]
    main --> loader[src/model/load.ts]

    controls --> plusSvg[src/plus.svg]
    controls --> minusSvg[src/minus.svg]

    loader --> exportM

    renderer --> outline[src/rendering/effects/outline/index.ts]
    renderer --> thicken[src/rendering/effects/thicken/index.ts]
    renderer --> fxaa[src/rendering/effects/antialiasing.ts]

    outline --> outlineVert[src/rendering/effects/outline/vert.glsl]
    outline --> outlineFrag[src/rendering/effects/outline/frag.glsl]
    thicken --> thickenVert[src/rendering/effects/thicken/vert.glsl]
    thicken --> thickenFrag[src/rendering/effects/thicken/frag.glsl]

    main --> threePkg["three"]
    renderer --> threePkg
    animate --> threePkg
    exportM --> threePkg
    main --> twrlPkg["twrl"]
    manifold --> manifoldPkg["manifold-3d"]
    manifold --> wasm["manifold.wasm"]
    exportM --> jscadPkg["@jscadui/3mf-export"]
    exportM --> fflatePkg["fflate"]

    classDef entry fill:#f5f7ff,stroke:#4f46e5,stroke-width:1.2px;
    classDef local fill:#f9fafb,stroke:#334155,stroke-width:1px;
    classDef external fill:#fff7ed,stroke:#ea580c,stroke-width:1px;

    class index,main entry;
    class styleCss,controls,animate,renderer,manifold,exportM,loader,outline,thicken,fxaa,outlineVert,outlineFrag,thickenVert,thickenFrag,plusSvg,minusSvg,wasm local;
    class threePkg,twrlPkg,manifoldPkg,jscadPkg,fflatePkg external;
`;

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "loose",
  theme: "default",
  flowchart: {
    curve: "basis",
    htmlLabels: true,
  },
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const setupZoom = (container: HTMLDivElement, svg: SVGSVGElement) => {
  const MIN_SCALE = 0.3;
  const MAX_SCALE = 4;
  const ZOOM_STEP = 1.15;

  let scale = 1;
  let tx = 0;
  let ty = 0;

  let dragging = false;
  let dragX = 0;
  let dragY = 0;

  const applyTransform = () => {
    svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const rect = container.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    const nextScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
    if (nextScale === scale) {
      return;
    }

    const worldX = (px - tx) / scale;
    const worldY = (py - ty) / scale;

    scale = nextScale;
    tx = px - worldX * scale;
    ty = py - worldY * scale;

    applyTransform();
  };

  const resetZoom = () => {
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  };

  container.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomAt(event.clientX, event.clientY, factor);
  });

  container.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    dragging = true;
    dragX = event.clientX;
    dragY = event.clientY;
    container.setPointerCapture(event.pointerId);
  });

  container.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }
    tx += event.clientX - dragX;
    ty += event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
    applyTransform();
  });

  container.addEventListener("pointerup", (event) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    container.releasePointerCapture(event.pointerId);
  });

  container.addEventListener("pointercancel", (event) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    container.releasePointerCapture(event.pointerId);
  });

  const zoomInButton = document.querySelector("#zoom-in");
  const zoomOutButton = document.querySelector("#zoom-out");
  const resetButton = document.querySelector("#zoom-reset");

  if (zoomInButton instanceof HTMLButtonElement) {
    zoomInButton.addEventListener("click", () => {
      const rect = container.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, ZOOM_STEP);
    });
  }

  if (zoomOutButton instanceof HTMLButtonElement) {
    zoomOutButton.addEventListener("click", () => {
      const rect = container.getBoundingClientRect();
      zoomAt(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        1 / ZOOM_STEP,
      );
    });
  }

  if (resetButton instanceof HTMLButtonElement) {
    resetButton.addEventListener("click", resetZoom);
  }

  applyTransform();
};

const render = async () => {
  const graph = document.querySelector("#graph");
  if (!(graph instanceof HTMLDivElement)) {
    throw new Error("Graph container '#graph' was not found.");
  }

  const { svg } = await mermaid.render("palagg-dependency-graph", graphMarkup);
  graph.innerHTML = svg;

  const svgElement = graph.querySelector("svg");
  if (!(svgElement instanceof SVGSVGElement)) {
    throw new Error("Graph SVG was not generated.");
  }

  setupZoom(graph, svgElement);
};

const boot = () => {
  render().catch((error) => {
    const graph = document.querySelector("#graph");
    if (graph instanceof HTMLDivElement) {
      graph.innerHTML = `<pre>Failed to render graph: ${String(error)}</pre>`;
    }
    console.error(error);
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
