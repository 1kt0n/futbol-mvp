/** @type {import('tailwindcss').Config} */
// Paleta muestreada del archivo de marca (ver BRAND.md; mismos valores que las variables de
// src/styles/index.css). En formato rgb + <alpha-value> para poder usar `bg-gold/20`, etc.
const c = (r, g, b) => `rgb(${r} ${g} ${b} / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        night: c(4, 1, 30),
        indigo: { 900: c(13, 1, 46), 800: c(18, 2, 54), 700: c(27, 2, 70) },
        glow: c(54, 7, 119),
        gold: { DEFAULT: c(255, 192, 0), deep: c(228, 159, 43), light: c(246, 211, 129) },
        silver: c(201, 203, 216),
        bronze: c(208, 138, 78),
        live: c(235, 33, 81),
      },
      fontFamily: {
        display: ['Montserrat', 'system-ui', 'sans-serif'],
        body: ['Montserrat', 'system-ui', 'sans-serif'],
        board: ['"Big Shoulders Display"', 'Impact', 'sans-serif'],
        script: ['"Kaushan Script"', 'cursive'],
      },
    },
  },
  plugins: [],
}
