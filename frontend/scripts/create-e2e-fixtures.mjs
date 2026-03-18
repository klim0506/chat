#!/usr/bin/env node
/** Create minimal test files for E2E: photo1-3.png, doc.pdf, audio.webm, video.webm */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../public/e2e-fixtures");
fs.mkdirSync(FIXTURES_DIR, { recursive: true });

// Minimal 1x1 PNG (binary)
const minimalPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64"
);

// Minimal PDF
const minimalPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000103 00000 n \ntrailer<< /Size 4 /Root 1 0 R >>startxref\n164\n%%EOF",
  "utf8"
);

// Minimal WebM (EBML header)
const minimalWebm = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01,
  0xb3, 0x81, 0x04, 0x80, 0x81, 0x02, 0x80, 0x81, 0x02, 0x80, 0x81, 0x02,
  0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x15,
  0x49, 0xa9, 0x66, 0xa2, 0xd6, 0x8b, 0xb2, 0x80, 0x81, 0x04, 0x80, 0x81,
  0x08, 0x80, 0x81, 0x0e, 0x4d, 0x80, 0x86, 0x86, 0x77, 0x65, 0x62, 0x6d,
]);

fs.writeFileSync(path.join(FIXTURES_DIR, "photo1.png"), minimalPng);
fs.writeFileSync(path.join(FIXTURES_DIR, "photo2.png"), minimalPng);
fs.writeFileSync(path.join(FIXTURES_DIR, "photo3.png"), minimalPng);
fs.writeFileSync(path.join(FIXTURES_DIR, "doc.pdf"), minimalPdf);
fs.writeFileSync(path.join(FIXTURES_DIR, "audio.webm"), minimalWebm);
fs.writeFileSync(path.join(FIXTURES_DIR, "video.webm"), minimalWebm);

console.log("Created fixtures in", FIXTURES_DIR);
