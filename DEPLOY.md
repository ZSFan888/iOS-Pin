# Deployment Guide

Step-by-step instructions to get the Worker running on your own Cloudflare account.

## 1. Prerequisites

- Node.js 20+
- A Cloudflare account
- Wrangler CLI (installed automatically via `npm install` in `Worker/`)

## 2. Install dependencies

```bash
cd Worker
npm install
```

## 3. Authenticate Wrangler

```bash
npx wrangler login
```

## 4. Create the KV namespace

```bash
npx wrangler kv namespace create ios-pin-locations
```

This prints a namespace `id`. Copy it into `Worker/wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  { "binding": "LOCATIONS", "id": "<paste-id-here>" }
]
```

If you plan to deploy a separate production environment, also create a second namespace
and paste its id into the `env.production.kv_namespaces` block.

## 5. (Optional) Configure access control

By default, anyone who knows your Worker URL and a token can read/write that token's location.
To restrict this:

```bash
# Require a shared secret header (x-wloc-key) for all write requests
npx wrangler secret put API_KEY

# Optionally restrict which device tokens are allowed at all (comma separated)
npx wrangler secret put ALLOWED_TOKENS
```

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the same values —
`wrangler dev` reads `.dev.vars` automatically and it is git-ignored.

## 6. Run locally

```bash
npm run dev
```

Wrangler will print a local URL (typically `http://localhost:8787`). Use this as the
"Worker 地址" value in `Frontend/Public/Console.html` while testing.

## 7. Deploy to production

```bash
npm run deploy
# or, for the named production environment:
npx wrangler deploy --env production
```

Wrangler prints your live Worker URL, e.g. `https://ios-pin.<your-subdomain>.workers.dev`.

## 8. Point the frontend at your Worker

Open `Frontend/Public/Console.html` (or host it on Cloudflare Pages) and enter:

- Worker 地址: your deployed Worker URL
- 设备 Token: any identifier you choose, e.g. `iphone-main`
- API Key: only if you set `API_KEY` in step 5

## 9. Generate and install a proxy module

From the console, pick a client (Surge/Loon/Quantumult X/Stash/Shadowrocket) and click
"生成模块地址". Open that URL in your proxy app to install the MITM + script module.
Make sure MITM hostnames include both `gs-loc.apple.com` and `gs-loc-cn.apple.com`.

## 10. Validate protobuf field assumptions

Before relying on this in daily use, capture a real response and run the inspector:

```bash
node Scripts/Inspect-capture.mjs Test/Fixtures/sample-01.bin
```

Compare the printed field layout against `Src/Proto/Apple-wloc.ts` and adjust if Apple's
response structure differs from the assumptions documented there.

## Continuous integration

Every push touching `Worker/**` triggers `.github/workflows/Worker-ci.yml`, which runs the
Vitest suite and a TypeScript type check. Keep this green before merging changes.
