#!/usr/bin/env python3
"""Subset Open Sans for the leader report (the PDF made in Admin -> Results).

    pip install fonttools             # once
    python3 scripts/build-report-fonts.py

Reads  public/assets/Font/open-sans/OpenSans-<Style>.ttf
Writes migration/src/assets/report-fonts/open-sans-report.js   (generated, committed)
       migration/src/assets/report-fonts/LICENSE-OpenSans-Apache-2.0.txt

Why a second set of files, when the admin page already inlines Open Sans as WOFF2:
a PDF embeds TrueType outlines, and nothing in a browser turns WOFF2 back into
TrueType. So the report carries its own two faces (Regular and Bold) as TrueType,
subset to what a name, a question or a comment in a Latin script can hold: Basic
Latin, Latin-1 Supplement, Latin Extended-A, general punctuation, the euro and
trademark signs, and U+FFFD, which the report prints in place of a character the
font does not have (an emoji, another script).

Hinting, kerning and layout tables are dropped: jsPDF reads none of them, and a
PDF viewer needs none. The two faces are then joined end to end, deflated as ONE
stream (zlib, level 9) and written as base64. Measured in the gzipped admin page,
which is one HTML file: base64 of the raw TrueType is about 33 kB for the two;
deflated one face at a time, 28.1 kB; deflated together, 26 kB, because much of the
second face (the character map, the accented letters built from the same parts)
repeats the first. The page inflates it with DecompressionStream only when a
report is made (migration/src/lib/report-fonts.js) and cuts it at each face's size.

Sizes that were measured and not chosen (two faces, this subset, gzipped page):
one face 13.7 kB; three (with Italic) 41.9 kB; four (with Semibold) 55.7 kB;
without Latin Extended-A 21.9 kB. The admin page's budget has room for two.

Open Sans is Apache-2.0. The licence text is copied next to the output and the
copyright and licence name records (name IDs 0, 13, 14) stay inside each face, so
they travel into every PDF that embeds it.

Re-run this only when the source TTFs or the ranges change; builds never need Python.
scripts/test-leader-report.js checks the committed output (coverage, licence records, size).
"""
from __future__ import annotations

import base64
import io
import shutil
import sys
import zlib
from pathlib import Path

try:
    from fontTools import subset
    from fontTools.ttLib import TTFont
except ImportError:  # pragma: no cover - environment guidance only
    sys.exit("fontTools is required: pip install fonttools")

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "assets" / "Font" / "open-sans"
OUTPUT = ROOT / "migration" / "src" / "assets" / "report-fonts"

# (source file stem, the name the PDF knows the face by, bold?)
FACES = [
    ("OpenSans-Regular", "OpenSans-Regular", False),
    ("OpenSans-Bold", "OpenSans-Bold", True),
]

RANGES = [
    ("U+0020-007E", "Basic Latin"),
    ("U+00A0-00FF", "Latin-1 Supplement"),
    ("U+0100-017F", "Latin Extended-A"),
    ("U+2010-2014", "hyphens and dashes"),
    ("U+2018-201A", "single curly quotes"),
    ("U+201C-201E", "double curly quotes"),
    ("U+2020-2022", "dagger, double dagger, bullet"),
    ("U+2026", "ellipsis"),
    ("U+2039-203A", "single guillemets"),
    ("U+20AC", "euro"),
    ("U+2122", "trademark"),
    ("U+2212", "minus"),
    ("U+FFFD", "replacement character, printed for anything the font lacks"),
]
UNICODES = ",".join(code for code, _ in RANGES)

# Copyright (0), family and style (1, 2), unique id (3), full name (4), PostScript name (6), licence (13), licence URL (14).
NAME_IDS = [0, 1, 2, 3, 4, 6, 13, 14]

BUDGET_BASE64_TOTAL = 35_500  # characters of base64 for the two faces together; about 26 kB of the gzipped admin page


