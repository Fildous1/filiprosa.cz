/**
 * Build-time image optimizer.
 *
 * Generates responsive AVIF / WebP / JPEG variants of the heavy hero and
 * profile photos so the homepage can serve modern, correctly-sized images
 * via <picture>/srcset. The originals stay untouched (used as OG images).
 *
 * Re-run whenever the source images change:
 *   npm run optimize:images
 */
import sharp from 'sharp'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = 'public/images/opt'

/** @type {{src:string,name:string,widths:number[],q:{avif:number,webp:number,jpg:number}}[]} */
const JOBS = [
  // Hero background — full-bleed, heavily darkened by overlays, so it can be
  // compressed aggressively without visible loss.
  {
    src: 'public/images/hero.jpg',
    name: 'hero',
    widths: [640, 960, 1280, 1920, 2560],
    q: { avif: 48, webp: 70, jpg: 72 },
  },
  // About portrait — visible at quality, displayed up to ~480px (×2 for retina).
  {
    src: 'public/images/profile.jpg',
    name: 'profile',
    widths: [480, 720, 960, 1280],
    q: { avif: 58, webp: 74, jpg: 80 },
  },
]

async function run() {
  await mkdir(OUT, { recursive: true })

  for (const job of JOBS) {
    const meta = await sharp(job.src).metadata()
    for (const w of job.widths) {
      if (w > meta.width) continue // never upscale
      const pipeline = sharp(job.src).resize({ width: w, withoutEnlargement: true })
      await pipeline.clone().avif({ quality: job.q.avif }).toFile(join(OUT, `${job.name}-${w}.avif`))
      await pipeline.clone().webp({ quality: job.q.webp }).toFile(join(OUT, `${job.name}-${w}.webp`))
      await pipeline
        .clone()
        .jpeg({ quality: job.q.jpg, mozjpeg: true, progressive: true })
        .toFile(join(OUT, `${job.name}-${w}.jpg`))
    }
    console.log(`✓ ${job.name}: ${job.widths.join(', ')} px → avif/webp/jpg`)
  }

  // Report resulting sizes
  const files = (await readdir(OUT)).sort()
  console.log(`\n${OUT}:`)
  for (const f of files) {
    const s = await stat(join(OUT, f))
    console.log(`  ${f.padEnd(18)} ${(s.size / 1024).toFixed(0)} KiB`)
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
