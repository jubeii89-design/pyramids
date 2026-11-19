# Ancient Egypt art — AI image prompts

The theme layer (colours, Cinzel font, carved-stone panels, hieroglyph frieze
and columns) is already built in code. These four images add the scenery and
the gods. Generate them with any image tool whose terms allow **commercial
use** (check your plan), save them under the exact file names below, and put
them in `public/assets/`. Claude then wires them in and records provenance in
`public/assets/ASSETS.md`.

**For every image, keep a note of:** the tool and plan, the exact prompt, and
the date. That note is the project's licensing record.

## Rules that keep the game readable

- **The centre must stay dark and empty.** The board, panels and title sit
  there. All detail goes to the edges.
- **No text, letters or numbers** in the image. The game's own letters must
  be the only letters on screen.
- Don't name a living artist or a "style of <artist>" in any prompt.

## Shared style block

Paste this into every prompt so the four images match:

> Ancient Egyptian temple interior at night, carved sandstone walls with
> painted hieroglyph reliefs, lapis lazuli blue and burnished gold, warm
> torchlight from above, deep shadows, cinematic, highly detailed, painterly
> realism, rich but dark palette, no people in the foreground

**Negative prompt** (or "avoid"): text, letters, words, numbers, watermark,
signature, logo, modern objects, cartoon, anime, bright centre, clutter in
the centre, neon, blur.

## 1. TV / desktop background: `egypt-bg.jpg`

- **Size:** 2560 × 1440 (16:9), JPEG, under ~600 KB.
- **Prompt:** *[shared style]* + Wide symmetrical view down a temple hall.
  Massive columns carved with hieroglyphs stand on the far left and far
  right. The middle of the image is a deep, dark, empty stone wall in shadow.
  A faint gold sun disk glows high at the top centre. Low contrast in the
  middle third.

## 2. Phone background: `egypt-bg-portrait.jpg`

- **Size:** 1080 × 1920 (9:16), JPEG, under ~400 KB.
- **Prompt:** *[shared style]* + Tall narrow view of the same temple. A
  carved hieroglyph frieze runs along the very top edge, and the base of
  columns sits at the very bottom edge. Everything between them is dark,
  plain, shadowed stone. Very quiet and minimal.

## 3. Front-page hero: `egypt-hero.jpg`

- **Size:** 2400 × 900 (8:3), JPEG, under ~500 KB.
- **Prompt:** *[shared style]* + Ancient Egyptian gods painted as a temple
  wall relief in profile, in traditional Egyptian art style. Thoth (ibis
  head, holding a scribe's palette) stands on the left and Anubis (black
  jackal head) behind him. Ra (falcon head with sun disk) stands on the right
  and Isis (winged arms spread) behind him. Both groups face the centre. The
  centre third is an empty dark stone panel, where the game title will sit.

## 4. Link-preview card: no image needed

Claude composites `og.jpg` (1200 × 630) from `egypt-bg.jpg` plus the title,
once image 1 exists.

## Ornament: no image needed

The hieroglyph frieze and the columns are already drawn in code
(`public/assets/egypt-frieze.svg`; the side-wall columns were dropped once the temple photo arrived). They
stay crisp at any size, which a generated ornament would not.

## Expect

- Generated "hieroglyphs" are decorative shapes, not real writing. That's
  fine for scenery; just don't claim they say anything.
- Expect to need 3–6 tries per image to get a dark centre. Reject any image
  whose middle is bright or busy.
