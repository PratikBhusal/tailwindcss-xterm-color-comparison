import Color from "colorjs.io";
import tailwindColors from "tailwindcss/colors";
import xterm16Colors from "./16-colors.json" with { type: "json" };
import xterm256Colors from "./256-colors.json" with { type: "json" };

const target_hex_string: string = "#191919";
const target = new Color(target_hex_string);
const TOP_N = 5;
// Set to a color temperature (e.g. 1500) for Bradford adaptation from D65, or null for standard D65.
const illuminantKelvin: number | null = null;

type Tristimulus = [number, number, number];
type ChromaticMatrix = [Tristimulus, Tristimulus, Tristimulus];

// CIE xy chromaticity from correlated color temperature (Kang et al. 2002)
function cctToXy(K: number): [number, number] {
  let x: number;
  if (K <= 4000) {
    x = -0.2661239e9 / (K * K * K) - 0.2343589e6 / (K * K) + 0.8776956e3 / K + 0.179910;
  } else {
    x = -3.0258469e9 / (K * K * K) + 2.1070379e6 / (K * K) + 0.2226347e3 / K + 0.24039;
  }
  let y: number;
  if (K <= 2222) {
    y = -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683;
  } else if (K <= 4000) {
    y = -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867;
  } else {
    y = 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
  }
  return [x, y];
}

function xyToXYZ(x: number, y: number): Tristimulus {
  return [x / y, 1, (1 - x - y) / y];
}

const BRADFORD: ChromaticMatrix = [
  [ 0.8951,  0.2664, -0.1614],
  [-0.7502,  1.7135,  0.0367],
  [ 0.0389, -0.0685,  1.0296],
];

const BRADFORD_INV: ChromaticMatrix = [
  [ 0.9869929, -0.1470543,  0.1599627],
  [ 0.4323053,  0.5183603,  0.0492912],
  [-0.0085287,  0.0400428,  0.9684867],
];

