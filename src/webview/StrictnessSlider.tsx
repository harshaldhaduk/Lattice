import React, { useId } from "react";
import { Shield } from "lucide-react";

export function StrictnessSlider({
  value,
  change,
  explain = false,
}: {
  value: number;
  change: (value: number) => void;
  explain?: boolean;
}) {
  const id = useId();
  const rounded = Math.round(value);
  return (
    <div className="sensitivity-control">
      <label htmlFor={id}>
        <Shield size={13} /> Agent coordination strictness
        <output htmlFor={id}>
          <span key={rounded} className="sensitivity-value">
            {rounded}
          </span>{" "}
          / 10
        </output>
      </label>
      <input
        id={id}
        type="range"
        min="1"
        max="10"
        step="0.1"
        value={value}
        style={
          {
            "--range-fill": `${Math.max(0, Math.min(100, ((value - 1) / 9) * 100))}%`,
          } as React.CSSProperties
        }
        aria-label="Agent coordination strictness"
        aria-valuetext={`${rounded} out of 10`}
        aria-describedby={explain ? `${id}-description` : undefined}
        onChange={(event) => change(Number(event.target.value))}
        onKeyDown={(event) => {
          // Dragging remains continuous; arrow keys select meaningful whole levels.
          if (
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          const direction =
            event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
          change(Math.max(1, Math.min(10, rounded + direction)));
        }}
      />
      <div className="sensitivity-scale">
        <span>1 · Fewer interruptions</span>
        <span>10 · More cautious</span>
      </div>
      {explain && (
        <p id={`${id}-description`}>
          Before an agent starts, check its prompt against active work. Higher
          settings flag broader overlaps. Clear file conflicts are flagged at
          every level.
        </p>
      )}
    </div>
  );
}
