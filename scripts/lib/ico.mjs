/**
 * Minimal, dependency-free ICO writer.
 *
 * Frames are 32-bit DIBs (bottom-up BGRA with a 1-bpp AND mask), except a
 * 256x256 frame which is stored as PNG. This mirrors what Windows Explorer
 * expects for modern high-DPI icon sets.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DIB_HEADER_SIZE = 40;

function assertSize(size) {
  if (!Number.isInteger(size) || size < 1 || size > 256) {
    throw new Error(`ICO frame size must be an integer between 1 and 256 (got ${size})`);
  }
}

function maskRowBytes(size) {
  // 1 bit per pixel, each row padded to a 32-bit boundary.
  return ((size + 31) >> 5) * 4;
}

/**
 * Encode one frame as a 32-bit BITMAPINFOHEADER DIB.
 *
 * @param {Buffer|Uint8Array} rgba top-down RGBA pixels, size * size * 4 bytes
 * @param {number} size square edge in pixels
 * @returns {Buffer}
 */
export function encodeDib(rgba, size) {
  assertSize(size);
  const pixels = Buffer.from(rgba);
  const expected = size * size * 4;
  if (pixels.length !== expected) {
    throw new Error(`DIB RGBA length mismatch: expected ${expected}, got ${pixels.length}`);
  }

  const xorRow = size * 4;
  const andRow = maskRowBytes(size);
  const xorSize = xorRow * size;
  const andSize = andRow * size;
  const pixelBytes = xorSize + andSize;
  const out = Buffer.alloc(DIB_HEADER_SIZE + pixelBytes);

  out.writeUInt32LE(DIB_HEADER_SIZE, 0); // biSize
  out.writeInt32LE(size, 4); // biWidth
  out.writeInt32LE(size * 2, 8); // biHeight: XOR + AND
  out.writeUInt16LE(1, 12); // biPlanes
  out.writeUInt16LE(32, 14); // biBitCount
  out.writeUInt32LE(0, 16); // BI_RGB
  out.writeUInt32LE(pixelBytes, 20); // biSizeImage
  out.writeInt32LE(0, 24); // biXPelsPerMeter
  out.writeInt32LE(0, 28); // biYPelsPerMeter
  out.writeUInt32LE(0, 32); // biClrUsed
  out.writeUInt32LE(0, 36); // biClrImportant

  let offset = DIB_HEADER_SIZE;
  // XOR bitmap, bottom-up BGRA.
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const src = (y * size + x) * 4;
      out[offset] = pixels[src + 2]; // B
      out[offset + 1] = pixels[src + 1]; // G
      out[offset + 2] = pixels[src]; // R
      out[offset + 3] = pixels[src + 3]; // A
      offset += 4;
    }
  }

  // AND mask, bottom-up, 1 = transparent.
  const maskStart = DIB_HEADER_SIZE + xorSize;
  for (let y = size - 1; y >= 0; y -= 1) {
    const rowStart = maskStart + (size - 1 - y) * andRow;
    for (let x = 0; x < size; x += 1) {
      if (pixels[(y * size + x) * 4 + 3] === 0) {
        out[rowStart + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return out;
}

/**
 * Build an ICO from frames. Provide either `png` (Buffer) or `rgba` (Buffer).
 *
 * @param {Array<{size:number, png?:Buffer|Uint8Array, rgba?:Buffer|Uint8Array}>} frames
 * @returns {Buffer}
 */
export function encodeIco(frames) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error("ICO requires at least one frame");
  }

  const seen = new Set();
  const normalized = frames
    .map((frame) => {
      assertSize(frame.size);
      if (seen.has(frame.size)) {
        throw new Error(`Duplicate ICO frame size: ${frame.size}`);
      }
      seen.add(frame.size);
      const hasPng = frame.png !== undefined && frame.png !== null;
      const hasRgba = frame.rgba !== undefined && frame.rgba !== null;
      if (hasPng === hasRgba) {
        throw new Error(`ICO frame ${frame.size} must provide exactly one of png or rgba`);
      }
      const payload = hasPng ? Buffer.from(frame.png) : encodeDib(frame.rgba, frame.size);
      return { size: frame.size, payload };
    })
    .sort((a, b) => a.size - b.size);

  const count = normalized.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const directory = Buffer.alloc(16 * count);
  let offset = 6 + directory.length;
  normalized.forEach((frame, index) => {
    const entry = index * 16;
    directory[entry] = frame.size === 256 ? 0 : frame.size;
    directory[entry + 1] = frame.size === 256 ? 0 : frame.size;
    directory[entry + 2] = 0; // color count
    directory[entry + 3] = 0; // reserved
    directory.writeUInt16LE(1, entry + 4); // planes
    directory.writeUInt16LE(32, entry + 6); // bit count
    directory.writeUInt32LE(frame.payload.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += frame.payload.length;
  });

  return Buffer.concat([header, directory, ...normalized.map((frame) => frame.payload)]);
}

/**
 * Parse an ICO enough to validate its structure in CI.
 *
 * @param {Buffer|Uint8Array} input
 */
export function parseIco(input) {
  const buffer = Buffer.from(input);
  if (buffer.length < 6) throw new Error("ICO is shorter than its 6-byte header");
  const reserved = buffer.readUInt16LE(0);
  const type = buffer.readUInt16LE(2);
  const count = buffer.readUInt16LE(4);
  if (reserved !== 0) throw new Error(`ICO reserved field must be 0 (got ${reserved})`);
  if (type !== 1) throw new Error(`ICO type must be 1 (got ${type})`);
  if (count === 0) throw new Error("ICO has no frames");
  if (buffer.length < 6 + count * 16) throw new Error("ICO directory is truncated");

  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const widthByte = buffer[entry];
    const heightByte = buffer[entry + 1];
    const bitCount = buffer.readUInt16LE(entry + 6);
    const bytes = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (offset + bytes > buffer.length) {
      throw new Error(`ICO frame ${index} extends past the end of the file`);
    }
    const payload = buffer.subarray(offset, offset + bytes);
    const isPng = payload.length >= 8 && payload.subarray(0, 8).equals(PNG_SIGNATURE);
    let dibHeight = null;
    if (!isPng) {
      if (payload.length < 40) throw new Error(`ICO frame ${index} DIB header is truncated`);
      dibHeight = payload.readInt32LE(8);
    }
    frames.push({
      index,
      size: widthByte === 0 ? 256 : widthByte,
      directoryHeight: heightByte === 0 ? 256 : heightByte,
      bitCount,
      bytes,
      offset,
      format: isPng ? "png" : "dib",
      dibHeight,
    });
  }
  return { count, frames };
}

export { PNG_SIGNATURE };
