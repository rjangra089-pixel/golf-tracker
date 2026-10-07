# Tests

Regression suites for the Golf Tracker player app (`index.html`). None of them
touch the real Supabase database: unit suites run the app's own functions in
Node with no network, and the browser suite answers every Supabase and `/api`
request from an in-test mock.

Requirements: Node 18+, Python 3 (for the throwaway static server) and Google
Chrome. No `npm install` needed.

## Run everything

```bash
tests/run-unit.sh        # all offline suites
tests/run-browser.sh     # browser regression suite (headless Chrome)
```

Both exit non-zero if anything fails.

## Individual suites

Each unit suite loads the real code from `index.html` (or a path passed as the
first argument) by locating its section banner, so moving those sections means
updating the extraction at the top of the test.

| Suite | Command | Covers |
|---|---|---|
| T/A/S/P | `node tests/unit/tasp.test.js` | `normalizeErrorTags` / `parseErrorTags`: valid letters only, de-duplication, T-A-S-P order, `null` for none, every output passes the DB check constraint |
| Phase A (coaching model) | `node tests/unit/home-model.test.js` | complete-round rules, ordering, gross, Stableford parity with `calcPoints`, each round's own course, form windows/direction, leak rates and data-sufficiency rules, the history query shape |
| Home / view | `node tests/unit/home-view.test.js` | `chooseFocus` (coaching priority), `nextRoundTarget`, `buildHomeView` states and copy |
| `sbFetch` | `node tests/unit/sbfetch.test.js` | user token on data requests, anon only for public course/hole reads, no anonymous writes, offline queue replays with the current token and never stores one |
| `track()` | `node tests/unit/track.test.js` | `Prefer: return=minimal`, no email/PII, no request when signed out |
| Browser regression | `tests/run-browser.sh` | navigation, Profile, Stats, debrief selection + no active-round mutation, course dropdown safety, coaching Home states, T/A/S/P capture and persistence (autosave, offline queue, reload, resume, final save, summary), live score entry (1–9 + 10+ stepper, putts 0–3 + 4+ stepper, par-3 Tee, collapsed briefing, fit without scrolling at 390×844 and 375×667, light and dark), no console errors |

### Browser suite options

```bash
ONLY='^(TASP|LIVE)' tests/run-browser.sh          # run a subset by test-name regex
SHOTS=/tmp/shots tests/run-browser.sh              # also save screenshots there
APP=https://golf-tracker-snowy.vercel.app/ ONLY='^(Home loads|LIVE)' tests/run-browser.sh
                                                   # run against production (still fully mocked)
```

`tests/browser/prod-signed-out.js` is a separate read-only production check
(signed out, nothing intercepted): start Chrome with
`--remote-debugging-port=9333` and run `node tests/browser/prod-signed-out.js`.
