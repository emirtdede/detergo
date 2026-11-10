import { describe, expect, it } from "vitest";

import { encodeBmp24, parseBmp } from "./bmp.mjs";
import { PNG_SIGNATURE, encodeDib, encodeIco, parseIco } from "./ico.mjs";

function solid(size, [r, g, b, a]) {
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}

describe("ICO writer", () => {
  it("writes the 256 frame as 0x0 in the directory", () => {
    const png = Buffer.concat([PNG_SIGNATURE, Buffer.from([1, 2, 3])]);
    const ico = encodeIco([{ size: 256, png }]);
    expect(ico[6]).toBe(0);
    expect(ico[7]).toBe(0);
    expect(parseIco(ico).frames[0].format).toBe("png");
  });

  it("writes the 16 frame width as 16", () => {
    const ico = encodeIco([{ size: 16, rgba: solid(16, [255, 255, 255, 255]) }]);
    expect(ico[6]).toBe(16);
    expect(parseIco(ico).frames[0].size).toBe(16);
  });

  it("stores a DIB height of twice the edge", () => {
    const ico = encodeIco([{ size: 32, rgba: solid(32, [0, 0, 0, 255]) }]);
    const frame = parseIco(ico).frames[0];
    expect(frame.format).toBe("dib");
    expect(frame.dibHeight).toBe(64);
  });

  it("stores DIB rows bottom-up", () => {
    const rgba = Buffer.alloc(2 * 2 * 4);
    // top-left red, bottom-left blue
    rgba.set([255, 0, 0, 255], 0);
    rgba.set([0, 0, 255, 255], 2 * 4);
    const dib = encodeDib(rgba, 2);
    expect([...dib.subarray(40, 44)]).toEqual([255, 0, 0, 255]);
  });

  it("stores DIB pixels as BGRA", () => {
    const dib = encodeDib(solid(2, [255, 0, 0, 255]), 2);
    expect([...dib.subarray(40, 44)]).toEqual([0, 0, 255, 255]);
  });

  it("keeps straight alpha without premultiplication", () => {
    const dib = encodeDib(Buffer.from([10, 20, 30, 40]), 1);
    expect([...dib.subarray(40, 44)]).toEqual([30, 20, 10, 40]);
  });

  it("sets the AND mask bit when alpha is zero", () => {
    const rgba = Buffer.alloc(2 * 2 * 4);
    rgba.set([255, 255, 255, 0], 0); // transparent top-left
    rgba.set([255, 255, 255, 255], 4); // opaque top-right
    rgba.set([255, 255, 255, 255], 8);
    rgba.set([255, 255, 255, 255], 12);
    const dib = encodeDib(rgba, 2);
    const maskStart = 40 + 2 * 2 * 4;
    expect(dib[maskStart + 4]).toBe(0x80);
  });

  it("pads AND mask rows to four bytes", () => {
    const dib = encodeDib(solid(17, [0, 0, 0, 255]), 17);
    const maskStart = 40 + 17 * 17 * 4;
    expect((dib.length - maskStart) / 17).toBe(4);
  });

  it("writes contiguous, in-bounds frame offsets", () => {
    const ico = encodeIco([
      { size: 32, rgba: solid(32, [0, 0, 0, 255]) },
      { size: 16, rgba: solid(16, [0, 0, 0, 255]) },
    ]);
    const parsed = parseIco(ico);
    const [small, large] = parsed.frames;
    expect(small.offset).toBe(6 + 2 * 16);
    expect(large.offset).toBe(small.offset + small.bytes);
    expect(large.offset + large.bytes).toBe(ico.length);
  });

  it("rejects duplicate frame sizes", () => {
    expect(() =>
      encodeIco([
        { size: 16, rgba: solid(16, [0, 0, 0, 255]) },
        { size: 16, rgba: solid(16, [0, 0, 0, 255]) },
      ]),
    ).toThrow(/Duplicate/);
  });
});

describe("BMP writer", () => {
  it("pads 150x57 rows to four bytes", () => {
    const bmp = encodeBmp24(Buffer.alloc(150 * 57 * 3, 255), 150, 57);
    const parsed = parseBmp(bmp);
    expect(parsed.rowBytes).toBe(452);
    expect(parsed.imageSize).toBe(452 * 57);
  });

  it("pads 493x58 rows to four bytes", () => {
    const bmp = encodeBmp24(Buffer.alloc(493 * 58 * 3, 255), 493, 58);
    const parsed = parseBmp(bmp);
    expect(parsed.rowBytes).toBe(1480);
    expect(parsed.imageSize).toBe(1480 * 58);
  });

  it("stores 24-bit pixels as BGR bottom-up", () => {
    const bmp = encodeBmp24(Buffer.from([255, 0, 0]), 1, 1);
    expect([...bmp.subarray(54, 57)]).toEqual([0, 0, 255]);
  });
});
