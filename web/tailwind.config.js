/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        raised: v('raised'),
        line: v('line'),
        'line-strong': v('line-strong'),
        ink: v('ink'),
        muted: v('muted'),
        faint: v('faint'),
        brand: {
          DEFAULT: v('brand'),
          strong: v('brand-strong'),
          soft: v('brand-soft'),
        },
        'on-brand': v('on-brand'),
        copper: {
          DEFAULT: v('copper'),
          soft: v('copper-soft'),
        },
        success: { DEFAULT: v('success'), soft: v('success-soft') },
        warning: { DEFAULT: v('warning'), soft: v('warning-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
        info: { DEFAULT: v('info'), soft: v('info-soft') },
        // Compatibility palette: legacy pages use Tailwind's slate/indigo
        // names, but the values resolve to the warm Navori tokens.
        slate: {
          50: v('slate-50'),
          100: v('slate-100'),
          200: v('slate-200'),
          300: v('slate-300'),
          400: v('slate-400'),
          500: v('slate-500'),
          600: v('slate-600'),
          700: v('slate-700'),
          800: v('slate-800'),
          900: v('slate-900'),
          950: v('slate-950'),
        },
        indigo: {
          50: v('indigo-50'),
          100: v('indigo-100'),
          200: v('indigo-200'),
          300: v('indigo-300'),
          400: v('indigo-400'),
          500: v('indigo-500'),
          600: v('indigo-600'),
          700: v('indigo-700'),
          800: v('indigo-800'),
          900: v('indigo-900'),
        },
        emerald: {
          50: v('emerald-50'),
          100: v('emerald-100'),
          500: v('emerald-500'),
          600: v('emerald-600'),
          700: v('emerald-700'),
        },
        red: {
          50: v('red-50'),
          100: v('red-100'),
          500: v('red-500'),
          600: v('red-600'),
          700: v('red-700'),
        },
        amber: {
          50: v('amber-50'),
          100: v('amber-100'),
          500: v('amber-500'),
          600: v('amber-600'),
          700: v('amber-700'),
        },
        blue: {
          50: v('blue-50'),
          100: v('blue-100'),
          500: v('blue-500'),
          600: v('blue-600'),
          700: v('blue-700'),
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'PingFang SC', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        md: '6px',
        lg: '8px',
        xl: '10px',
      },
      boxShadow: {
        overlay: '0 18px 48px rgba(16, 18, 16, 0.18)',
        header: '0 1px 0 rgb(var(--line))',
      },
    },
  },
  plugins: [],
}
