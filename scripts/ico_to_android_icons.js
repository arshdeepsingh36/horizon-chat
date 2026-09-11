const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 1. Read ICO
const icoPath = 'F:\\vibe code\\chat\\horizon icon.ico';
const icoBuf = fs.readFileSync(icoPath);

const dataOffset = icoBuf.readUInt32LE(18);
const biHeaderSize = icoBuf.readUInt32LE(dataOffset);
const biWidth = icoBuf.readInt32LE(dataOffset + 4);
const biHeight = icoBuf.readInt32LE(dataOffset + 8) / 2; // actual height
const biBitCount = icoBuf.readUInt16LE(dataOffset + 14);

console.log('Parsed ICO:', { biWidth, biHeight, biBitCount });

const actualWidth = biWidth;
const actualHeight = biHeight;
const pixels = Buffer.alloc(actualWidth * actualHeight * 4);

const pixelOffset = dataOffset + biHeaderSize;

if (biBitCount === 32) {
  for (let y = 0; y < actualHeight; y++) {
    const srcRow = actualHeight - 1 - y; // flip Y
    for (let x = 0; x < actualWidth; x++) {
      const srcIdx = pixelOffset + (srcRow * actualWidth + x) * 4;
      const dstIdx = (y * actualWidth + x) * 4;
      const b = icoBuf[srcIdx];
      const g = icoBuf[srcIdx + 1];
      const r = icoBuf[srcIdx + 2];
      const a = icoBuf[srcIdx + 3];
      pixels[dstIdx] = r;
      pixels[dstIdx + 1] = g;
      pixels[dstIdx + 2] = b;
      pixels[dstIdx + 3] = a;
    }
  }
}

function resizeRGBA(srcBuf, srcW, srcH, dstW, dstH) {
  const dstBuf = Buffer.alloc(dstW * dstH * 4);
  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.min(srcH - 1, Math.floor((dy / dstH) * srcH));
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(srcW - 1, Math.floor((dx / dstW) * srcW));
      const srcIdx = (sy * srcW + sx) * 4;
      const dstIdx = (dy * dstW + dx) * 4;
      dstBuf[dstIdx] = srcBuf[srcIdx];
      dstBuf[dstIdx + 1] = srcBuf[srcIdx + 1];
      dstBuf[dstIdx + 2] = srcBuf[srcIdx + 2];
      dstBuf[dstIdx + 3] = srcBuf[srcIdx + 3];
    }
  }
  return dstBuf;
}

// Center icon inside larger canvas (for Android Adaptive Icons foreground safe zone)
function centerInCanvas(srcBuf, srcW, srcH, targetSize, iconScale = 0.65) {
  const dstBuf = Buffer.alloc(targetSize * targetSize * 4, 0); // transparent background
  const iconSize = Math.round(targetSize * iconScale);
  const resizedIcon = resizeRGBA(srcBuf, srcW, srcH, iconSize, iconSize);
  const startOffset = Math.floor((targetSize - iconSize) / 2);

  for (let y = 0; y < iconSize; y++) {
    for (let x = 0; x < iconSize; x++) {
      const srcIdx = (y * iconSize + x) * 4;
      const dstIdx = ((y + startOffset) * targetSize + (x + startOffset)) * 4;
      dstBuf[dstIdx] = resizedIcon[srcIdx];
      dstBuf[dstIdx + 1] = resizedIcon[srcIdx + 1];
      dstBuf[dstIdx + 2] = resizedIcon[srcIdx + 2];
      dstBuf[dstIdx + 3] = resizedIcon[srcIdx + 3];
    }
  }
  return dstBuf;
}

function makeRoundRGBA(srcBuf, size) {
  const dstBuf = Buffer.from(srcBuf);
  const radius = size / 2;
  const center = radius;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - center + 0.5) ** 2 + (y - center + 0.5) ** 2);
      const idx = (y * size + x) * 4;
      if (dist > radius) {
        dstBuf[idx + 3] = 0; // transparent
      } else if (dist > radius - 1) {
        const factor = radius - dist;
        dstBuf[idx + 3] = Math.round(dstBuf[idx + 3] * factor);
      }
    }
  }
  return dstBuf;
}

