/**
 * Minimal 24-bit BMP writer for NSIS and WiX artwork.
 *
 * sharp cannot emit BMP. The output is an uncompressed, bottom-up, 24-bit
 * Windows bitmap with a BITMAPFILEHEADER (14 bytes) and BITMAPINFOHEADER
 * (40 bytes), which is what both installers accept.
 */

const FILE_HEADER_SIZE = 14;
const INFO_HEADER_SIZE = 40;
const PIXEL_OFFSET = FILE_HEADER_SIZE + INFO_HEADER_SIZE;

function rowBytes(width) {
  return (width * 3 + 3) & ~3;
}

/**
 * @param {Buffer|Uint8Array} pixels RGB (3 channels) or RGBA (4 channels)
 * @param {number} width
 * @param {number} height
 * @param {number} channels 3 or 4
 * @returns {Buffer}
 */
export function encodeBmp24(pixels, width, height, channels = 3) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error(`BMP dimensions must be positive integers (got ${width}x${height})`);
  }
  if (channels !== 3 && channels !== 4) {
    throw new Error(`BMP input must have 3 or 4 channels (got ${channels})`);
  }
  const input = Buffer.from(pixels);
  const expected = width * height * channels;
  if (input.length !== expected) {
    throw new Error(`BMP pixel length mismatch: expected ${expected}, got ${input.length}`);
  }

  const stride = rowBytes(width);
  const imageSize = stride * height;
  const fileSize = PIXEL_OFFSET + imageSize;
  const out = Buffer.alloc(fileSize);

  out.write("BM", 0, "ascii");
  out.writeUInt32LE(fileSize, 2);
  out.writeUInt16LE(0, 6);
  out.writeUInt16LE(0, 8);
  out.writeUInt32LE(PIXEL_OFFSET, 10);

  out.writeUInt32LE(INFO_HEADER_SIZE, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22); // positive = bottom-up
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(0, 30); // BI_RGB
  out.writeUInt32LE(imageSize, 34);
  out.writeInt32LE(2835, 38); // 72 DPI
  out.writeInt32LE(2835, 42);
  out.writeUInt32LE(0, 46);
  out.writeUInt32LE(0, 50);

  let offset = PIXEL_OFFSET;
  for (let y = height - 1; y >= 0; y -= 1) {
    const rowStart = offset;
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * channels;
      out[offset] = input[src + 2]; // B
      out[offset + 1] = input[src + 1]; // G
      out[offset + 2] = input[src]; // R
      offset += 3;
    }
    offset = rowStart + stride;
  }

  return out;
}

/**
 * Parse a BMP for structural verification.
 *
 * @param {Buffer|Uint8Array} input
 */
export function parseBmp(input) {
  const buffer = Buffer.from(input);
  if (buffer.length < PIXEL_OFFSET) throw new Error("BMP is shorter than its headers");
  if (buffer.toString("ascii", 0, 2) !== "BM") throw new Error("BMP signature is not BM");
  const fileSize = buffer.readUInt32LE(2);
  const pixelOffset = buffer.readUInt32LE(10);
  const headerSize = buffer.readUInt32LE(14);
  const width = buffer.readInt32LE(18);
  const height = buffer.readInt32LE(22);
  const planes = buffer.readUInt16LE(26);
  const bitCount = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);
  const imageSize = buffer.readUInt32LE(34);
  if (fileSize !== buffer.length) {
    throw new Error(`BMP file size field ${fileSize} does not match actual ${buffer.length}`);
  }
  if (headerSize !== INFO_HEADER_SIZE) {
    throw new Error(`BMP info header must be 40 bytes (got ${headerSize})`);
  }
  if (planes !== 1) throw new Error(`BMP planes must be 1 (got ${planes})`);
  if (bitCount !== 24) throw new Error(`BMP must be 24-bit (got ${bitCount})`);
  if (compression !== 0) throw new Error(`BMP must be uncompressed (got ${compression})`);
  if (height <= 0) throw new Error("BMP must be bottom-up (positive height)");
  if (width <= 0) throw new Error("BMP width must be positive");
  const expectedImageSize = rowBytes(width) * height;
  if (imageSize !== expectedImageSize) {
    throw new Error(`BMP image size ${imageSize} does not match expected ${expectedImageSize}`);
  }
  return {
    width,
    height,
    bitCount,
    compression,
    pixelOffset,
    imageSize,
    rowBytes: rowBytes(width),
  };
}

export { PIXEL_OFFSET };
