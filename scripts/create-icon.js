#!/usr/bin/env node
/**
 * Creates a 1024x1024 app icon (camera/screen recorder style) for AI Assistant.
 * Run: node scripts/create-icon.js
 * Then: npm run tauri icon app-icon.png
 */
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const size = 1024;
const png = new PNG({ width: size, height: size });

// Colors: dark blue bg, white lens, red record dot
const bgR = 31;
const bgG = 41;
const bgB = 55;
const white = 240;
const redR = 236;
const redG = 51;
const redB = 35;

const center = size / 2;
const lensRadius = size * 0.22;
const lensInnerRadius = size * 0.15;
const recordDotX = center + size * 0.2;
const recordDotY = center - size * 0.22;
const recordDotRadius = size * 0.06;
const bodyRadius = size * 0.35; // rounded rect for camera body

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const idx = (size * y + x) << 2;
    const d = dist(x, y, center, center);

    // Record dot (red circle, top-right)
    if (dist(x, y, recordDotX, recordDotY) < recordDotRadius) {
      png.data[idx] = redR;
      png.data[idx + 1] = redG;
      png.data[idx + 2] = redB;
      png.data[idx + 3] = 255;
      continue;
    }

    // Lens ring (white outer, darker inner)
    if (d < lensRadius) {
      if (d > lensInnerRadius) {
        png.data[idx] = white;
        png.data[idx + 1] = white;
        png.data[idx + 2] = white;
      } else {
        png.data[idx] = 60;
        png.data[idx + 1] = 70;
        png.data[idx + 2] = 90;
      }
      png.data[idx + 3] = 255;
      continue;
    }

    // Camera body (rounded rectangle-ish - white area around lens)
    const inBody = d < bodyRadius && Math.abs(x - center) < bodyRadius * 1.2 && Math.abs(y - center) < bodyRadius * 0.9;
    if (inBody && d > lensRadius) {
      png.data[idx] = white;
      png.data[idx + 1] = white;
      png.data[idx + 2] = white;
      png.data[idx + 3] = 255;
      continue;
    }

    // Background
    png.data[idx] = bgR;
    png.data[idx + 1] = bgG;
    png.data[idx + 2] = bgB;
    png.data[idx + 3] = 255;
  }
}

const outPath = path.join(__dirname, '..', 'app-icon.png');
png.pack().pipe(fs.createWriteStream(outPath)).on('finish', () => {
  console.log('Created app-icon.png - run: npm run tauri icon app-icon.png');
});