function mulChromaticMatrixTristimulus(m: ChromaticMatrix, v: Tristimulus): Tristimulus {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function mulChromaticMatrix(a: ChromaticMatrix, b: ChromaticMatrix): ChromaticMatrix {
  const r: ChromaticMatrix = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}

function diagChromaticMatrix(d: Tristimulus): ChromaticMatrix {
  return [[d[0],0,0],[0,d[1],0],[0,0,d[2]]];
}

// D65 standard illuminant in XYZ
const D65_XYZ: Tristimulus = [0.95047, 1.0, 1.08883];

function bradfordAdaptationMatrix(srcWP: Tristimulus, dstWP: Tristimulus): ChromaticMatrix {
  const srcCone = mulChromaticMatrixTristimulus(BRADFORD, srcWP);
  const dstCone = mulChromaticMatrixTristimulus(BRADFORD, dstWP);
  const scale: Tristimulus = [dstCone[0] / srcCone[0], dstCone[1] / srcCone[1], dstCone[2] / srcCone[2]];
  return mulChromaticMatrix(BRADFORD_INV, mulChromaticMatrix(diagChromaticMatrix(scale), BRADFORD));
}

function adaptColor(color: Color, dstWP: Tristimulus): Color {
  const xyz = color.to("xyz-d65").coords as Tristimulus;
  const M = bradfordAdaptationMatrix(D65_XYZ, dstWP);
  const adapted = mulChromaticMatrixTristimulus(M, xyz);
  return new Color("xyz-d65", adapted);
}

function adaptedColor(color: Color): Color {
  if (illuminantKelvin === null) return color;
  const [cx, cy] = cctToXy(illuminantKelvin);
  return adaptColor(color, xyToXYZ(cx, cy));
}

function toOklch(color: Color): Tristimulus {
  return adaptedColor(color).to("oklch").coords as Tristimulus;
}

function nearestXtermIndex(color: Color, palette: typeof xterm256Colors): number {
  let bestIndex = 0;
  let bestDelta = Infinity;
  for (const entry of palette) {
    const d = color.deltaEOK(new Color(entry.hexString));
    if (d < bestDelta) {
      bestDelta = d;
      bestIndex = entry.colorId;
    }
  }
  return bestIndex;
}

const closestXterm16 = xterm16Colors
  .map((entry) => ({
    index: entry.colorId,
    hex: entry.hexString,
    name: entry.name,
    deltaE: target.deltaEOK(new Color(entry.hexString)),
  }))
  .sort((a, b) => a.deltaE - b.deltaE)
  .slice(0, TOP_N);

const closestXterm256 = xterm256Colors
  .map((entry) => ({
    index: entry.colorId,
    hex: entry.hexString,
    name: entry.name,
    deltaE: target.deltaEOK(new Color(entry.hexString)),
  }))
  .sort((a, b) => a.deltaE - b.deltaE)
  .slice(0, TOP_N);

const skipKeys = new Set(["inherit", "current", "transparent"]);
const closestTailwind = Object.entries(tailwindColors)
  .filter(([name]) => !skipKeys.has(name))
  .flatMap(([name, shades]) =>
    typeof shades === "string"
      ? [{ name, shade: "", value: shades, deltaE: target.deltaEOK(new Color(shades)) }]
      : Object.entries(shades as Record<string, string>).map(([shade, value]) => ({
          name,
          shade,
          value,
          deltaE: target.deltaEOK(new Color(value)),
        })),
  )
  .sort((a, b) => a.deltaE - b.deltaE)
  .slice(0, TOP_N);


const sampleText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis a convallis ante,vel volutpat risus. In vitae sapien a sapien";

const targetXterm256Idx = nearestXtermIndex(adaptedColor(target), xterm256Colors);
const [tL, tC, tH] = toOklch(target);
const illuminantLabel = illuminantKelvin === null ? "D65" : `${illuminantKelvin}K`;
console.log(`Illuminant: ${illuminantLabel}`);
console.log(`Original color (${target_hex_string}) — oklch(${((tL ?? 0) * 100).toFixed(4)}%, ${(tC ?? 0).toFixed(4)}, ${(tH ?? 0).toFixed(4)}):`);
console.log(`     \x1b[38;5;${targetXterm256Idx}m${sampleText}\x1b[0m\n`);

function formatOklch(color: Color): string {
  const [L, C, H] = color.to("oklch").coords;
  return `oklch(${((L ?? 0) * 100).toFixed(4)}%, ${(C ?? 0).toFixed(4)}, ${(H ?? 0).toFixed(4)})`;
}

// console.log("Closest xterm-16 colors:");
// closestXterm16.forEach((c, i) => {
//   const adapted = adaptedColor(new Color(c.hex));
//   const idx = nearestXtermIndex(adapted, xterm16Colors);
//   console.log(`  ${i + 1}. [${c.index}] ${c.name} (${c.hex}) — ${formatOklch(adapted)} — ΔE ${c.deltaE.toFixed(4)}`);
//   console.log(`     \x1b[38;5;${idx}m${sampleText}\x1b[0m`);
// });

console.log("\nClosest xterm-256 colors:");
closestXterm256.forEach((c, i) => {
  const adapted = adaptedColor(new Color(c.hex));
  const idx = nearestXtermIndex(adapted, xterm256Colors);
  console.log(`  ${i + 1}. [${c.index}] ${c.name} (${c.hex}) — ${formatOklch(adapted)} — ΔE ${c.deltaE.toFixed(4)}`);
  console.log(`     \x1b[38;5;${idx}m${sampleText}\x1b[0m`);
});

console.log("\nClosest Tailwind colors:");
closestTailwind.forEach((c, i) => {
  const idx = nearestXtermIndex(adaptedColor(new Color(c.value)), xterm256Colors);
  console.log(`  ${i + 1}. ${c.name}-${c.shade || "(base)"} (${c.value}) — ΔE ${c.deltaE.toFixed(4)}`);
  console.log(`     \x1b[38;5;${idx}m${sampleText}\x1b[0m`);
});
