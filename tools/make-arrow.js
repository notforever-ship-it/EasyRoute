// Draws Media/Arrow.tga: the guide arrow in 64 turns, 8 by 8 cells of 64x64 pixels on a 512x512 sheet.
// Cell k points k * (360 / 64) degrees anticlockwise from straight up; Arrow.lua picks the cell for the angle.
// The arrow is white with a dark edge, so the game can colour it (green when you face the right way, red when not).
// Usage: node tools/make-arrow.js

const fs = require("fs");
const path = require("path");

const SIZE = 512, CELL = 64, PER_ROW = 8, TURNS = 64, SS = 4;   // SS: samples per pixel side, for smooth edges

// The arrow in cell space, y up, centred on (0, 0): a broad head with a notch at the back.
const SHAPE = [[0, 28], [15, -17], [0, -8], [-15, -17]];
function scaled(shape, k) {
  return shape.map(([x, y]) => [x * k, y * k + (k - 1) * 2]);
}
const OUTER = scaled(SHAPE, 1.13);

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const px = Buffer.alloc(SIZE * SIZE * 4);   // RGBA, top row first
for (let k = 0; k < TURNS; k++) {
  const a = (k * 2 * Math.PI) / TURNS;
  const cos = Math.cos(a), sin = Math.sin(a);
  const ox = (k % PER_ROW) * CELL, oy = Math.floor(k / PER_ROW) * CELL;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      let fill = 0, edge = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = x + (sx + 0.5) / SS - CELL / 2;
          const dy = -(y + (sy + 0.5) / SS - CELL / 2);
          // Turn the sample back by the cell's angle, into the arrow's own space.
          const ax = dx * cos + dy * sin;
          const ay = -dx * sin + dy * cos;
          if (inside(SHAPE, ax, ay)) fill++;
          else if (inside(OUTER, ax, ay)) edge++;
        }
      }
      const n = SS * SS;
      const alpha = (fill + edge) / n;
      const light = alpha > 0 ? fill / (fill + edge) : 0;
      const v = Math.round(255 * light * 0.95 + 8);
      const i = ((oy + y) * SIZE + (ox + x)) * 4;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = Math.round(255 * alpha);
    }
  }
}

// Uncompressed 32-bit TGA, stored bottom row first (the usual way, which the game reads).
const head = Buffer.alloc(18);
head[2] = 2;
head.writeUInt16LE(SIZE, 12);
head.writeUInt16LE(SIZE, 14);
head[16] = 32;
head[17] = 8;
const body = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const s = (y * SIZE + x) * 4, d = ((SIZE - 1 - y) * SIZE + x) * 4;
    body[d] = px[s + 2]; body[d + 1] = px[s + 1]; body[d + 2] = px[s]; body[d + 3] = px[s + 3];
  }
}
const out = path.resolve(__dirname, "..", "Media", "Arrow.tga");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, body]));
console.log("Wrote " + out + " (" + TURNS + " turns)");
