"use client";

interface SparklineProps {
  /** Array of 14 values (posts per day, oldest first) */
  data: number[];
  width?: number;
  height?: number;
}

export default function Sparkline({
  data,
  width = 56,
  height = 20,
}: SparklineProps) {
  const max = Math.max(...data, 1);
  const barCount = data.length;
  const gap = 1;
  const barWidth = (width - gap * (barCount - 1)) / barCount;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
    >
      {data.map((value, i) => {
        const barHeight = Math.max((value / max) * height, value > 0 ? 2 : 0);
        const x = i * (barWidth + gap);
        const y = height - barHeight;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            rx={1}
            fill={value > 0 ? "var(--color-accent)" : "var(--color-card-border)"}
            opacity={value > 0 ? 0.7 : 0.3}
          />
        );
      })}
    </svg>
  );
}
