/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tinta: "#252a2e",
        papel: "#f8f5ef",
        linea: "#d8d1c5",
        acento: "#0f766e",
        vino: "#8a2d3c",
        aviso: "#b45309"
      }
    }
  },
  plugins: []
};
