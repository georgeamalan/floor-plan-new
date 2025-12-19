/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111827',
        slate: {
          950: '#0b1220',
        },
        accent: '#2563eb',
        sand: '#f6f5f1',
      },
      boxShadow: {
        shell: '0 12px 40px rgba(15,23,42,0.12)',
      },
    },
  },
  plugins: [],
}
