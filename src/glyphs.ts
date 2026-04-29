export type GlyphStyle = "unicode" | "ascii"

export type QuotaGlyphs = {
  compactWindowSeparator: string
  detailSeparator: string
  ellipsis: string
  barFilled: string
  barEmpty: string
}

const unicodeGlyphs: QuotaGlyphs = {
  compactWindowSeparator: " · ",
  detailSeparator: " — ",
  ellipsis: "…",
  barFilled: "█",
  barEmpty: "░",
}

const asciiGlyphs: QuotaGlyphs = {
  compactWindowSeparator: " | ",
  detailSeparator: " - ",
  ellipsis: "...",
  barFilled: "#",
  barEmpty: "-",
}

export function normalizeGlyphStyle(value: unknown): GlyphStyle {
  return value === "ascii" ? "ascii" : "unicode"
}

export function quotaGlyphs(style: GlyphStyle = "unicode") {
  return style === "ascii" ? asciiGlyphs : unicodeGlyphs
}
