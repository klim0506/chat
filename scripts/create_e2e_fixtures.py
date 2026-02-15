#!/usr/bin/env python3
"""Create minimal test files for E2E testing: photo1-3.png, doc.pdf, audio.webm, video.webm."""
import struct
from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "e2e-fixtures"
FIXTURES_DIR.mkdir(parents=True, exist_ok=True)


def create_minimal_png(path: Path) -> None:
    """Create a 1x1 grey PNG."""
    # PNG signature
    signature = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    # IHDR chunk: width=1, height=1, bit depth 8, color type 0 (greyscale)
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0)
    ihdr_crc = 0x0D4F3C9F  # Precomputed CRC for this IHDR
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_data + struct.pack(">I", ihdr_crc)
    # IDAT: compressed 1x1 pixel (filter byte 0 + raw pixel 0x00)
    import zlib
    raw = bytes([0, 0])
    idat_data = zlib.compress(raw, 9)
    idat_crc = 0x5E7B1D0B  # Will be wrong - compute properly
    idat_crc = struct.unpack(">I", bytes.fromhex(hex(zlib.crc32(b"IDAT" + idat_data) & 0xFFFFFFFF)[2:].zfill(8)))[0]
    idat = struct.pack(">I", len(idat_data)) + b"IDAT" + idat_data + struct.pack(">I", idat_crc & 0xFFFFFFFF)
    # IEND
    iend_crc = 0xAE426082
    iend = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", iend_crc)
    path.write_bytes(signature + ihdr + idat + iend)


def create_minimal_png_simple(path: Path) -> None:
    """Create minimal valid 1x1 PNG using standard approach."""
    import zlib

    def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
        chunk = chunk_type + data
        crc = zlib.crc32(chunk) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk + struct.pack(">I", crc)

    # 1x1 grey pixel
    raw_data = bytes([0, 0])  # filter 0, grey value 0
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0)
    idat = zlib.compress(raw_data, 9)
    png = b"\x89PNG\r\n\x1a\n"
    png += png_chunk(b"IHDR", ihdr)
    png += png_chunk(b"IDAT", idat)
    png += png_chunk(b"IEND", b"")
    path.write_bytes(png)


def create_minimal_pdf(path: Path) -> None:
    """Create minimal valid PDF."""
    pdf = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj

xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 

trailer
<< /Size 4 /Root 1 0 R >>
startxref
204
%%EOF"""
    path.write_bytes(pdf)


def create_minimal_webm(path: Path) -> None:
    """Create minimal WebM container (EBML header + segment)."""
    minimal = (
        b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01"
        b"\xb3\x81\x04\x80\x81\x02\x80\x81\x02\x80\x81\x02"
        b"\x18\x53\x80\x67\x01\xff\xff\xff\xff\xff\xff\xff\x15"
        b"\x49\xa9\x66\xa2\xd6\x8b\xb2\x80\x81\x04\x80\x81"
        b"\x08\x80\x81\x0e\x4d\x80\x86\x86\x77\x65\x62\x6d"
    )
    path.write_bytes(minimal)


def main() -> None:
    create_minimal_png_simple(FIXTURES_DIR / "photo1.png")
    create_minimal_png_simple(FIXTURES_DIR / "photo2.png")
    create_minimal_png_simple(FIXTURES_DIR / "photo3.png")
    create_minimal_pdf(FIXTURES_DIR / "doc.pdf")
    create_minimal_webm(FIXTURES_DIR / "audio.webm")
    create_minimal_webm(FIXTURES_DIR / "video.webm")
    print(f"Created fixtures in {FIXTURES_DIR}")


if __name__ == "__main__":
    main()
