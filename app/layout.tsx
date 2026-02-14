import type { Metadata, Viewport } from 'next'
import { Space_Mono, Inter } from 'next/font/google'

import './globals.css'

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

export const metadata: Metadata = {
  title: 'HAL 9000 - OpenClaw Voice Assistant',
  description: 'A voice assistant powered by OpenClaw, inspired by HAL 9000 from 2001: A Space Odyssey.',
}

export const viewport: Viewport = {
  themeColor: '#1a0000',
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${spaceMono.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  )
}
