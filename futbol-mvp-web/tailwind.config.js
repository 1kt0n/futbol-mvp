/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      // Escala de capas de src/design/tokens.css (rediseño UX §6.2.10).
      zIndex: {
        sticky: "var(--z-sticky)",
        tabbar: "var(--z-tabbar)",
        fab: "var(--z-fab)",
        sheet: "var(--z-sheet)",
        dialog: "var(--z-dialog)",
        menu: "var(--z-menu)",
        toast: "var(--z-toast)",
      },
    },
  },
  plugins: [],
}
