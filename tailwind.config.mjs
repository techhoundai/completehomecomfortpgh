/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,ts,md}"],
  theme: {
    extend: {
      colors: {
        "chc-red": {
          DEFAULT: "#E53935",
          light: "#EF5350",
          dark: "#C62828",
        },
        "chc-blue": {
          DEFAULT: "#42A5F5",
          light: "#64B5F6",
          dark: "#1E88E5",
        },
        "chc-gray": {
          DEFAULT: "#9E9E9E",
          light: "#BDBDBD",
          dark: "#757575",
        },
        header: "#1B2A3D",
        "header-deep": "#0F1A2A",
        footer: "#1B2A3D",
        heading: "#1A1A1A",
        body: "#4A4A4A",
        muted: "#757575",
        surface: "#F5F5F5",
        "surface-dark": "#EEEEEE",
        "card-border": "#E0E0E0",
        divider: "#E0E0E0",
        "input-border": "#CCCCCC",
      },
      fontFamily: {
        heading: ["Montserrat", "Inter", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
      maxWidth: {
        container: "1200px",
      },
      boxShadow: {
        card: "0 12px 30px rgba(0, 0, 0, 0.08)",
        "card-sm": "0 8px 20px rgba(0, 0, 0, 0.08)",
        "card-lg": "0 8px 24px rgba(0, 0, 0, 0.08)",
        header: "0 2px 10px rgba(0, 0, 0, 0.3)",
        dropdown: "0 8px 30px rgba(0, 0, 0, 0.3)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
