#!/usr/bin/env node
/**
 * Generate app icon for Tauri.
 * Run: node scripts/generate-icons.js
 * Then: npm run tauri icon app-icon.png
 */
const fs = require('fs');
const path = require('path');

// Minimal 32x32 PNG (green square) - valid PNG structure
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

// Create a simple 1024x1024 PNG using raw pixel data
// For simplicity, we'll create multiple sizes
const sizes = [32, 128, 256, 512];
const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Use tauri icon if available - otherwise create placeholder
console.log('To generate icons, add a 1024x1024 PNG named app-icon.png and run:');
console.log('  npm run tauri icon app-icon.png');
console.log('');
console.log('Icons will be generated in src-tauri/icons/');
