/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0f1117',
          card: '#1a1d2e',
          border: '#2a2d3e',
          text: '#e0e0e0',
          muted: '#8888aa',
          accent: '#6c63ff',
        },
      },
    },
  },
  plugins: [],
};
