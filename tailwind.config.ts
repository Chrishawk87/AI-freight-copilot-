import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0B1020",
          900: "#0B1020",
          800: "#111834",
          700: "#1A2244",
          600: "#232D57",
        },
        electric: "#246BFD",
        success: "#16C784",
        warning: "#F59E0B",
        danger: "#EF4444",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 24px -6px rgba(36,107,253,0.5)",
      },
    },
  },
  plugins: [],
};

export default config;
