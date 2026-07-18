# WLOC Pro

A cleaner, extensible reimplementation inspired by Apple WLOC response spoofing workflows.

## Monorepo layout

- `worker/`: Cloudflare Worker powered by Hono
- `frontend/`: static map UI for coordinate selection
- `modules-templates/`: proxy module templates for Surge/Loon/QX/Stash/Shadowrocket
- `shortcuts/`: iOS shortcut placeholders

## Key ideas

- Intercept `gs-loc.apple.com` traffic through client proxy tools
- Parse/replace protobuf response payloads in Worker
- Store selected coordinates by token in KV
- Generate client-specific module files dynamically

## Local development

### Worker

```bash
cd worker
npm install
npm run dev
```

### Frontend

Open `frontend/public/app.html` directly for static preview, or serve it with any static server.

## Deployment notes

1. Create KV namespace and bind it as `LOCATIONS`.
2. Update `worker/wrangler.jsonc` with your Worker name and KV IDs.
3. Deploy with Wrangler.
4. Set your generated Worker URL inside the client proxy modules.

## Push to GitHub with PAT

```bash
git init
git add .
git commit -m "feat: init wloc-pro scaffold"
git branch -M main
git remote add origin https://<YOUR_PAT>@github.com/<YOUR_USERNAME>/<YOUR_REPO>.git
git push -u origin main
```

Use a PAT with repository write permission. Keep the token secret.


## Current implementation progress

- Added a relay endpoint `POST /apple/clls/wloc/:token` to forward original Apple WLOC requests upstream and rewrite response coordinates.
- Added a lightweight protobuf byte rewriter for Apple WLOC responses based on community-reversed message layouts.
- Generated client script endpoints now relay through Worker instead of editing `$response.body` in place.

## Important caveat

The protobuf field layout is based on public reverse engineering and may need adjustment if Apple changes the response structure. Test with your own captures before production use.


## Frontend progress

- Added a dark/light console UI (`frontend/public/app.html`) using Leaflet for map-based coordinate picking.
- Added debounced location search backed by OpenStreetMap Nominatim, with keyboard navigation (arrow keys + enter) and result list.
- Added coordinate save flow calling `/api/location/:token`, module URL generation per client, copy/open actions, and an in-memory recent-location history list.

## Known limitations

- History list is in-memory only (resets on page reload). Persisting it to Worker KV or D1 is a good next step.
- Nominatim has rate limits (~1 req/sec) suitable for personal use only; for production traffic, swap in a paid geocoding API.


## History persistence

- Worker now exposes `/api/history/:token` (GET/POST) and `/api/history/:token/:index` (DELETE), backed by the same `LOCATIONS` KV namespace under a `history:<token>` key, storing up to 20 recent entries per device token.
- Frontend loads history automatically once both Worker base URL and token are filled in, debounced by 500ms, and refreshes after every save or delete.
- Saving a coordinate now also pushes a history entry using the current search label (if any) or the raw lat/lng as fallback label, deduplicating near-identical coordinates.


## Multi-device management (frontend)

- Added an in-session device list above the Worker connection fields, letting you register multiple `{base, token}` pairs and switch between them with one click.
- Selecting a device auto-fills the Worker address and token fields, then reloads that device's saved history immediately.
- Device list is intentionally in-memory only (no localStorage, per sandboxed iframe constraints) — for durable multi-device persistence across sessions, store the device list itself in Worker KV under a user-level key next.


## Reverse geocoding

- Map clicks now trigger a debounced (500ms) reverse geocode call against Nominatim's `/reverse` endpoint, showing a human-readable place name (neighbourhood/city + region) inside the coordinate badge.
- Selecting a search result or a saved history item skips the reverse geocode call and reuses the already-known label, avoiding redundant requests.
- Saving a coordinate now prefers the resolved place name as the history label, falling back to the search input text, then to raw lat/lng if neither is available.


## Protobuf verification tooling

- Added `worker/test/apple-wloc.test.ts` (Vitest) covering: field replacement correctness, short-body passthrough, and `decimalToMicro` scaling/rounding.
- Added `worker/test/fixtures/README.md` explaining how to safely store real capture samples (redacted, no BSSID/PII) for regression testing.
- Added `worker/scripts/inspect-capture.mjs`, a standalone protobuf field dumper — run `node scripts/inspect-capture.mjs test/fixtures/sample-01.bin` to visually confirm field numbers/wire types in a real Apple WLOC response before trusting the spoofer against it.
- Added `.github/workflows/worker-ci.yml` to run `npm test` and `tsc --noEmit` on every push/PR touching `worker/**`.

## Next validation step (manual, on your device)

1. Capture a real `gs-loc.apple.com/clls/wloc` response body via Surge/Loon MITM logging.
2. Save the raw bytes as `worker/test/fixtures/sample-01.bin`.
3. Run `node scripts/inspect-capture.mjs test/fixtures/sample-01.bin` to inspect the actual field layout.
4. Compare against the assumptions in `worker/src/proto/apple-wloc.ts` and adjust field numbers/offsets if they differ.
5. Add a fixture-based test case once the layout is confirmed.


## Access control (new)

- Worker now supports two optional protections via environment secrets: `API_KEY` (shared secret required in the `x-wloc-key` header for all write endpoints) and `ALLOWED_TOKENS` (comma-separated allowlist restricting which device tokens can be used at all).
- Both are opt-in — if unset, the Worker behaves as before (open write access), which is fine for personal/local use but not recommended for a publicly shared Worker URL.
- Frontend now has an "API Key" field; when filled, it's sent as `x-wloc-key` on save/delete requests.
- See `DEPLOY.md` for the full setup walkthrough, including `wrangler secret put` usage and `.dev.vars` for local development.

## Full deployment walkthrough

See [`DEPLOY.md`](./DEPLOY.md) for step-by-step Wrangler KV setup, secrets configuration, local dev, and production deploy instructions.
