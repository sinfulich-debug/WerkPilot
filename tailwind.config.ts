import type { Config } from 'tailwindcss';

// Design tokens.
// `slate` is redefined as one neutral ramp with a slight warm tint (workshop concrete, not cold blue-grey),
// so every existing slate-* class picks it up. `accent` is signal orange, used rarely: focus, active nav,
// the one figure that matters. Primary buttons are ink (slate-900), not accent.
const neutral = {
  50: '#fafaf9',
  100: '#f3f2f0',
  200: '#e6e5e2',
  300: '#d4d2ce',
  400: '#a6a39d',
  500: '#75726c',
  600: '#57544e',
  700: '#413e3a',
  800: '#2a2825',
  900: '#1c1b19',
  950: '#121110',
};

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        slate: neutral,
        accent: {
          50: '#fff5ed',
          100: '#ffe8d5',
          500: '#f2620f',
          600: '#d9530a',
          700: '#b8430a',
          800: '#94370c',
        },
        plate: {
          eu: '#003399',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        lg: '6px',
        xl: '8px',
        '2xl': '10px',
        '3xl': '14px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(28, 27, 25, 0.05)',
        soft: '0 1px 2px rgba(28, 27, 25, 0.05)',
        lg: '0 8px 24px rgba(28, 27, 25, 0.06)',
        '2xl': '0 24px 48px -16px rgba(28, 27, 25, 0.22)',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.22, 1, 0.36, 1)',
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        DEFAULT: '160ms',
      },
    },
  },
  plugins: [],
};

export default config;
