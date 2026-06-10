import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0E14",
        surface: "#131822",
        surface2: "#1A2130",
        line: "#1F2735",
        text: "#E8ECF4",
        muted: "#8A94A6",
        accent: "#FFB627",
        accent2: "#FFD56B",
        danger: "#FF4D5E",
        success: "#3DDC97",
        pd: "#4D9DE0",
        jackpot: "#C792EA",
      },
      fontFamily: {
        display: ["'Bricolage Grotesque'", "'Arial Black'", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        "glow-amber": "0 0 24px -4px rgba(255, 182, 39, 0.45), 0 0 64px -16px rgba(255, 182, 39, 0.25)",
        "glow-pd": "0 0 24px -4px rgba(77, 157, 224, 0.45), 0 0 64px -16px rgba(77, 157, 224, 0.25)",
        "glow-danger": "0 0 24px -4px rgba(255, 77, 94, 0.5), 0 0 64px -16px rgba(255, 77, 94, 0.3)",
        "glow-jackpot": "0 0 28px -4px rgba(199, 146, 234, 0.55), 0 0 72px -16px rgba(199, 146, 234, 0.3)",
        sheet: "0 -8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
      },
      keyframes: {
        flicker: {
          "0%, 100%": { opacity: "1" },
          "41%": { opacity: "1" },
          "42%": { opacity: "0.35" },
          "43%": { opacity: "1" },
          "78%": { opacity: "1" },
          "79%": { opacity: "0.5" },
          "80%": { opacity: "1" },
        },
        rain: {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "-80px 600px" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.85" },
          "50%": { opacity: "0.4" },
        },
        marqueeUp: {
          "0%": { transform: "translateY(100%)", opacity: "0" },
          "12%": { transform: "translateY(0)", opacity: "1" },
          "88%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(-100%)", opacity: "0" },
        },
      },
      animation: {
        flicker: "flicker 7s linear infinite",
        rain: "rain 1.1s linear infinite",
        "rain-slow": "rain 1.9s linear infinite",
        "pulse-soft": "pulseSoft 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
