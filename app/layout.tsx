import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { Playfair_Display, DM_Sans } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/Providers'

const SITE_URL = 'https://filiprosa.cz'

// Self-hosted via next/font: removes the render-blocking request to
// fonts.googleapis.com and applies font-display: swap automatically.
const playfairDisplay = Playfair_Display({
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-playfair',
})

const dmSans = DM_Sans({
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-dm-sans',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No maximum-scale / user-scalable=no — pinch-zoom must stay available (a11y).
}

export const metadata: Metadata = {
  title: {
    default: 'Filip Rosa',
    template: '%s | Filip Rosa',
  },
  description:
    'Mladý fotograf z Vyškova specializující se na analogovou fotografii. Portrétní focení, vyvolávání filmů, darkroom tisky a skenování pro celou jižní Moravu.',
  keywords: [
    'fotograf Vyškov',
    'analogová fotografie',
    'vyvolávání filmů',
    'darkroom tisky',
    'portrétní fotograf',
    'produktová fotografie',
    'jižní Morava',
    'Jihomoravský kraj',
    'film photography',
    'Filip Rosa',
  ],
  metadataBase: new URL(SITE_URL),
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    locale: 'cs_CZ',
    alternateLocale: 'en_US',
    url: SITE_URL,
    siteName: 'Filip Rosa',
    title: 'Filip Rosa',
    description:
      'Portrétní focení, produktová fotografie, vyvolávání filmů a darkroom tisky. Fotograf z Vyškova pro celou jižní Moravu.',
    images: [
      {
        url: `${SITE_URL}/images/profile.jpg`,
        width: 1200,
        height: 630,
        alt: 'Filip Rosa – fotograf, Vyškov',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Filip Rosa',
    description:
      'Portrétní focení, vyvolávání filmů a darkroom tisky. Fotograf z Vyškova pro celou jižní Moravu.',
    images: [`${SITE_URL}/images/profile.jpg`],
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: SITE_URL,
    languages: {
      'cs-CZ': SITE_URL,
      'en-US': `${SITE_URL}?lang=en`,
    },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="cs"
      suppressHydrationWarning
      className={`scroll-pt-24 ${playfairDisplay.variable} ${dmSans.variable}`}
    >
      <head>
        {/* Preload the LCP hero image so the browser fetches it immediately,
            matching the <picture> AVIF source in components/Hero.tsx. */}
        <link
          rel="preload"–
          as="image"
          type="image/avif"
          href="/images/opt/hero-1280.avif"
          imageSrcSet="/images/opt/hero-640.avif 640w, /images/opt/hero-960.avif 960w, /images/opt/hero-1280.avif 1280w, /images/opt/hero-1920.avif 1920w, /images/opt/hero-2560.avif 2560w"
          imageSizes="100vw"
          fetchPriority="high"
        />
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Person',
              name: 'Filip Rosa',
              url: SITE_URL,
              image: `${SITE_URL}/images/profile.jpg`,
              jobTitle: 'Fotograf',
              description:
                'Mladý fotograf z Vyškova specializující se na analogovou fotografii – portréty, produkty, vyvolávání filmů a darkroom tisky pro celou jižní Moravu.',
              address: {
                '@type': 'PostalAddress',
                addressLocality: 'Vyškov',
                addressRegion: 'Jihomoravský kraj',
                addressCountry: 'CZ',
              },
              areaServed: {
                '@type': 'AdministrativeArea',
                name: 'Jihomoravský kraj',
              },
              sameAs: [],
              knowsAbout: [
                'Analogová fotografie',
                'Portrétní fotografie',
                'Produktová fotografie',
                'Vyvolávání filmů',
                'Darkroom tisky',
                'Skenování negativů',
                'Portrait photography',
                'Film development',
                'Darkroom printing',
                'Analog photography',
              ],
              offers: [
                {
                  '@type': 'Offer',
                  name: 'Portrétní a produktová fotografie',
                  description: 'Focení pro jednotlivce, firmy a události v digitálním i analogovém stylu.',
                  areaServed: 'Jihomoravský kraj',
                },
                {
                  '@type': 'Offer',
                  name: 'Vyvolávání černobílých filmů',
                  description: 'Individuální vyvolávání černobílých negativů.',
                },
                {
                  '@type': 'Offer',
                  name: 'Darkroom tisky',
                  description: 'Ručně vyrobené zvětšeniny z negativů v temné komoře.',
                },
              ],
            }),
          }}
        />
        <Providers>
          {children}
        </Providers>

        {/* Google Analytics — deferred to browser idle so it no longer competes
            with the initial render (it was ~900 ms of main-thread work). */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-9HDBSK2C68"
          strategy="lazyOnload"
        />
        <Script id="ga-init" strategy="lazyOnload">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-9HDBSK2C68');`}
        </Script>
      </body>
    </html>
  )
}
