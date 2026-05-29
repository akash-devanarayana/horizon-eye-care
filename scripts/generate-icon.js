// Renders assets/icon.svg into the app icon assets:
//   assets/icon.png  (256, used for the tray)
//   assets/icon.ico  (multi-size: 16/24/32/48/64/128/256, used for exe + installer)
//
// One-off regeneration after editing assets/icon.svg:
//   npm i --no-save sharp png-to-ico && node scripts/generate-icon.js
// (deps are intentionally not in package.json to keep installs lean.)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoMod = require('png-to-ico');
const pngToIco = pngToIcoMod.default || pngToIcoMod;

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'));

(async () => {
  // Tray PNG
  await sharp(svg).resize(256, 256).png().toFile(path.join(root, 'assets', 'icon.png'));

  // Multi-size ICO
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const buffers = [];
  for (const s of sizes) {
    buffers.push(await sharp(svg).resize(s, s).png().toBuffer());
  }
  const ico = await pngToIco(buffers);
  fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), ico);

  console.log('icon.png + icon.ico written');
})();
