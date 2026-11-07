/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Arial', 'Helvetica', 'sans-serif'],
      },
      colors: {
        primary: '#130b1c',
        secondary: '#231433',
        tertiary: '#523769',
        'card-bg': '#251537',
        'card-hover': '#382151',
        'accent-green': '#329448',
        'accent-red': '#e33d45',
        'accent-yellow': '#e8af1e',
        'accent-blue': '#a85cff',
        'accent-violet': '#7F00FF',
        'text-primary': '#f4ecff',
        'text-secondary': '#cebce4',
        'text-muted': '#9681ab',
      },
      borderRadius: { 'sm': '2px', DEFAULT: '2px', 'md': '3px', 'lg': '3px', 'xl': '3px', '2xl': '4px', '3xl': '4px' },
      boxShadow: {
        'sm': 'none', 'md': 'none', 'lg': 'none', 'xl': 'none', '2xl': 'none',
        'glow-green': 'none',
        'glow-red': 'none',
        'glow-yellow': 'none',
        'inner-glow': 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.08)',
      }
    },
  },
  plugins: [],
}
