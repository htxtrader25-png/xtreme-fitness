/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Operational command-center palette (dark, high-contrast)
        panel: {
          900: '#0b1220',
          800: '#111a2e',
          700: '#182238',
          600: '#1f2c47',
          500: '#2a3a5c',
        },
        accent: {
          DEFAULT: '#38bdf8',
          soft: '#0ea5e9',
        },
        // Fleet colors
        atlas: '#3b82f6',
        titan: '#a855f7',
        orion: '#f59e0b',
        tank: '#10b981',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        pulseSoft: 'pulseSoft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
