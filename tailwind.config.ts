import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './hooks/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FFFAF0',
        surface: '#FFFFFF',
        raised: '#F3EFE4',
        onair: '#FF6655',
        cue: '#4968FF',
        ink: '#18203C',
        muted: '#626A82',
        'host-a': '#58C8F5',
        'host-b': '#F88FA2',
        listener: '#FFDA4B',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        editorial: ['var(--font-display)', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '5px 6px 0 #18203C',
        'card-sm': '3px 4px 0 #18203C',
      },
      keyframes: {
        'level-pulse': {
          '0%, 100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
        'ring-out': {
          '0%': { transform: 'scale(1)', opacity: '0.5' },
          '100%': { transform: 'scale(1.7)', opacity: '0' },
        },
      },
      animation: {
        'level-pulse': 'level-pulse 1.1s ease-in-out infinite',
        'ring-out': 'ring-out 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
