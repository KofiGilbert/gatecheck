# Gate Check

Warehouse gate & yard app for Martin Brower McCook — live at
**https://gatecheck-martinbrower.netlify.app**

One person imports the morning inbound schedule (photo of the printed sheet, .xlsx, or .json);
the whole team searches orders, fills Seal Verification Forms with driver signatures, runs
2-hourly Yard Checks (F-US399-QS-36) with automatic escalations, and emails completed forms
to the receiving office in one tap.

## File map

| File | What's in it |
|---|---|
| `index.html` | All markup and CSS (tabs, forms, login, settings) |
| `js/app.js` | Core: storage, schedule search, seal form, signature pad, paper-form renderer, share/email |
| `js/import.js` | Schedule imports: photo OCR pipeline, .xlsx parser, .json/.csv, review screen |
| `js/cloud.js` | Firebase login + team sync (orders, forms, yard checks, settings, officer names) |
| `js/yard.js` | Yard Check tab: grid UI, escalation rules, photo trailer-list import, log renderer |
| `vendor/` | Third-party: fflate (xlsx unzip), tesseract.js + worker + wasm core + eng language data (photo OCR, served same-origin — no external CDN) |

## Editing & deploying

Work on any file in VS Code, then:

```
git add -A && git commit -m "describe the change" && git push
```

Netlify is linked to this repo — every push to `main` goes live automatically in ~30 seconds.
There is no build step; the site deploys exactly as committed.

**Test locally** (needed because the photo reader loads `/vendor` files over HTTP):

```
python3 -m http.server 8000
# then open http://localhost:8000
```

Note: `localhost` is already an authorized domain in Firebase, so login works locally too.

## Things to know before changing code

- **Escalation rules** live in `ycEval()` in `js/yard.js` (cooler 34.0–40.0, frozen ≤ 0.0,
  DEF anywhere, fuel ¼ or less). Temps must match `/^-?\d+\.\d$/` (tenth-degree rule).
- **Firebase config** is at the top of `js/cloud.js`. Data lives in Firestore collections
  `orders`, `forms`, `yardchecks`, `settings/app`, `officers/{email}`.
- **Email sending** goes through a Google Apps Script web app ("Gate Check sender") owned by
  gatecheck.martinbrower@gmail.com. The app reads its URL and the To/CC addresses from the
  shared settings (⚙ in the app) — changing recipients never requires a code change.
- The rendered paper forms (seal form + trailer inspection log) are drawn on canvas in
  `drawPaper()` (`js/app.js`) and `drawYardPaper()` (`js/yard.js`).
- Officers are added/removed in Firebase console → Authentication → Users.
