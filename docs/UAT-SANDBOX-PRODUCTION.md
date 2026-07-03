# UAT — Sandbox vs production deployment tier

## What was implemented

- **Build configurations:** `development` (default env), **`sandbox`** (`environment.sandbox.ts`), **`production`** (`environment.prod.ts` with `fileReplacements`).
- **Runtime:** `DeploymentEnvironmentService` reads build tier; optional **UAT browser override** when `allowUatOverride === true` (sandbox & dev — **not** production builds).
- **UI:** Header shows **SANDBOX** / **PRODUCTION** badge; **UAT** dropdown + reset when overrides are allowed.

## Automated checks (CI / local)

```bash
npm run test:uat
```

Runs `deployment-environment.service.spec.ts` (tier resolution, override, production lock).

Full suite: `npm test`

## Manual UAT checklist

| Step | Action | Expected |
|------|--------|----------|
| 1 | `npm start` (development) | Header **SANDBOX** badge; **UAT** dropdown visible |
| 2 | Switch UAT to **Production** | Badge **PRODUCTION**; tooltip mentions UAT override |
| 3 | Click **↺** | Tier returns to build default (**Sandbox**) |
| 4 | `npm run start:sandbox` | Same as dev; build file is `environment.sandbox.ts` |
| 5 | `npm run build` then open `dist/csi-nora/browser` | Production bundle: **PRODUCTION** badge; **no** UAT dropdown (`allowUatOverride: false`) |
| 6 | `npm run build:sandbox` | Sandbox bundle; UAT controls available when served |

## Backend gateway (sandbox vs production)

- **`backendBaseUrl`** in `src/environments/environment*.ts` (no trailing slash):
  - **Empty** — the app calls Anthropic / OpenAI / Hugging Face **directly** from the browser; users paste API keys in **API settings** (dev / local).
  - **Non-empty** — all LLM traffic goes to `{backendBaseUrl}/api/llm/...`. The browser **does not** send provider keys; the gateway injects keys from its environment.
- **Sandbox build** (`environment.sandbox.ts`): set `backendBaseUrl` to your **sandbox** API gateway origin in CI/CD.
- **Production build** (`environment.prod.ts`): set `backendBaseUrl` to your **production** gateway origin.

### Reference gateway (local)

```bash
# Terminal 1 — copy server/.env.example to server/.env and add provider keys
npm run gateway

# Terminal 2 — point the app at the dev server + proxy (same origin as Angular so /api/llm is forwarded)
# In src/environments/environment.ts set:  backendBaseUrl: 'http://127.0.0.1:4200'
npm run start:with-gateway
```

- Proxies are defined in `proxy.conf.json` (forwards `/api/llm` and `/api/health` to `http://127.0.0.1:3456`).
- URL mapping is implemented in `src/app/utils/backend-llm-urls.ts` and must match `server/gateway.cjs` routes.

## Notes

- Deployment **tier** (SANDBOX / PRODUCTION badge) is separate from `backendBaseUrl`; both come from **build** file replacements. UAT tier override does not switch API hosts.
- Clearing site data removes UAT override from `localStorage`.
