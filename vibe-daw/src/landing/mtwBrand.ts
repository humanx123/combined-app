/** Original monoline lettering. Keep dots separate for independent motion. */
export const BRAND_GLYPHS: Record<string, { width: number; path: string }> = {
  M: { width: 90, path: "M10 92V10L45 53L80 10V92" },
  u: { width: 68, path: "M10 34V72Q10 91 29 91H58V34" },
  s: { width: 64, path: "M55 35H27Q10 35 10 48Q10 59 27 62L39 64Q55 67 55 79Q55 91 38 91H10" },
  i: { width: 29, path: "M14 35V92" },
  c: { width: 64, path: "M55 41L47 34H28Q10 34 10 52V73Q10 91 28 91H47L55 84" },
  T: { width: 80, path: "M7 10H73M40 10V92" },
  h: { width: 68, path: "M10 10V92M10 56Q10 34 30 34H39Q58 34 58 53V92" },
  e: { width: 68, path: "M10 61H58V52Q58 34 40 34H28Q10 34 10 52V73Q10 91 28 91H46L56 83" },
  o: { width: 70, path: "M28 34H42Q60 34 60 52V73Q60 91 42 91H28Q10 91 10 73V52Q10 34 28 34Z" },
  r: { width: 57, path: "M10 92V34H29Q46 34 46 52" },
  y: { width: 68, path: "M8 34L33 88M59 34L32 99Q27 112 11 112" },
  W: { width: 106, path: "M8 10L27 92L53 47L79 92L98 10" },
  k: { width: 66, path: "M10 10V92M55 35L12 68M30 55L59 92" },
  ".": { width: 29, path: "" },
};
export const MONOGRAM_PATHS = [
  "M120 176V76L256 174L392 76V176",
  "M120 242H392M256 242V308",
  "M120 346L182 442L256 362L330 442L392 346",
];
