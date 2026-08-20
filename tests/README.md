# Gate Check browser tests

Playwright tests for the sign-in screen, run against Chromium (mobile + desktop)
and WebKit (iPhone).

This directory has its own `package.json` **on purpose**. `netlify.toml` publishes
the repo root with no build command; a root `package.json` would make Netlify start
treating this static site as a Node project and run an install step it does not need.

## Run

    cd tests
    npm run setup     # once: installs Playwright and the browsers
    npm test

    npm test -- --project=webkit-iphone     # one browser
    npm run test:headed                     # watch it happen

The config starts `python3 -m http.server` on port 8899 against the repo root, so
there is nothing to build and no server to start by hand.

## How the tests reach the login screen

`index.html` loads Firebase from `gstatic.com` and `cloud.js` only shows `#login`
once Firebase Auth reports no signed-in user. `helpers.js` therefore:

1. blocks `**/firebasejs/**` so the real SDK never loads, and
2. installs a stub `window.firebase` before page scripts run.

`gotoApp(page, opts)` takes the stub's behaviour:

| option | effect |
|---|---|
| `{}` | signed out — the sign-in screen is shown |
| `{ user: {email} }` | already signed in — the app is shown |
| `{ authError: 'auth/…' }` | `signInWithEmailAndPassword` rejects with that code |
| `{ resetError: 'auth/…' }` | `sendPasswordResetEmail` rejects with that code |
| `{ pending: true }` | sign-in never settles, so the loading state can be inspected |

No network and no real Firebase project are involved.

## What is covered

- **Contrast** — ratios are computed from the sRGB relative-luminance formula
  against the *composited* backdrop, so translucent layers are resolved rather
  than assumed. Text is held to 4.5:1, control borders and focus rings to 3:1,
  in both light and dark.
- **Focus** — every control has a visible indicator. This is the regression guard
  for the original bug: `input[type=text],input[type=search]` never matched
  `type=password`, but `input:focus{outline:none}` did, so the password field had
  its native focus ring stripped with nothing put back.
- **Target size**, **tab order**, **mobile input attributes** (the missing
  `autocapitalize=none` that caused iOS to capitalise emails and fail sign-in).
- **Error and success states** — that they are visually distinct, that no raw
  `auth/…` code reaches the user, and that the three credential errors produce one
  identical string (no account enumeration).
- **Keyboard overlap** — at a 390×300 viewport, standing in for a phone with the
  keyboard up, the card must not be clipped off the top and the password field
  must be reachable.
- **Regressions** — that the login CSS does not leak into the rest of the app and
  that the app still renders after sign-in.

Every assertion here was checked against the pre-redesign code: 26 of the 30 tests
fail on it and pass after. The other four are regression guards that are expected
to pass on both.

## Known skip

`tab order follows visual order` is skipped on WebKit. Safari leaves `<button>` out
of sequential focus unless "Press Tab to highlight each item" is enabled — a
platform default, not a property of this markup. `every control is programmatically
focusable and in DOM order` covers the same ground everywhere.
