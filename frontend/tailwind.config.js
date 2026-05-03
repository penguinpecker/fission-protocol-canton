/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        fission: {
          bg: "#131318",
          "surface-low": "#1b1b20",
          surface: "#1f1f25",
          "surface-high": "#2a292f",
          "surface-highest": "#35343a",
          "surface-bright": "#39383e",
          green: "#00ff88",
          "green-dim": "#00e479",
          orange: "#ff6b35",
          purple: "#a855f7",
          pink: "#ff4994",
          "on-surface": "#e4e1e9",
          "on-primary": "#003919",
          "outline-var": "#3b4b3d",
        },
      },
      fontFamily: {
        headline: ['"Space Grotesk"', "sans-serif"],
        body: ['"Manrope"', "sans-serif"],
        label: ['"Space Mono"', "monospace"],
      },
      animation: {
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        float: "float 3s ease-in-out infinite",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(0, 255, 136, 0.1)" },
          "50%": { boxShadow: "0 0 40px rgba(0, 255, 136, 0.25)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
    },
  },
  plugins: [],
};
