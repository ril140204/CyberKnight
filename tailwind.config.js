/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './payment.html',
    './admin.html',
    './reset-password.html',
    './privacy.html',
    './terms.html',
    './refund.html',
    './assets/*.js',
    // Không quét level*/ vì game levels không dùng Tailwind
  ],
  theme: {
    extend: {
      colors: {
        // index.html
        primary: '#0066FF',
        secondary: '#0052CC',
        accent: '#00D4FF',
        dark: '#1a365d',
        light: '#F8FAFC',
        muted: '#64748B',
      },
      fontFamily: {
        heading: ['Space Grotesk', 'Poppins', 'sans-serif'],
        body: ['Poppins', 'Nunito', 'sans-serif'],
      },
    },
  },
  // Safelist các class dùng trong JS động hoặc sendBlockedHtml
  safelist: [
    'min-h-screen', 'flex', 'items-center', 'justify-center',
    'bg-gradient-to-br', 'from-indigo-950', 'via-purple-900', 'to-indigo-950',
    'bg-white/10', 'backdrop-blur-md', 'border', 'border-white/20',
    'rounded-3xl', 'p-10', 'max-w-md', 'w-full', 'mx-4', 'text-center',
    'shadow-2xl', 'text-6xl', 'mb-6', 'text-2xl', 'font-extrabold',
    'text-white', 'mb-4', 'text-indigo-200', 'mb-8', 'leading-relaxed',
    'inline-block', 'bg-gradient-to-r', 'from-cyan-400', 'to-blue-500',
    'hover:from-cyan-300', 'hover:to-blue-400', 'font-bold', 'px-8',
    'py-3', 'rounded-full', 'text-lg', 'shadow-lg', 'transition-all',
    'duration-200', 'transform', 'hover:scale-105', 'text-indigo-400',
    'text-sm', 'mt-6', 'hover:text-indigo-200',
    // Class động trong sendBlockedHtml (server.js)
    // Nếu thêm class mới trong JS, cần rebuild: npx tailwindcss -i assets/tailwind-input.css -o assets/tailwind.css --minify
  ],
  plugins: [],
};
