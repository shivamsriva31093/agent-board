/**
 * Deterministic SVG avatar generator.
 *
 * Given a hex seed string (e.g. an agent's avatar_seed), produces a unique
 * geometric avatar that is always identical for the same seed.
 */

function hexToNumbers(hex: string): number[] {
  const nums: number[] = [];
  const clean = hex.replace(/^0x/, "");
  for (let i = 0; i + 1 < clean.length; i += 2) {
    nums.push(parseInt(clean.slice(i, i + 2), 16) || 0);
  }
  // Ensure we always have at least 12 bytes to work with by cycling.
  while (nums.length < 12) {
    nums.push(nums[nums.length % Math.max(nums.length, 1)] ?? 0);
  }
  return nums;
}

/**
 * Generate a deterministic SVG avatar string from a hex seed.
 *
 * @param seed  Hex string (e.g. "a4f2b1c8...")
 * @param size  Pixel width/height of the SVG (default 48)
 * @returns     A complete SVG string with xmlns attribute
 */
export function generateAvatarSvg(seed: string, size = 48): string {
  const nums = hexToNumbers(seed);

  // --- Derive colours -------------------------------------------------------
  const hue1 = (nums[0] * 360) / 255;
  const hue2 = (hue1 + 120 + nums[1]) % 360;
  const color1 = `hsl(${hue1.toFixed(1)}, 70%, 50%)`;
  const color2 = `hsl(${hue2.toFixed(1)}, 70%, 40%)`;
  const bgColor = `hsl(${hue1.toFixed(1)}, 30%, 12%)`;

  const r = size / 2;
  const shapes: string[] = [];

  // --- Background circle ----------------------------------------------------
  shapes.push(
    `<circle cx="${r}" cy="${r}" r="${r}" fill="${bgColor}" />`
  );

  // --- Geometric shapes (3-4 based on seed) ---------------------------------
  const shapeCount = 3 + (nums[2] % 2); // 3 or 4

  for (let i = 0; i < shapeCount; i++) {
    const base = 3 + i * 2; // offset into nums array
    const n0 = nums[base % nums.length];
    const n1 = nums[(base + 1) % nums.length];

    const cx = (n0 / 255) * size * 0.6 + size * 0.2;
    const cy = (n1 / 255) * size * 0.6 + size * 0.2;
    const fill = i % 2 === 0 ? color1 : color2;
    const opacity = (0.5 + (n0 % 128) / 255).toFixed(2);
    const shapeType = nums[(base + i) % nums.length] % 3;

    if (shapeType === 0) {
      // Circle
      const cr = size * 0.08 + (n1 / 255) * size * 0.18;
      shapes.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${cr.toFixed(1)}" fill="${fill}" opacity="${opacity}" />`
      );
    } else if (shapeType === 1) {
      // Rotated rectangle
      const w = size * 0.1 + (n0 / 255) * size * 0.2;
      const h = size * 0.1 + (n1 / 255) * size * 0.15;
      const angle = (nums[(base + 2) % nums.length] / 255) * 360;
      shapes.push(
        `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" ` +
          `width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" ` +
          `fill="${fill}" opacity="${opacity}" ` +
          `transform="rotate(${angle.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})" />`
      );
    } else {
      // Triangle (polygon)
      const s = size * 0.1 + (n0 / 255) * size * 0.15;
      const angle = ((nums[(base + 2) % nums.length] / 255) * Math.PI * 2);
      const pts = [0, 1, 2]
        .map((k) => {
          const a = angle + (k * Math.PI * 2) / 3;
          return `${(cx + Math.cos(a) * s).toFixed(1)},${(cy + Math.sin(a) * s).toFixed(1)}`;
        })
        .join(" ");
      shapes.push(
        `<polygon points="${pts}" fill="${fill}" opacity="${opacity}" />`
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    // Clip everything to a circle so edges are clean.
    `<clipPath id="clip"><circle cx="${r}" cy="${r}" r="${r}" /></clipPath>`,
    `<g clip-path="url(#clip)">`,
    ...shapes,
    `</g>`,
    `</svg>`,
  ].join("");
}
