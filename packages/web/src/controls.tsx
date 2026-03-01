import plusIcon from "./plus.svg?raw";
import minusIcon from "./minus.svg?raw";

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
