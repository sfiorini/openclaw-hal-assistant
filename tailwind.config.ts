import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    '*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)'],
        mono: ['var(--font-space-mono)'],
      },
      colors: {
        hal: {
          red: 'hsl(var(--hal-red))',
          'red-glow': 'hsl(var(--hal-red-glow))',
          panel: 'hsl(var(--hal-panel))',
          'panel-light': 'hsl(var(--hal-panel-light))',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'hal-pulse': {
          '0%, 100%': { boxShadow: '0 0 30px 8px hsl(0 85% 45% / 0.4), 0 0 60px 16px hsl(0 100% 50% / 0.15)' },
          '50%': { boxShadow: '0 0 50px 14px hsl(0 85% 45% / 0.6), 0 0 90px 24px hsl(0 100% 50% / 0.25)' },
        },
        'hal-recording': {
          '0%, 100%': { boxShadow: '0 0 40px 12px hsl(0 85% 55% / 0.7), 0 0 80px 24px hsl(0 100% 50% / 0.35)' },
          '50%': { boxShadow: '0 0 70px 20px hsl(0 85% 55% / 0.9), 0 0 120px 40px hsl(0 100% 50% / 0.5)' },
        },
        'hal-speaking': {
          '0%, 100%': { boxShadow: '0 0 35px 10px hsl(0 85% 45% / 0.5), 0 0 70px 20px hsl(0 100% 50% / 0.2)' },
          '33%': { boxShadow: '0 0 55px 16px hsl(0 85% 50% / 0.7), 0 0 100px 32px hsl(0 100% 50% / 0.35)' },
          '66%': { boxShadow: '0 0 40px 12px hsl(0 85% 45% / 0.55), 0 0 80px 24px hsl(0 100% 50% / 0.25)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'hal-pulse': 'hal-pulse 3s ease-in-out infinite',
        'hal-recording': 'hal-recording 1s ease-in-out infinite',
        'hal-speaking': 'hal-speaking 0.8s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
export default config
