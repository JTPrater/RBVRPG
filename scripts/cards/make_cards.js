// Makes the playing cards for the draw-poker table (public/images/cards/).
//
// Faces: Byron Knoll, "Vector Playing Cards" 1.3 (PNG-cards-1.3.zip), released
//   into the public domain ("attribution is appreciated but not required"):
//   https://code.google.com/archive/p/vector-playing-cards/
//   The jack, queen and king are the set's traditional court figures (its
//   "...2.png" files). Its red and club aces carry a glossy, shaded pip; they
//   are redrawn here with the set's own flat pip (the top pip of the 2 of the
//   suit, enlarged) so every card is printed flat. The ace of spades is the
//   set's ornate one, as it is.
// Back: BdRGames, "Playing cards back vector svg", design 2 in red, CC0:
//   https://opengameart.org/content/playing-cards-back-vector-svg
//
// usage: node scripts/cards/make_cards.js <PNG-cards-1.3 folder> <back.svg> [out dir] [width px]
// writes <suit>-<rank>.webp (rank 2..10, j, q, k, a) and back.webp
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const [, , faceDir, backSvg, outArg, widthArg] = process.argv;
if (!faceDir || !backSvg) {
  console.error("usage: node scripts/cards/make_cards.js <PNG-cards-1.3 folder> <back.svg> [out dir] [width px]");
  process.exit(1);
}
const OUT = outArg || path.join(__dirname, "../../public/images/cards");
const WIDTH = Number(widthArg) || 220;
const SUITS = ["clubs", "diamonds", "hearts", "spades"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king", "ace"];
const SHORT = { jack: "j", queen: "q", king: "k", ace: "a" };

async function rgba(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
// box of the printed (dark or coloured) pixels inside a region
function inkBox(img, x0, y0, x1, y1, lumMax = 215) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.w + x) * 4;
      const a = img.data[i + 3];
      const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      if (a > 128 && lum < lumMax) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("no ink found");
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// the red and club aces, printed flat: the middle of the card (all but the
// corner indices) whited out, and the 2's top pip printed there, enlarged to
// the width of the ornate spade on the ace of spades
async function flatAce(suit) {
  const aceFile = path.join(faceDir, `ace_of_${suit}.png`);
  const twoFile = path.join(faceDir, `2_of_${suit}.png`);
  const ace = await rgba(aceFile);
  const two = await rgba(twoFile);
  const W = ace.w, H = ace.h;
  // the corner indices (clear of the card's edge line)
  const tl = inkBox(ace, 8, 8, Math.round(W * 0.26), Math.round(H * 0.24));
  const br = inkBox(ace, Math.round(W * 0.74), Math.round(H * 0.76), W - 8, H - 8);
  const inBox = (b, x, y) => x >= b.left - 6 && x < b.left + b.width + 6 && y >= b.top - 6 && y < b.top + b.height + 6;
  const x0 = Math.round(W * 0.05), x1 = Math.round(W * 0.95);
  const y0 = Math.round(H * 0.12), y1 = Math.round(H * 0.88);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (inBox(tl, x, y) || inBox(br, x, y)) continue;
      const i = (y * W + x) * 4;
      ace.data[i] = ace.data[i + 1] = ace.data[i + 2] = ace.data[i + 3] = 255;
    }
  }
  // the 2's upper pip: the middle column, top half, below the index
  const pip = inkBox(two, Math.round(two.w * 0.3), Math.round(two.h * 0.08), Math.round(two.w * 0.7), Math.round(two.h * 0.45));
  const pad = 3;
  const pipPng = await sharp(twoFile)
    .extract({ left: pip.left - pad, top: pip.top - pad, width: pip.width + 2 * pad, height: pip.height + 2 * pad })
    .resize({ width: Math.round(W * 0.52) + 2 * pad, kernel: "lanczos3" })
    .png()
    .toBuffer();
  const meta = await sharp(pipPng).metadata();
  return sharp(ace.data, { raw: { width: W, height: H, channels: 4 } })
    .composite([{ input: pipPng, left: Math.round(W / 2 - meta.width / 2), top: Math.round(H / 2 - meta.height / 2) }])
    .png()
    .toBuffer();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let total = 0, largest = 0, height = 0;
  const write = async (input, name) => {
    const file = path.join(OUT, name + ".webp");
    const info = await sharp(input).resize({ width: WIDTH, kernel: "lanczos3" }).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(file);
    height = info.height;
    const bytes = fs.statSync(file).size;
    total += bytes;
    largest = Math.max(largest, bytes);
  };
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      let input;
      if (rank === "ace") input = suit === "spades" ? path.join(faceDir, "ace_of_spades.png") : await flatAce(suit);
      else if (rank === "jack" || rank === "queen" || rank === "king") input = path.join(faceDir, `${rank}_of_${suit}2.png`);
      else input = path.join(faceDir, `${rank}_of_${suit}.png`);
      await write(input, `${suit}-${SHORT[rank] || rank}`);
    }
  }
  // the back, drawn at the faces' size (its sheet is a shade wider: 250 x 350),
  // printed on white card and cut to the faces' own rounded outline
  const face = await rgba(path.join(faceDir, "2_of_clubs.png"));
  const back = await sharp(fs.readFileSync(backSvg), { density: 72 * (face.w / 250) })
    .resize({ width: face.w, height: face.h, fit: "fill" })
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const card = Buffer.alloc(face.w * face.h * 4);
  for (let i = 0, j = 0; i < card.length; i += 4, j += 3) {
    card[i] = back[j];
    card[i + 1] = back[j + 1];
    card[i + 2] = back[j + 2];
    card[i + 3] = face.data[i + 3];
  }
  await write(await sharp(card, { raw: { width: face.w, height: face.h, channels: 4 } }).png().toBuffer(), "back");
  console.log(`53 cards at ${WIDTH} x ${height}: ${Math.round(total / 1024)} KB in all, largest ${Math.round(largest / 1024)} KB -> ${OUT}`);
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
