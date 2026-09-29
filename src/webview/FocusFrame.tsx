import React, { useLayoutEffect, useRef, useState } from "react";
import { focusPerimeter } from "./focus-perimeter";

// A real rounded rectangle: pathLength normalizes the perimeter at any size,
// so the focus stroke draws clockwise from one point without a rotating glow.
export function FocusFrame({
  children,
  className = "",
  as: Tag = "span",
  hover = false,
  radius = 6,
}: {
  children: React.ReactNode;
  className?: string;
  as?: "span" | "div" | "article";
  hover?: boolean;
  radius?: number;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const interaction = useRef({ focus: false, hover: false });
  const [traceKey, setTraceKey] = useState(0);
  const interact = (kind: "focus" | "hover", enabled: boolean) => {
    const before = interaction.current.focus || interaction.current.hover;
    interaction.current[kind] = enabled;
    if (!before && (interaction.current.focus || interaction.current.hover))
      setTraceKey((key) => key + 1);
  };
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const resize = (width: number, height: number) =>
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    resize(node.offsetWidth, node.offsetHeight);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      resize(
        box?.inlineSize ?? node.offsetWidth,
        box?.blockSize ?? node.offsetHeight,
      );
    });
    observer.observe(node, { box: "border-box" });
    return () => observer.disconnect();
  }, []);
  const path = focusPerimeter(size.width, size.height, radius);
  return (
    <Tag
      ref={(node) => {
        ref.current = node;
      }}
      className={`focus-frame ${hover ? "perimeter-hover" : ""} ${className}`}
      onMouseEnter={() => {
        if (hover) interact("hover", true);
      }}
      onMouseLeave={() => {
        if (hover) interact("hover", false);
      }}
      onFocusCapture={() => interact("focus", true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          interact("focus", false);
      }}
    >
      {children}
      <svg
        className="focus-trace"
        key={traceKey}
        aria-hidden="true"
        focusable="false"
        width="100%"
        height="100%"
      >
        <path
          className="perimeter-glow"
          d={path}
          pathLength="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          className="perimeter-line"
          d={path}
          pathLength="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </Tag>
  );
}
