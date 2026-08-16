/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans Variable', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      fontVariantNumeric: {
        'tabular-nums': 'tabular-nums',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        popIn: {
          '0%': { opacity: '0', transform: 'scale(0.85)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        heartbeat: {
          '0%, 100%': { transform: 'scale(1)' },
          '15%': { transform: 'scale(1.15)' },
          '30%': { transform: 'scale(1)' },
          '45%': { transform: 'scale(1.1)' },
          '60%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.25s ease-out',
        'pop-in': 'popIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        heartbeat: 'heartbeat 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
