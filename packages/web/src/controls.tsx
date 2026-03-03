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
): { wrapper: HTMLElement; input: HTMLInputElement } => {
  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.name = id;
  input.placeholder = opts.placeholder;
  input.maxLength = 20;
  input.autocomplete = "off";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = opts.label;

  const wrapper = document.createElement("div");
  wrapper.className = "text-input-wrapper";
  wrapper.append(label, input);

  return { wrapper, input };
};

export const emojiPicker = (
  id: string,
  presets: EmojiPreset[],
): { wrapper: HTMLElement; buttons: HTMLButtonElement[] } => {
  const buttons: HTMLButtonElement[] = [];

  const grid = document.createElement("div");
  grid.className = "emoji-grid";

  for (const preset of presets) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.emojiId = preset.id;
    btn.title = preset.label;
    btn.setAttribute("aria-label", preset.label);

    // Render SVG icon
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", preset.viewBox.join(" "));
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", preset.svg);
    svg.appendChild(path);
    btn.appendChild(svg);

    buttons.push(btn);
    grid.appendChild(btn);
  }

  const label = document.createElement("label");
  label.textContent = "Icon";
  label.id = `${id}-label`;

  const wrapper = document.createElement("div");
  wrapper.className = "emoji-picker-wrapper";
  wrapper.append(label, grid);

  return { wrapper, buttons };
};

