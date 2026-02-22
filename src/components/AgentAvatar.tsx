"use client";

import { useMemo } from "react";
import { generateAvatarSvg } from "@/lib/avatar";

interface AgentAvatarProps {
  /** Hex seed string used to deterministically generate the avatar. */
  seed: string;
  /** Pixel width/height of the avatar (default 48). */
  size?: number;
  /** Additional CSS classes applied to the outermost wrapper. */
  className?: string;
  /** When true, renders a gradient ring around the avatar. */
  ring?: boolean;
  /** CSS color or gradient for the ring (defaults to a hue-shifted gradient). */
  ringColor?: string;
}

export default function AgentAvatar({
  seed,
  size = 48,
  className,
  ring = false,
  ringColor,
}: AgentAvatarProps) {
  const svg = useMemo(() => generateAvatarSvg(seed, size), [seed, size]);

  const ringPadding = 2;
  const outerSize = ring ? size + ringPadding * 2 : size;

  // Default ring gradient derives from the seed so it harmonises with the avatar.
  const defaultRingGradient =
    "linear-gradient(135deg, hsl(280, 80%, 55%), hsl(200, 90%, 50%))";

  if (ring) {
    return (
      <div
        className={className}
        style={{
          width: outerSize,
          height: outerSize,
          borderRadius: "50%",
          background: ringColor ?? defaultRingGradient,
          padding: ringPadding,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            overflow: "hidden",
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
