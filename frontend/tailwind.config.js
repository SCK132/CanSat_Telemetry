/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0f172a', // slate-900
        card: '#1e293b', // slate-800
        primary: '#38bdf8', // sky-400
        accent: '#818cf8', // indigo-400
        destructive: '#ef4444', // red-500
      }
    },
  },
  plugins: [],
}
