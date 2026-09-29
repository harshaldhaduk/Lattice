/** Clockwise rounded outline, beginning and ending at the bottom midpoint. */
export function focusPerimeter(width: number, height: number, radius = 6) {
  const inset = 0.75;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= inset * 2 ||
    height <= inset * 2
  )
    return "";
  const left = inset,
    top = inset,
    right = width - inset,
    bottom = height - inset;
  const r = Math.max(
    0,
    Math.min(radius, (right - left) / 2, (bottom - top) / 2),
  );
  return `M ${width / 2} ${bottom} H ${left + r} Q ${left} ${bottom} ${left} ${bottom - r} V ${top + r} Q ${left} ${top} ${left + r} ${top} H ${right - r} Q ${right} ${top} ${right} ${top + r} V ${bottom - r} Q ${right} ${bottom} ${right - r} ${bottom} H ${width / 2} Z`;
}
