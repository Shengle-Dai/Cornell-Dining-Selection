/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'cornell-red': '#B31B1B',
      },
      fontFamily: {
        serif: ['"Palatino Linotype"', '"Book Antiqua"', 'Palatino', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
