// Players get the site's scripts minified (no comments, short local names, no
// source maps) and its stylesheets and pages without comments (2026-11-23).
// Built once at start-up from the files as written in public/ and lib/; the
// files on disk are not changed. RBV_PLAIN_ASSETS=1 serves them as written.
//
// This makes the code harder to read in the browser's inspector; it cannot
// hide it (whatever a browser runs, its user can read). What keeps the game
// fair is that the server checks every purchase, deal and payout.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SKIP_DIRS = new Set(["tools", "uploads", "images", "sounds", "node_modules"]);
const TYPES = {
  ".js": "application/javascript; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".html": "text/html; charset=UTF-8",
};

function listFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) listFiles(full, out);
    } else if (TYPES[path.extname(entry.name).toLowerCase()]) {
      out.push(full);
    }
  }
  return out;
}

// Comments out and blank runs shortened; quoted strings kept as they are.
function minifyCss(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) {
        if (css[j] === "\\") j++;
        j++;
      }
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f") {
      while (i < css.length && /\s/.test(css[i])) i++;
      // one space, also where a comment came out between two blank runs
      if (!out.endsWith(" ")) out += " ";
      continue;
    }
    out += c;
    i++;
  }
  // braces and semicolons never need the space round them
  return out.replace(/ ?([{};]) ?/g, "$1").replace(/;}/g, "}").trim();
}

// Comments out (not the old "if IE" kind) and indentation gone; line breaks
// stay, so the space between words and inline elements is as it was.
function minifyHtml(html) {
  return html
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

async function minifyJs(code, terser) {
  const result = await terser.minify(code, {
    ecma: 2020,
    module: false,
    compress: { passes: 1 },
    mangle: true, // local names only: what one file shares with another is global and kept
    keep_fnames: true,
    keep_classnames: true,
    format: { comments: false },
    sourceMap: false,
  });
  return result.code;
}

function entry(body, file) {
  const buf = Buffer.from(body, "utf8");
  return {
    body: buf,
    type: TYPES[path.extname(file).toLowerCase()],
    etag: '"' + crypto.createHash("sha1").update(buf).digest("base64").slice(0, 27) + '"',
  };
}

// url path ("/game/game.js") -> { body, type, etag }
async function buildAssets(rootDir) {
  const terser = require("terser");
  const map = new Map();
  const failed = [];
  const jobs = [];
  const publicDir = path.join(rootDir, "public");
  const libDir = path.join(rootDir, "lib");
  for (const file of listFiles(publicDir)) {
    jobs.push([file, "/" + path.relative(publicDir, file).split(path.sep).join("/")]);
  }
  // the shared modules the browser loads from /lib
  for (const name of fs.readdirSync(libDir)) {
    if (name.endsWith(".js") && name !== "minifyAssets.js" && name !== "socketGameAuth.js") {
      jobs.push([path.join(libDir, name), "/lib/" + name]);
    }
  }
  for (const [file, url] of jobs) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.trim()) continue; // an empty file has nothing to shorten
    const ext = path.extname(file).toLowerCase();
    try {
      const out =
        ext === ".js" ? await minifyJs(src, terser) : ext === ".css" ? minifyCss(src) : minifyHtml(src);
      if (typeof out !== "string" || !out.length) throw new Error("empty result");
      map.set(url, entry(out, file));
    } catch (error) {
      failed.push(`${url} (${error.message})`); // served as written
    }
  }
  return { map, failed };
}

// Answers for the minified copies; anything else goes on to express.static
function assetMiddleware(map) {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const hit = map.get(req.path);
    if (!hit) return next();
    res.setHeader("Content-Type", hit.type);
    res.setHeader("Cache-Control", "public, max-age=0");
    res.setHeader("ETag", hit.etag);
    if (req.headers["if-none-match"] === hit.etag) return res.status(304).end();
    if (req.method === "HEAD") return res.end();
    res.end(hit.body);
  };
}

// For the routes that send a page by name: the minified copy when there is one
function pageSender(map, rootDir) {
  return (res, relFile) => {
    const url = "/" + relFile.replace(/^public\//, "");
    const hit = map.get(url);
    if (!hit) return res.sendFile(path.join(rootDir, relFile));
    res.setHeader("Content-Type", hit.type);
    res.setHeader("Cache-Control", "no-cache");
    res.end(hit.body);
  };
}

module.exports = { buildAssets, assetMiddleware, pageSender, minifyCss, minifyHtml };