function encodePNG(rgbaBuf, width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(6, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rawOffset = y * rowSize;
    rawData[rawOffset] = 0;
    rgbaBuf.copy(rawData, rawOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    for (let j = 0; j < 8; j++) {
      const bit = (crc ^ byte) & 1;
      crc = (crc >>> 1) ^ (bit ? 0xEDB88320 : 0);
      byte = byte >>> 1;
    }
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const typeBuf = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  typeBuf.copy(chunk, 4);
  data.copy(chunk, 8);
  const crcData = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(crcData);
  chunk.writeUInt32BE(crcVal, 8 + len);
  return chunk;
}

const densities = [
  { dir: 'mipmap-mdpi', iconSize: 48, adaptiveSize: 108 },
  { dir: 'mipmap-hdpi', iconSize: 72, adaptiveSize: 162 },
  { dir: 'mipmap-xhdpi', iconSize: 96, adaptiveSize: 216 },
  { dir: 'mipmap-xxhdpi', iconSize: 144, adaptiveSize: 324 },
  { dir: 'mipmap-xxxhdpi', iconSize: 192, adaptiveSize: 432 }
];

const resDir = path.resolve('F:\\vibe code\\chat\\android\\app\\src\\main\\res');

for (const { dir, iconSize, adaptiveSize } of densities) {
  const targetDir = path.join(resDir, dir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 1. Standard square/squircle icon
  const squareRgba = resizeRGBA(pixels, actualWidth, actualHeight, iconSize, iconSize);
  const squarePng = encodePNG(squareRgba, iconSize, iconSize);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher.png'), squarePng);

  // 2. Round icon
  const roundRgba = makeRoundRGBA(squareRgba, iconSize);
  const roundPng = encodePNG(roundRgba, iconSize, iconSize);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher_round.png'), roundPng);

  // 3. Adaptive foreground with safe-zone scaling (65%)
  const adaptiveFgRgba = centerInCanvas(pixels, actualWidth, actualHeight, adaptiveSize, 0.65);
  const adaptiveFgPng = encodePNG(adaptiveFgRgba, adaptiveSize, adaptiveSize);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher_foreground.png'), adaptiveFgPng);

  console.log(`✅ Generated ${dir}: ic_launcher (${iconSize}x${iconSize}), round, and adaptive foreground (${adaptiveSize}x${adaptiveSize})`);
}

// 4. Update adaptive icon XMLs to point to @mipmap/ic_launcher_foreground
const anydpiDir = path.join(resDir, 'mipmap-anydpi-v26');
if (!fs.existsSync(anydpiDir)) {
  fs.mkdirSync(anydpiDir, { recursive: true });
}

const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;

fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptiveXml);
fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptiveXml);
console.log('✅ Updated mipmap-anydpi-v26 adaptive XMLs to reference @mipmap/ic_launcher_foreground');

// 5. Drawables and Play Store assets
const appLogoPng = encodePNG(resizeRGBA(pixels, actualWidth, actualHeight, 192, 192), 192, 192);
fs.writeFileSync(path.join(resDir, 'drawable', 'ic_horizon_app_logo.png'), appLogoPng);
fs.writeFileSync(path.join(resDir, 'drawable', 'ic_horizon_doc_badge.png'), appLogoPng);
fs.writeFileSync('F:\\vibe code\\chat\\android\\app\\src\\main\\ic_launcher-playstore.png', encodePNG(resizeRGBA(pixels, actualWidth, actualHeight, 512, 512), 512, 512));

// 6. Clean up obsolete vector files that could mask the ICO
const obsolete1 = path.join(resDir, 'drawable', 'ic_launcher.xml');
const obsolete2 = path.join(resDir, 'drawable', 'ic_launcher_foreground.xml');
if (fs.existsSync(obsolete1)) fs.unlinkSync(obsolete1);
if (fs.existsSync(obsolete2)) fs.unlinkSync(obsolete2);

console.log('🎉 Full Horizon ICO asset generation and adaptive Android config complete!');
