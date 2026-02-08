import type { Config } from 'tailwindcss'

const withOpacity = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          0: withOpacity('--bg0-rgb'),
          1: withOpacity('--bg1-rgb'),
          2: withOpacity('--bg2-rgb'),
          3: withOpacity('--bg3-rgb'),
        },
        fg: {
          0: withOpacity('--fg0-rgb'),
          1: withOpacity('--fg1-rgb'),
          2: withOpacity('--fg2-rgb'),
          3: withOpacity('--fg3-rgb'),
        },
        bd: {
          0: withOpacity('--bd0-rgb'),
          1: withOpacity('--bd1-rgb'),
        },
        status: {
          success: withOpacity('--success-rgb'),
          warning: withOpacity('--warning-rgb'),
          danger: withOpacity('--danger-rgb'),
          error: withOpacity('--danger-rgb'),
          info: withOpacity('--info-rgb'),
          progress: withOpacity('--progress-rgb'),
          idle: withOpacity('--idle-rgb'),
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
      fontSize: {
        'page-title': ['20px', { lineHeight: '1.2', fontWeight: '600' }],
        'section-title': ['14px', { lineHeight: '1.3', fontWeight: '600' }],
        body: ['13px', { lineHeight: '1.4', fontWeight: '450' }],
        caption: ['12px', { lineHeight: '1.35', fontWeight: '450' }],
        'mono-sm': ['12px', { lineHeight: '1.4', fontWeight: '500' }],
        'mono-md': ['13px', { lineHeight: '1.4', fontWeight: '500' }],
      },
      borderRadius: {
        card: '2px',
        input: '2px',
        pill: '999px',
      },
      spacing: {
        unit: '8px',
        panel: '12px',
        card: '12px',
        page: '16px',
      },
    },
  },
  plugins: [],
}

export default config
