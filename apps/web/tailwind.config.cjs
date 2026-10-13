/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx,html}',
    './electron/**/*.{ts,tsx,html}'
  ],
  theme: {
    extend: {
      colors: {
        // Legacy utility palette stays available for gradual migration.
        // Shared semantic colors live in src/index.css (--sp-*);
        // see docs/SYNCPATH_DESIGN_SYSTEM.md for current component tokens.
      },
      fontFamily: {
        // System font stack per docs/SYNCPATH_BRAND_STYLE.md §3.
        sans: [
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"'
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace'
        ]
      }
    }
  },
  // Hard-list a handful of classnames that get composed dynamically with
  // clsx() in AppV2 / Timeline. Keeping them here means we don't depend
  // on a Tailwind JIT scanner picking up a particular literal path.
  safelist: [
    'flex', 'grid', 'hidden', 'block',
    'bg-indigo-50', 'bg-indigo-600', 'bg-slate-50', 'bg-slate-100', 'bg-slate-900',
    'text-white', 'text-slate-800', 'text-slate-600', 'text-slate-500', 'text-slate-400',
    'border-slate-200', 'border-slate-100',
    'rounded-2xl', 'rounded-full', 'rounded-xl'
  ],
  plugins: [],
  darkMode: 'class'
};
