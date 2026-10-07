function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type Slider = Readonly<Record<string, unknown> & { marks: Readonly<Record<string, unknown>> }>;

export function isSlider(value: unknown): value is Slider {
  return isRecord(value) && isRecord(value.marks) && 'step' in value;
}

/** A mark's number as `-p` spells it. */
export function sliderMarkLabel(mark: unknown): string {
  return String(isRecord(mark) ? mark.value : mark);
}

/**
 * The slider Marquee Web sends once a mark is chosen: the mark as both its value
 * and default, in Web's key order, which keys the saved configuration.
 */
export function selectSliderMark(slider: Slider, mark: unknown): Slider {
  return { defaultValue: mark, marks: slider.marks, step: slider.step, value: mark };
}

export function unwrapSliderValue(value: unknown): unknown {
  if (!isSlider(value)) return value;
  const inner = value.value ?? value.defaultValue;
  if (isRecord(inner) && 'value' in inner) {
    return inner.value;
  }
  return value;
}
