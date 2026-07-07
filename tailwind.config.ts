import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1A1A18',
        mist: '#F7F7F5',
        line: '#E2E2DF',
        quiet: '#6E6E69',
        accent: '#3B5BCC',
        surface: '#FFFFFF',
        sunken: '#EFEFED',
        success: '#1F7A45',
        warning: '#8F6400',
        danger: '#B3261E',
        'accent-subtle': '#EDF1FC'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      fontSize: {
        caption: ['11px', { lineHeight: '1.45', letterSpacing: '0.01em' }],
        body: ['13px', { lineHeight: '1.5' }],
        h2: ['15px', { lineHeight: '1.4', fontWeight: '600' }],
        h1: ['18px', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '-0.01em' }],
        display: ['24px', { lineHeight: '1.25', fontWeight: '600', letterSpacing: '-0.01em' }]
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '10px'
      },
      boxShadow: {
        page: '0 1px 3px rgba(0, 0, 0, 0.10)',
        modal: '0 8px 24px rgba(0, 0, 0, 0.14)',
        panel: '0 1px 3px rgba(0, 0, 0, 0.08)'
      }
    }
  },
  plugins: []
} satisfies Config;