def subset_face(stem: str) -> bytes:
    source = SOURCE / f"{stem}.ttf"
    if not source.is_file():
        sys.exit(f"missing source font: {source}")

    options = subset.Options()
    options.layout_features = []
    options.name_IDs = NAME_IDS
    options.name_languages = [0x409]
    options.hinting = False
    options.notdef_outline = True
    options.glyph_names = False
    options.legacy_kern = False
    options.drop_tables += ["DSIG", "MVAR", "STAT", "GSUB", "GPOS", "GDEF", "kern", "gasp"]

    font = TTFont(str(source))
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    faces = []
    total = 0
    for stem, name, bold in FACES:
        data = subset_face(stem)
        check = TTFont(io.BytesIO(data))
        cmap = check.getBestCmap()
        names = {record.nameID for record in check["name"].names}
        for required in (0, 13, 14):
            if required not in names:
                sys.exit(f"{name} lost its licence record (name ID {required})")
        for code in (0x4A, 0xE9, 0xEB, 0xF8, 0x141, 0x2019, 0xFFFD):  # J é ë ø Ł ’ and the replacement character
            if code not in cmap:
                sys.exit(f"{name} has no glyph for U+{code:04X}")
        faces.append((name, bold, data, len(cmap)))
        print(f"{name:20} {len(data):7,d} B TrueType  {len(check.getGlyphOrder()):3d} glyphs  {len(cmap):3d} characters")
    packed = base64.b64encode(zlib.compress(b"".join(data for _, _, data, _ in faces), 9)).decode("ascii")
    total = len(packed)

    lines = [
        "// GENERATED by scripts/build-report-fonts.py from public/assets/Font/open-sans. Do not edit by hand.",
        "//",
        "// Open Sans, Regular and Bold, for the leader report's PDF: TrueType outlines (a PDF cannot embed the WOFF2 the page itself uses),",
        "// subset, with hinting, kerning and layout tables dropped, then joined end to end, deflated as one stream (zlib) and written as",
        "// base64. Inflate with DecompressionStream('deflate') and cut at each face's `bytes`; migration/src/lib/report-fonts.js does,",
        "// and only when a report is made.",
        "//",
        "// Open Sans is licensed under the Apache License, Version 2.0 (LICENSE-OpenSans-Apache-2.0.txt, beside this file). The copyright and",
        "// licence name records are kept inside each face, so they are in every PDF that embeds it.",
        "",
        "/** What the faces cover. A character outside these is printed as U+FFFD. */",
        "export const REPORT_FONT_RANGES = Object.freeze([",
        *[f"  ['{code}', '{label}']," for code, label in RANGES],
        "]);",
        "",
        "/** The faces, in the order their bytes follow each other in REPORT_FONT_DATA. @type {readonly { name: string, bold: boolean, bytes: number, characters: number }[]} */",
        "export const REPORT_FONTS = Object.freeze([",
    ]
    for name, bold, data, characters in faces:
        lines.append(f"  {{ name: '{name}', bold: {'true' if bold else 'false'}, bytes: {len(data)}, characters: {characters} }},")
    lines += ["]);", "", "/** Every face, one after another, deflated together, as base64. */", f"export const REPORT_FONT_DATA = '{packed}';", ""]
    (OUTPUT / "open-sans-report.js").write_bytes("\n".join(lines).encode("utf-8"))  # LF on every OS

    licence = SOURCE / "Apache License.txt"
    if not licence.is_file():
        sys.exit(f"missing licence file: {licence}")
    shutil.copyfile(licence, OUTPUT / "LICENSE-OpenSans-Apache-2.0.txt")

    print(f"{'both, one stream':20} {total:7,d} base64 characters (budget {BUDGET_BASE64_TOTAL:,d})")
    if total > BUDGET_BASE64_TOTAL:
        sys.exit("the report fonts exceed their size budget; narrow the ranges")


if __name__ == "__main__":
    main()
