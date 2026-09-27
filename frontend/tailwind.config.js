/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          200: '#c7d6ff',
          300: '#a4b8fd',
          400: '#7c91f9',
          500: '#5a67f2',
          600: '#4549e6',
          700: '#3a3bcb',
          800: '#3034a4',
          900: '#2d3282',
          950: '#1b1d4d',
        },
        surface: {
          DEFAULT: '#0f1117',
          800: '#1a1d2e',
          900: '#0f1117',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'hero-glow': 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(90,103,242,0.25) 0%, transparent 70%)',
      },
    },
  },
  plugins: [],
}
