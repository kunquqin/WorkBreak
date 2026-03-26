/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        app: {
          bg: 'var(--color-bg)',
          'bg-elevated': 'var(--color-bg-elevated)',
          'bg-overlay': 'var(--color-bg-overlay)',
          border: 'var(--color-border)',
          'border-subtle': 'var(--color-border-subtle)',
          text: 'var(--color-text-primary)',
          'text-secondary': 'var(--color-text-secondary)',
          'text-muted': 'var(--color-text-muted)',
        },
        'btn-primary': {
          bg: 'var(--color-button-primary-bg)',
          text: 'var(--color-button-primary-text)',
        },
        'btn-secondary': {
          bg: 'var(--color-button-secondary-bg)',
          border: 'var(--color-button-secondary-border)',
        },
      },
    },
  },
  plugins: [],
}
