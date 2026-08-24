# Checkpoint — UI rules

Written down because the same question kept coming back: *what colour is a
button?* The answer has to be one answer, or the screen stops meaning anything.

## The one rule that matters

**Colour means state, not importance.**

Green, red and amber describe **what the data is** — a trailer that passed, a
temperature out of range, a check that is due. They never describe how much a
button matters. If green means "checked" on a tile, a green button beside it
reads as another checked thing, not as an action.

So: **every primary action in the app is Martin Brower black.**

## Palette

| Token | Value | What it means |
|---|---|---|
| `--blue` | `#000E19` | MB black. Header, and **every primary button**. |
| `--blue2` | `#4C6C1A` | MB dark green. Focus rings, progress, secondary accent. |
| `--lime` | `#BEF91B` | The brand accent. Focus outline on dark, "act now" glow. |
| `--bg` | `#F2EEE6` | MB beige. The page. |
| `--card` | `#FFFAF1` | MB warm white. Cards. |
| `--green` | `#4C6C1A` | **State only**: checked, in range, completed, arrived. |
| `--red` | `#C0392B` | **State only**: escalate, out of range, no-show, missing. |
| `#C9A227` | amber | **State only**: due, expected, carried over, awaiting. |
| `#3E7CA8` | blue | **State only**: on site, in progress. |
| `--mut` | `#4C5763` | Secondary text. |

`--green` and `--blue2` are the same hex. That is deliberate for the brand, and
it is exactly why a green button and a "checked" tile were indistinguishable.

## Buttons

| Class | Looks like | Use for |
|---|---|---|
| `.btn` | black, white text, full width | the primary action on a screen |
| `.btn.sec` | warm grey, black text | the secondary way out — Back, Share, Edit |
| `.btn.red` | pale red, red text | **destructive only** — Clear all, Discard |

There is no green button. There used to be, and it was the bug.

Buttons are **full width by default**. A screen ends with its primary action
across the foot, which is what a thumb expects on a phone or an iPad. Cap the
width with `max-width` where a screen is wide; do not make one button a
different shape from every other button.

## Every interactive thing must react

Three states, no exceptions:

- **`:hover`** — a shade darker. Silence here reads as "this is not a button".
- **`:active`** — `translateY(1px)`. The press is felt.
- **`:focus-visible`** — a 3px outline, offset 2px. Lime on dark, `--blue2` on
  light. Never `outline:none` without putting something back.

`:disabled` is `opacity:.45`, `cursor:not-allowed`, and **says why** — but in a
hint line beneath it, not stuffed into the label. The button keeps its own name
("Submit to manager") and the line under it explains the wait ("Available at
6am, when your shift ends"). A dead button with no reason is the thing to
avoid; a button carrying a sentence is not the fix.

## Headings

Any heading inside a dark bar is **centred in that bar**, never tucked against
the back arrow. Use the app header's pattern: `grid-template-columns:1fr auto 1fr`
with the controls pinned to columns 1 and 3. Equal `1fr` side columns are what
make the centre true; a flex row with `flex:1` on the title does not centre it.

## Class names

The stylesheet is one file and there is no scoping, so **check a new class name
against the whole sheet before using it**. This has bitten three times:

- `.tile` was the home screen's playing card, with `aspect-ratio:1` — a
  full-width strip borrowed it and became a 1400px square.
- `.hdr` was the app header bar — a table row borrowed it and stacked.
- `#sec-form{display:flex}` out-ranked `section{display:none}`, so the form
  rendered on every screen.

Two traps worth remembering: **an id beats a `section{display:none}` rule**, and
**`display:flex` beats the `hidden` attribute**. If an element can be hidden,
add `.thing[hidden]{display:none}`.

## Text

- No em dashes in anything a user reads.
- Say what a thing is, not what it is called twice: "Sign In / Seal
  Verification", not "Seal Form / Seal verification".
- An empty state says which kind of empty it is: "Nothing scheduled for today"
  is a different problem from "The schedule has not been loaded yet".

## Accessibility

- Text meets WCAG AA against the colour actually behind it, not the token.
- A chart states its numbers in its `aria-label`; colour is never the only
  carrier of meaning. Two swatches in one key must never share a colour.
- `prefers-reduced-motion` turns off every animation that moves or pulses.

## Dark mode: no light literals

`#fff`, `#EDF0F4`, `#FFFDF0` and the rest are **only** allowed inside something
that is pretending to be paper: `table.prn`, `.prnwrap`, `.darpaper`,
`table.ycsheet`, `#bkview .dvbody`. Those are previews of a thing that gets
emailed and printed, and paper is not dark.

Everywhere else, a colour comes from a token, so dark mode needs no override
at all. Adding `:root[data-theme="dark"] .thing{...}` to undo a literal is the
wrong fix: it leaves the literal in place for the next state nobody thought of.
That is exactly how a focused cell in the staging grid stayed `#FFFDF0` long
after the grid around it went dark.

The state colours are fills. As **text** on a dark card they fail: use
`--redink`, `--greenink`, `--amberink`, which are the brand hex in light and
lifted in dark.

Two audits enforce this, and they cover focus states, not just the resting
page: `every officer screen is readable in the dark` and `every receiving
office screen is readable in the dark` in `tests/prefs.spec.js`.

## Rows of data with actions on them

The loaded-orders list is the pattern to copy. Three rules, all of them from
how a ledger is read rather than from how a sentence is written:

- **Figures get columns, not commas.** "25 orders · 23,539 cases · 305 pallets"
  is one sentence that lines up with nothing. Three right-aligned cells, each
  with its name under it and `font-variant-numeric:tabular-nums`, line up down
  the whole list so two days can be compared without reading either.
- **Actions are separated from the reading** by a rule, at the trailing edge,
  three at most. They are always visible: this is used on an iPad, and a
  hover-to-reveal row is a row with no actions at all on a touch screen.
- **Line icons, never emoji.** Emoji are a different weight, colour and
  baseline on every device, and three side by side never sit straight. One
  `<svg>` per action, `stroke:currentColor`, so hover and dark mode carry it.

A tile in a bento grid is as tall as its tallest neighbour, so anything inside
it with a fixed height leaves the rest empty. Give charts `flex:1 1 auto` and a
`min-height`, not a `height`.
