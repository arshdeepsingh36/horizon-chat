const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 1. Read ICO
const icoBuf = fs.readFileSync('F:\\vibe code\\chat\\horizon icon.ico');

// ICO Header: 6 bytes
// Dir entry: offset 6: [width, height, colors, reserved, planes(2), bpp(2), size(4), offset(4)]
const width = icoBuf.readUInt8(6) || 256;
const height = icoBuf.readUInt8(7) || 256;
const dataSize = icoBuf.readUInt32LE(14);
const dataOffset = icoBuf.readUInt32LE(18);

console.log({ width, height, dataSize, dataOffset });

// Bitmap Info Header inside ICO:
// headerSize(4), biWidth(4), biHeight(4, double actual height), planes(2), bitCount(2), ...
const biHeaderSize = icoBuf.readUInt32LE(dataOffset);
const biWidth = icoBuf.readInt32LE(dataOffset + 4);
const biHeight = icoBuf.readInt32LE(dataOffset + 8) / 2; // actual height
const biBitCount = icoBuf.readUInt16LE(dataOffset + 14);

console.log({ biHeaderSize, biWidth, biHeight, biBitCount });

const actualWidth = biWidth;
const actualHeight = biHeight;
const pixels = Buffer.alloc(actualWidth * actualHeight * 4);

// In DIB/BMP format, rows are stored bottom-to-top, 4 bytes per pixel BGRA (if 32bpp)
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

// Function to resize RGBA buffer (bilinear/nearest)
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

// Function to create round/circular icon from RGBA buffer
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

// Pure JS PNG encoder
function encodePNG(rgbaBuf, width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(6, 9); // color type RGBA
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT: Scanlines with filter byte 0
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rawOffset = y * rowSize;
    rawData[rawOffset] = 0; // filter 0: None
    rgbaBuf.copy(rawData, rawOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
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

// Generate all standard Android icon densities
const densities = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 }
];

const resDir = path.resolve('F:\\vibe code\\chat\\android\\app\\src\\main\\res');

for (const { dir, size } of densities) {
  const targetDir = path.join(resDir, dir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Standard square/squircle icon
  const squareRgba = resizeRGBA(pixels, actualWidth, actualHeight, size, size);
  const squarePng = encodePNG(squareRgba, size, size);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher.png'), squarePng);

  // Round icon
  const roundRgba = makeRoundRGBA(squareRgba, size);
  const roundPng = encodePNG(roundRgba, size, size);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher_round.png'), roundPng);

  console.log(`✅ Generated ${dir} icons (${size}x${size})`);
}

// Also save 512x512 play store icon & app drawable
const playStoreRgba = resizeRGBA(pixels, actualWidth, actualHeight, 512, 512);
const playStorePng = encodePNG(playStoreRgba, 512, 512);
fs.writeFileSync(path.join(resDir, 'drawable', 'ic_horizon_app_logo.png'), encodePNG(resizeRGBA(pixels, actualWidth, actualHeight, 192, 192), 192, 192));
fs.writeFileSync('F:\\vibe code\\chat\\android\\app\\src\\main\\ic_launcher-playstore.png', playStorePng);

console.log('🎉 All Android app icons successfully generated from horizon icon.ico!');
