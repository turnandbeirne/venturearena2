#!/usr/bin/env python3
"""Turn a VentureBoom card illustration into the two files the game uses.

    python3 scripts/import-card-art.py <image> <card-key> [--reframe] [--window=l,t,r,b | --window-px=l,t,r,b] [--no-border]
    python3 scripts/import-card-art.py <image> back --above-footer-px=l,t,r,b [--paint-px=x,y,x,y,...]
    python3 scripts/import-card-art.py my-unicorn.jpg unicorn

The illustration is a whole card (frame, art window, blank header and footer)
on any plain background (white, grey, a photographed table), with no text on
it: the game draws the name and the rules on top. This script finds the card
by its navy frame, trims everything outside it, and writes

    src/games/ventureboom/art/sm/<card-key>.webp   240 px wide, for cards in play
    src/games/ventureboom/art/lg/<card-key>.webp   720 px wide, for the opened card

<card-key> is the card's key in cards.js (the slug of its name: "Sir
Solders-a-Lot" is sir-solders-a-lot), the art name of one copy of a card
(pivot-video: see PIVOT_ART in cards.js), or "back" for the back of the deck.
tests/ventureboom-art.test.js fails on a name that is not a card.

--reframe is for an illustration drawn in one of the two earlier card frames
(the one with the logo in the middle of the footer, and the one with grey
boxes where the text goes). It lifts the picture, with its gold border, out
of that frame and sets it into the standard frame (scripts/card-frame.webp), so
every card in the deck has the same header and footer for the game to write on.

--window=l,t,r,b (with --reframe) is for a card whose layout is none of the
known ones: it says where the picture, with its border, sits on that card, as
fractions of the card's width (l, r) and height (t, b).
    python3 scripts/import-card-art.py reorg.jpg reorg --reframe --window=0.058,0.041,0.944,0.817

--window-px=l,t,r,b (with --reframe) gives the same box in pixels of the image
itself, for a photo where the card cannot be found cleanly: one lying on a
stack of other cards, or with other cards over its corner. Only the picture
inside that box is used, so whatever surrounds it does not matter.
    python3 scripts/import-card-art.py photo.jpg moonshot-molly --reframe --window-px=100,211,764,977

--no-border (with --reframe) is for a picture drawn WITHOUT the gold border the
other cards have. The box is then the picture alone, and it is set inside the
standard frame's own gold border (scripts/card-frame-border.webp), so it
matches the rest of the deck.
    python3 scripts/import-card-art.py photo.jpg prototype-pete --reframe --no-border --window-px=100,210,764,977

--above-footer-px=l,t,r,b is for art with no picture window at all, which
covers the whole card above the footer band: the back of the deck. The box is
that area in pixels of the image; the standard footer is added beneath it.
--paint-px=x,y,x,y,... paints a polygon (pixels of the image) with the card's
own navy first: for a corner that something else was lying on in the photo.
    python3 scripts/import-card-art.py back.jpg back --above-footer-px=40,42,826,994 --paint-px=827,788,796,788,786,796,781,812,779,840,764,995,827,995

Needs Python 3 with Pillow. The originals are not kept in the repository.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

RATIO = 1.445  # height / width of a card face (board.css .vb__card)
SIZES = {'sm': (240, 80), 'lg': (720, 82)}  # folder: (width, webp quality)


def _navy(p):
    """The dark blue of the card frame."""
    r, g, b = p
    return r + g + b < 250 and b >= r and b >= g - 6 and r < 75


def card_box(im):
    """The card's bounding box: the outermost columns and rows that are mostly frame navy.

    (An earlier version looked for "not white", which only worked for a card
    on a white background: on a grey or wooden one it kept the background.)
    """
    w, h = im.size
    px = im.load()
    ys, xs = range(0, h, 3), range(0, w, 3)
    cols = [x for x in range(w) if sum(_navy(px[x, y]) for y in ys) > 0.45 * len(ys)]
    rows = [y for y in range(h) if sum(_navy(px[x, y]) for x in xs) > 0.45 * len(xs)]
    if not cols or not rows:
        sys.exit('No card found: this script looks for the navy card frame.')
    # A hair inside the edge, so no background fringe survives the resize.
    inset = max(2, round((cols[-1] - cols[0]) * 0.004))
    return (cols[0] + inset, rows[0] + inset, cols[-1] + 1 - inset, rows[-1] + 1 - inset)


def square_corners(card):
    """Paint the frame's own navy over the four corners.

    The artwork's corners are rounded, so the background shows in them. The
    game rounds the corners itself, more than the artwork does: squaring them
    here means no background colour can ever show at a corner.
    """
    w, h = card.size
    navy = card.getpixel((round(w * 0.03), round(h * 0.5)))
    c = round(w * 0.03)
    d = ImageDraw.Draw(card)
    for x, y in ((0, 0), (w - c, 0), (0, h - c), (w - c, h - c)):
        d.rectangle((x, y, x + c, y + c), fill=navy)
    return card


# Where the picture (with its gold border) sits on a card, as fractions of the
# card: left, top, right, bottom. Measured from the artwork.
WINDOW = (0.074, 0.147, 0.925, 0.827)           # the standard frame, and the grey-box frame
WINDOW_CENTRE_LOGO = (0.090, 0.146, 0.911, 0.813)  # the earlier frame: full bleed, logo in the middle
FRAME = Path(__file__).resolve().parent / 'card-frame.webp'
# The same frame with its gold border kept, and where the picture sits inside that border.
FRAME_BORDER = Path(__file__).resolve().parent / 'card-frame-border.webp'
INSIDE_BORDER = (0.0801, 0.1509, 0.919, 0.8218)
FOOTER_TOP = 0.8417  # the footer band (with the ledge above it) starts here on the standard frame


def reframe(card, window=None):
    """The picture from another frame, set into the standard frame."""
    full_bleed = card.height / card.width < RATIO - 0.02
    fx0, fy0, fx1, fy1 = window or (WINDOW_CENTRE_LOGO if full_bleed else WINDOW)
    w, h = card.size
    return set_in_frame(card.crop((round(fx0 * w), round(fy0 * h), round(fx1 * w), round(fy1 * h))))


def set_in_frame(picture, border=True):
    """A picture set into the standard frame.

    border=True: the picture comes with its own gold border, and fills the window.
    border=False: the picture has none, and goes inside the frame's own border.
    """
    shape = picture.height / picture.width
    if abs(shape - 1.155) > 0.04:
        sys.exit(f'The picture box is {shape:.3f} tall for its width; a card picture is about 1.155. Check the box.')
    frame = Image.open(FRAME if border else FRAME_BORDER).convert('RGB')
    W, H = frame.size
    box = WINDOW if border else INSIDE_BORDER
    x0, y0, x1, y1 = round(box[0] * W), round(box[1] * H), round(box[2] * W), round(box[3] * H)
    picture = picture.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    # Rounded corners, so the frame shows outside the picture's corners.
    mask = Image.new('L', picture.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, picture.width - 1, picture.height - 1), radius=round(W * (0.016 if border else 0.011)), fill=255)
    frame.paste(picture, (x0, y0), mask)
    return frame


def above_footer(im, box, paint=None):
    """Art that covers the whole card above the footer (the back of the deck), on the standard footer."""
    l, t, r, b = box
    navy = im.getpixel((l + round((r - l) * 0.04), t + round((b - t) * 0.04)))
    if paint:
        # The card's navy as it is NEXT to the patch (a photo is not evenly
        # lit), with a soft edge so the patch cannot be seen.
        xs, ys = [p[0] for p in paint], [p[1] for p in paint]
        box_near = im.crop((max(l, min(xs) - 60), min(ys), min(xs), max(ys)))
        near = [box_near.getpixel((x, y)) for y in range(0, box_near.height, 2) for x in range(0, box_near.width, 2)]
        blues = sorted(p for p in near if _navy(p) or (p[2] > p[0] + 15 and p[0] < 70))
        local = blues[len(blues) // 2] if blues else navy
        mask = Image.new('L', im.size, 0)
        ImageDraw.Draw(mask).polygon(paint, fill=255)
        im.paste(Image.new('RGB', im.size, local), (0, 0), mask.filter(ImageFilter.GaussianBlur(1.5)))
        ImageDraw.Draw(im).polygon(paint, fill=local)
    frame = Image.open(FRAME).convert('RGB')
    W, H = frame.size
    top = round(FOOTER_TOP * H)
    frame.paste(im.crop(box).resize((W, top), Image.LANCZOS), (0, 0))
    # The art's own top corners are rounded, with the table showing in them.
    c = round(W * 0.03)
    d = ImageDraw.Draw(frame)
    d.rectangle((0, 0, c, c), fill=navy)
    d.rectangle((W - c, 0, W, c), fill=navy)
    return frame


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = set(sys.argv[1:]) - set(args)
    window = None
    window_px = None
    footer_px = None
    paint = None
    for f in list(flags):
        if f.startswith('--above-footer-px='):
            footer_px = tuple(int(v) for v in f.split('=', 1)[1].split(','))
            flags.discard(f)
            if len(footer_px) != 4:
                sys.exit('--above-footer-px takes four whole numbers: left,top,right,bottom')
            continue
        if f.startswith('--paint-px='):
            v = [int(n) for n in f.split('=', 1)[1].split(',')]
            flags.discard(f)
            if len(v) < 6 or len(v) % 2:
                sys.exit('--paint-px takes at least three x,y points')
            paint = list(zip(v[0::2], v[1::2]))
            continue
        if f.startswith('--window-px='):
            window_px = tuple(int(v) for v in f.split('=', 1)[1].split(','))
            flags.discard(f)
            if len(window_px) != 4 or not (0 <= window_px[0] < window_px[2] and 0 <= window_px[1] < window_px[3]):
                sys.exit('--window-px takes four whole numbers: left,top,right,bottom')
            continue
        if f.startswith('--window='):
            window = tuple(float(v) for v in f.split('=', 1)[1].split(','))
            flags.discard(f)
            if len(window) != 4 or not (0 <= window[0] < window[2] <= 1 and 0 <= window[1] < window[3] <= 1):
                sys.exit('--window takes four fractions: left,top,right,bottom')
    if footer_px:
        if len(args) != 2 or flags or window or window_px:
            sys.exit(__doc__)
    elif len(args) != 2 or paint or flags - {'--reframe', '--no-border'} or ((window or window_px or '--no-border' in flags) and '--reframe' not in flags) or (window and window_px) or ('--no-border' in flags and not window_px):
        sys.exit(__doc__)
    src, key = Path(args[0]), args[1]
    art = Path(__file__).resolve().parent.parent / 'src' / 'games' / 'ventureboom' / 'art'
    im = Image.open(src).convert('RGB')
    if footer_px:
        card = above_footer(im, footer_px, paint)
    elif window_px:
        card = set_in_frame(im.crop(window_px), border='--no-border' not in flags)
    else:
        card = im.crop(card_box(im))
        card = reframe(card, window) if '--reframe' in flags else square_corners(card)
    shape = card.height / card.width
    if abs(shape - RATIO) > 0.04:
        sys.exit(f'{src.name}: the card is {shape:.3f} tall for its width, expected about {RATIO}. Is this the usual card frame?')
    for folder, (width, quality) in SIZES.items():
        out = art / folder / f'{key}.webp'
        out.parent.mkdir(parents=True, exist_ok=True)
        card.resize((width, round(width * RATIO)), Image.LANCZOS).save(out, 'WEBP', quality=quality, method=6)
        print(f'{out.relative_to(art.parent.parent.parent.parent)}  {out.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
