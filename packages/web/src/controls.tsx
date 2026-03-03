import plusIcon from "./plus.svg?raw";
import minusIcon from "./minus.svg?raw";
import type { EmojiPreset } from "./model/emoji";

export const rangeControl = (
  id: string,
  opts: {
    name: string;
    min: string;
    max: string;
    sliderMin: string;
    sliderMax: string;
  },
): {
  wrapper: HTMLElement;
  range: HTMLInputElement;
  input: HTMLInputElement;
} => {
  const range = (
    <input
      type="range"
      id={`${id}-range`}
      min={opts.min}
      max={opts.max}
      aria-label={`${opts.name} slider`}
    />
  ) as HTMLInputElement;

  const input = (
    <input
      type="number"
      id={id}
      name={id}
      min={opts.sliderMin}
      max={opts.sliderMax}
      aria-label={opts.name}
    />
  ) as HTMLInputElement;

  const wrapper = (
    <div className="range-input-wrapper">
      <label htmlFor={id}>{opts.name}</label>
      {range}
      <div className="range-input-value">{input}</div>
    </div>
  );

  return { wrapper, range, input };
};

export const toggleControl = (
  name: string,
  opts: { options: { value: string; label: string }[] },
): { wrapper: HTMLElement; inputs: HTMLInputElement[] } => {
  const inputs: HTMLInputElement[] = [];

  const options = opts.options.map((o, i) => {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = o.value;
    if (i === 0) input.defaultChecked = true;
    inputs.push(input);

    const span = document.createElement("span");
    span.textContent = o.label;

    const label = document.createElement("label");
    label.className = "toggle-option";
    label.append(input, span);
    return label;
  });

  const group = document.createElement("div");
  group.className = "toggle-group";
  group.append(...options);

  const wrapper = document.createElement("div");
  wrapper.className = "toggle-wrapper";
  wrapper.append(group);

  return { wrapper, inputs };
};

export const stepper = (
  id: string,
  opts: { min: string; max: string; label: string },
) => (
  <div className="stepper-input-wrapper">
    <label htmlFor={id}>{opts.label}</label>
    <button
      type="button"
      id={`${id}-minus`}
      innerHTML={minusIcon}
      aria-label="Remove level"
    ></button>
    <div className="stepper-input-value">
      <input type="number" id={id} name={id} min={opts.min} max={opts.max} />
    </div>
    <button
      type="button"
      id={`${id}-plus`}
      innerHTML={plusIcon}
      aria-label="Add level"
    ></button>
  </div>
);

export const textInput = (
  id: string,
  opts: { label: string; placeholder: string },
): { wrapper: HTMLElement; input: HTMLInputElement; counter: HTMLElement } => {
  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.name = id;
  input.placeholder = opts.placeholder;
  input.autocomplete = "off";

  const counter = document.createElement("span");
  counter.className = "text-input-counter";

  const inputRow = document.createElement("div");
  inputRow.className = "text-input-field";
  inputRow.append(input, counter);

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = opts.label;

  const wrapper = document.createElement("div");
  wrapper.className = "text-input-wrapper";
  wrapper.append(label, inputRow);

  return { wrapper, input, counter };
};

export const emojiPicker = (
  id: string,
  presets: EmojiPreset[],
): {
  wrapper: HTMLElement;
  buttons: HTMLButtonElement[];
  grid: HTMLDivElement;
  moreButton: HTMLButtonElement;
} => {
  const buttons: HTMLButtonElement[] = [];

  const grid = document.createElement("div");
  grid.className = "emoji-grid";

  for (const preset of presets) {
    const btn = createEmojiButton(preset);
    buttons.push(btn);
    grid.appendChild(btn);
  }

  // "+" button at the end of the grid
  const moreButton = document.createElement("button");
  moreButton.type = "button";
  moreButton.className = "emoji-more-btn";
  moreButton.title = "Search icons";
  moreButton.setAttribute("aria-label", "Search icons");
  const plusSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  plusSvg.setAttribute("viewBox", "0 0 24 24");
  plusSvg.setAttribute("fill", "none");
  plusSvg.setAttribute("stroke", "currentColor");
  plusSvg.setAttribute("stroke-width", "2.5");
  plusSvg.setAttribute("width", "18");
  plusSvg.setAttribute("height", "18");
  const plusLine1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  plusLine1.setAttribute("x1", "12");
  plusLine1.setAttribute("y1", "5");
  plusLine1.setAttribute("x2", "12");
  plusLine1.setAttribute("y2", "19");
  const plusLine2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  plusLine2.setAttribute("x1", "5");
  plusLine2.setAttribute("y1", "12");
  plusLine2.setAttribute("x2", "19");
  plusLine2.setAttribute("y2", "12");
  plusSvg.append(plusLine1, plusLine2);
  moreButton.appendChild(plusSvg);
  grid.appendChild(moreButton);

  const label = document.createElement("label");
  label.textContent = "Icon";
  label.id = `${id}-label`;

  const wrapper = document.createElement("div");
  wrapper.className = "emoji-picker-wrapper";
  wrapper.append(label, grid);

  return { wrapper, buttons, grid, moreButton };
};

function createEmojiButton(preset: EmojiPreset): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.emojiId = preset.id;
  btn.title = preset.label;
  btn.setAttribute("aria-label", preset.label);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", preset.viewBox.join(" "));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", preset.svg);
  svg.appendChild(path);
  btn.appendChild(svg);

  return btn;
}

/** Insert a new emoji button into the grid (before the "+" button) */
export function addEmojiButton(
  grid: HTMLDivElement,
  moreButton: HTMLButtonElement,
  preset: EmojiPreset,
): HTMLButtonElement {
  const btn = createEmojiButton(preset);
  grid.insertBefore(btn, moreButton);
  return btn;
}

