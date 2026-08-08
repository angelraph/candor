import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        ink: "#0b0e14",
        paper: "#f7f6f2",
        candor: {
          50: "#eefcf3",
          100: "#d7f6e2",
          400: "#3fbf7f",
          500: "#22a866",
          600: "#178a52",
        },
        warn: "#d99a1b",
        danger: "#d1453d",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
