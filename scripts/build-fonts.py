#!/usr/bin/env python3
"""Subset the Open Sans TTFs to WOFF2 for the Svelte participant page.

    pip install fonttools brotli      # once
    python3 scripts/build-fonts.py    # or: npm run build:fonts

Reads  public/assets/Font/open-sans/OpenSans-<Style>.ttf
Writes migration/src/assets/fonts/open-sans-<weight>[-italic].woff2

Only the glyphs the UI can print are kept: Basic Latin, Latin-1 Supplement and
general punctuation (quotes, dashes, bullet, ellipsis), plus the euro sign and
trademark sign. That keeps the six faces small enough to inline into the
single-file participant page (no CDN, no extra requests). Open Sans is
Apache-2.0; the licence text is copied next to the output and the licence name
records (name IDs 0, 13, 14) are kept inside each font file.

The output is committed. Re-run this only when the source TTFs or the glyph
ranges change; builds never need Python.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

try:
    from fontTools import subset
    from fontTools.ttLib import TTFont
except ImportError:  # pragma: no cover - environment guidance only
    sys.exit("fontTools and brotli are required: pip install fonttools brotli")

try:
    import brotli  # noqa: F401  (fontTools needs it to write WOFF2)
except ImportError:  # pragma: no cover
    sys.exit("brotli is required to write WOFF2: pip install fonttools brotli")

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "assets" / "Font" / "open-sans"
OUTPUT = ROOT / "migration" / "src" / "assets" / "fonts"

# (source file stem, CSS weight, CSS style)
FACES = [
    ("OpenSans-Light", 300, "normal"),
    ("OpenSans-Regular", 400, "normal"),
    ("OpenSans-Semibold", 600, "normal"),
    ("OpenSans-Bold", 700, "normal"),
    ("OpenSans-ExtraBold", 800, "normal"),
    ("OpenSans-ExtraBoldItalic", 800, "italic"),
]

UNICODES = ",".join(
    [
        "U+0020-007E",  # Basic Latin
        "U+00A0-00FF",  # Latin-1 Supplement
        "U+2010-2027",  # hyphens, dashes, curly quotes, bullet, ellipsis
        "U+2030-203A",  # per mille, primes, guillemets
        "U+20AC",  # euro
        "U+2122",  # trademark
    ]
)

# GSUB features worth keeping. The font has no GPOS; its kerning lives in the
# legacy `kern` table, which the subsetter keeps by default.
FEATURES = ["liga", "locl", "tnum", "lnum", "pnum"]

# Licence/copyright name records stay in the file; everything else extra goes.
NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 13, 14]

BUDGET_BYTES_TOTAL = 110_000  # raw WOFF2; about 147 KB once base64-inlined


def subset_face(stem: str, weight: int, style: str) -> Path:
    source = SOURCE / f"{stem}.ttf"
    if not source.is_file():
        sys.exit(f"missing source font: {source}")

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = FEATURES
    options.name_IDs = NAME_IDS
    options.name_languages = [0x409]
    options.hinting = False
    options.notdef_outline = True
    options.glyph_names = False
    options.legacy_kern = True
    options.drop_tables += ["DSIG", "MVAR", "STAT"]

    font = TTFont(str(source))
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)

    name = f"open-sans-{weight}" + ("-italic" if style == "italic" else "")
    target = OUTPUT / f"{name}.woff2"
    font.flavor = "woff2"
    font.save(str(target))
    return target


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for stem, weight, style in FACES:
        target = subset_face(stem, weight, style)
        size = target.stat().st_size
        total += size
        check = TTFont(str(target))
        glyphs = len(check.getGlyphOrder())
        kern = "kern" in check
        print(f"{target.name:28} {size:7,d} B  {glyphs:3d} glyphs  kern={'yes' if kern else 'NO'}")
        if not kern:
            sys.exit(f"{target.name} lost its kerning table")

    licence = SOURCE / "Apache License.txt"
    if licence.is_file():
        shutil.copyfile(licence, OUTPUT / "LICENSE-OpenSans-Apache-2.0.txt")
    else:
        sys.exit(f"missing licence file: {licence}")

    print(f"{'total':28} {total:7,d} B  (budget {BUDGET_BYTES_TOTAL:,d} B raw)")
    if total > BUDGET_BYTES_TOTAL:
        sys.exit("fonts exceed the size budget; narrow the unicode ranges or features")


if __name__ == "__main__":
    main()
