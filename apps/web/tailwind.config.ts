import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  // Forced on (see <html class="dark"> in layout.tsx) rather than following
  // system preference — Candor commits to one look, matched to OKX's own
  // black + lime brand (sampled live from okx.com/agent-tradekit), instead
  // of rendering differently depending on a judge's OS theme.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: "#000000",
        paper: "#fafafa",
        // OKX's signature accent lime, sampled from agent-tradekit's hero
        // copy (rgb(188,255,47)). Bright enough to need dark text on top of
        // a solid fill — see the two "text-black" buttons in
        // ConfirmCardView that pair with candor-500.
        candor: {
          50: "#f4ffdb",
          100: "#e7ffb8",
          400: "#d4ff70",
          500: "#bcff2f",
          600: "#96cc22",
        },
        warn: "#d99a1b",
        danger: "#d1453d",
      },
      fontFamily: {
        // Matches OKX's own declared stack (OKXSans is a licensed brand font
        // we don't have access to, so we take their fallback chain as-is)
        // merged with system-ui/ui-sans-serif so Windows/Linux still render
        // their native UI font instead of falling through to Arial.
        sans: [
          "apple-system",
          "BlinkMacSystemFont",
          "ui-sans-serif",
          "system-ui",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
