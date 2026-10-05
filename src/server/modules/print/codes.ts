/**
 * QR codes and Code 128 barcodes as inline SVG (pure – no network, no canvas). The QR matrix comes from the
 * open-source `qrcode` package; the Code 128 (set B) encoder is our own.
 */
import QRCode from "qrcode";

/** QR code as an SVG string, `size` in px. */
export function qrSvg(value: string, size = 96): string {
  const qr = QRCode.create(value.slice(0, 1000) || " ", { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2;
  let path = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) path += `M${x + quiet},${y + quiet}h1v1h-1z`;
  }
  const total = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/** The dark / light matrix of a QR code (for the PDF renderer). */
export function qrMatrix(value: string): boolean[][] {
  const qr = QRCode.create(value.slice(0, 1000) || " ", { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  return Array.from({ length: n }, (_r, y) => Array.from({ length: n }, (_c, x) => !!qr.modules.get(x, y)));
}

// Code 128: each symbol is 11 modules (the stop symbol 13), written as bar / space widths.
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

/** Bar widths (alternating bar, space, bar …) of a Code 128-B barcode; characters outside ASCII 32–126 become "?". */
export function code128Widths(value: string): number[] {
  const text = value.replace(/[^\x20-\x7E]/g, "?").slice(0, 60);
  const codes = [START_B, ...[...text].map((c) => c.charCodeAt(0) - 32)];
  const checksum = codes.reduce((sum, code, i) => sum + code * (i === 0 ? 1 : i), 0) % 103;
  return [...codes, checksum, STOP].flatMap((c) => [...PATTERNS[c]!].map(Number));
}

/** Code 128 barcode as an SVG string with the value printed below. */
export function barcodeSvg(value: string, height = 44): string {
  const widths = code128Widths(value);
  const quiet = 10;
  let x = quiet;
  let bars = "";
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
    x += w;
  });
  const total = x + quiet;
  const label = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total * 1.4}" height="${height + 16}" viewBox="0 0 ${total} ${height + 16}" shape-rendering="crispEdges" role="img" aria-label="Barcode ${label}"><rect width="${total}" height="${height + 16}" fill="#fff"/><g fill="#000">${bars}</g><text x="${total / 2}" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="10">${label}</text></svg>`;
}
