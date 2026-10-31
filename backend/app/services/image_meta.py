"""
Remove hidden metadata from uploaded photos (standard library only).

Phone photos carry EXIF data: GPS location, date, phone model, owner name. A vehicle photo published on the
website must not reveal where (or by whom) it was taken, so before a photo is stored:

  JPEG - APP1 (EXIF, XMP), APP13 (Photoshop / IPTC) and COM (comment) segments are dropped. Only the EXIF
         orientation is kept (rebuilt as a minimal EXIF block), otherwise a portrait phone photo would show sideways.
  PNG  - text and EXIF chunks (tEXt, zTXt, iTXt, eXIf, tIME) are dropped.

The image pixels are not touched. Anything the parser does not recognise is copied unchanged, so a valid file is
never broken. (The website also shrinks photos in the browser before upload, which removes metadata as well;
this is the server-side guarantee for every other path.)
"""
import struct
from typing import Optional

_DROP_JPEG = {0xE1, 0xED, 0xFE}                 # APP1 (EXIF / XMP), APP13 (IPTC), COM
_STANDALONE = {0x01, *range(0xD0, 0xD8)}         # TEM, RST0-7: no length field
_DROP_PNG = {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME"}


def _orientation(exif: bytes) -> Optional[int]:
    """Orientation (1-8) from an APP1 EXIF payload ("Exif\\0\\0" + TIFF), or None."""
    if not exif.startswith(b"Exif\x00\x00") or len(exif) < 14:
        return None
    tiff = exif[6:]
    order = {b"II": "<", b"MM": ">"}.get(tiff[:2])
    if order is None:
        return None
    try:
        (ifd,) = struct.unpack(order + "I", tiff[4:8])
        (count,) = struct.unpack(order + "H", tiff[ifd:ifd + 2])
        for i in range(min(count, 512)):
            entry = tiff[ifd + 2 + i * 12: ifd + 14 + i * 12]
            tag, kind, _n = struct.unpack(order + "HHI", entry[:8])
            if tag == 0x0112 and kind == 3:
                (value,) = struct.unpack(order + "H", entry[8:10])
                return value if 1 <= value <= 8 else None
    except struct.error:
        return None
    return None


def _orientation_segment(value: int) -> bytes:
    """A minimal APP1 EXIF segment that holds only the orientation."""
    tiff = b"MM\x00\x2a" + struct.pack(">I", 8) + struct.pack(">H", 1) \
        + struct.pack(">HHIHH", 0x0112, 3, 1, value, 0) + struct.pack(">I", 0)
    payload = b"Exif\x00\x00" + tiff
    return b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload


def strip_jpeg(data: bytes) -> bytes:
    if not data.startswith(b"\xff\xd8"):
        return data
    out = [b"\xff\xd8"]
    orientation = None
    i = 2
    n = len(data)
    while i + 1 < n:
        if data[i] != 0xFF:
            break                                      # not a marker: copy the rest unchanged
        marker = data[i + 1]
        if marker == 0xFF:                             # fill byte
            i += 1
            continue
        if marker in _STANDALONE:
            out.append(data[i:i + 2])
            i += 2
            continue
        if marker in (0xD9, 0xDA) or i + 4 > n:        # end of image / start of scan: image data follows
            break
        (length,) = struct.unpack(">H", data[i + 2:i + 4])
        if length < 2 or i + 2 + length > n:
            break
        segment = data[i:i + 2 + length]
        if marker == 0xE1 and orientation is None:
            orientation = _orientation(segment[4:])
        if marker not in _DROP_JPEG:
            out.append(segment)
        i += 2 + length
    if orientation and orientation != 1:
        out.insert(1, _orientation_segment(orientation))
    out.append(data[i:])
    return b"".join(out)


def strip_png(data: bytes) -> bytes:
    signature = b"\x89PNG\r\n\x1a\n"
    if not data.startswith(signature):
        return data
    out = [signature]
    i = len(signature)
    n = len(data)
    while i + 8 <= n:
        (length,) = struct.unpack(">I", data[i:i + 4])
        kind = data[i + 4:i + 8]
        end = i + 12 + length
        if end > n:
            break
        if kind not in _DROP_PNG:
            out.append(data[i:end])
        i = end
        if kind == b"IEND":
            break
    out.append(data[i:])
    return b"".join(out)


def strip_metadata(data: bytes, content_type: str) -> bytes:
    if content_type == "image/jpeg":
        return strip_jpeg(data)
    if content_type == "image/png":
        return strip_png(data)
    return data
