/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.html', './public/assets/js/**/*.js', './src/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        /* Biru PMII — warna dasar bendera, dipakai untuk brand & teks utama */
        pmii: {
          50: '#eef4ff',
          100: '#dae6ff',
          200: '#bcd2ff',
          300: '#8eb4ff',
          400: '#598cff',
          500: '#3364ff',
          600: '#1d41f5',
          700: '#162fe1',
          800: '#1829b6',
          900: '#122a8f',
          950: '#0b1a5c',
        },
        /* Kuning PMII — warna bintang & pena pada lambang, dipakai untuk aksen/CTA */
        kuning: {
          50: '#fffceb',
          100: '#fff6c6',
          200: '#ffec88',
          300: '#ffdb4a',
          400: '#ffc820',
          500: '#f9a607',
          600: '#dd7d02',
          700: '#b75906',
          800: '#94440c',
          900: '#7a380d',
        },
      },
      spacing: {
        /* Ukuran ikon 18px — di antara h-4 dan h-5, dipakai untuk ikon dalam badge 36px */
        4.5: '1.125rem',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Sora', 'Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(18 42 143 / 0.04), 0 8px 24px -12px rgb(18 42 143 / 0.18)',
        'card-hover': '0 2px 4px 0 rgb(18 42 143 / 0.06), 0 18px 40px -16px rgb(18 42 143 / 0.28)',
        glow: '0 10px 30px -10px rgb(249 166 7 / 0.55)',
      },
      backgroundImage: {
        'grid-light':
          "url(\"data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 .5H40M.5 0V40' stroke='%23122a8f' stroke-opacity='0.06'/%3E%3C/svg%3E\")",
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .6s cubic-bezier(.16,1,.3,1) both',
        'float-slow': 'float-slow 7s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
