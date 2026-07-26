# AGENTS.md

## Cursor Cloud specific instructions

CSI Nora is a single Angular 17 SPA (standalone components, signals, RxJS, SCSS).
It exposes four in-app "experiences" chosen on the landing page: Agentic
Governance (`/governance`), Ask Nora hybrid-RAG bot (`/ask-nora`), Both
(`/both`), and AIChatOps (`/aichatops`). All persistence is browser
`localStorage`/IndexedDB — there is **no database, cache, or queue** to run.

### Services
- **Frontend SPA (required)** — the entire product. Dev server on port `4200`.
- **Node LLM gateway (optional)** — `server/gateway.cjs`, port `3456`. A thin
  proxy that injects LLM provider API keys server-side. The app also works
  fully in **offline/local mode** (BM25 keyword search over the bundled KB, and
  deterministic browser-local AIChatOps tool simulations), so no LLM key or
  gateway is needed to run and exercise core functionality.

### Node version (important gotcha)
This project targets Node 18/20 (Angular 17). The VM's default `node` on `PATH`
is `/exec-daemon/node` (v22), which Angular 17 does not officially support. Use
Node 20 for all `ng`/build/test commands by prepending nvm's Node 20 to `PATH`
for the shell session:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"; hash -r
```

(If v20 is not yet installed: `bash -lc '. ~/.nvm/nvm.sh && nvm install 20'`.)

### Run / build / test (non-obvious caveats)
- The checked-in `package.json` is the **deployment-bundle** variant and has
  **no `start` script**, so `npm start` fails even though `README.md` documents
  it. Run the dev server via the `ng` passthrough script:
  ```bash
  npm run ng -- serve --host 127.0.0.1 --port 4200
  ```
- Build: `npm run build` (runs `ng build --configuration=production`, then a
  `postbuild` `validate:dist` check). Output goes to `dist/csi-nora/browser`.
- Tests: Karma/Jasmine headless Chrome. Set the Chrome binary first, since
  `karma.conf.js` relies on `CHROME_BIN` and there is no `--no-sandbox` launcher
  (works as the non-root `ubuntu` user):
  ```bash
  export CHROME_BIN=/usr/bin/google-chrome-stable
  npm run test:uat   # headless subset; `npm test` is the interactive full run
  ```
- No ESLint/lint script is configured in this `package.json`.

### Repo note
The base `main` branch was missing the Angular build system (`package.json`,
`angular.json`, `tsconfig*.json`, `src/main.ts`, `src/index.html`, `public/`)
plus several source files that existing code imports (`src/app/app.config.ts`,
`src/app/data/*.ts`, `src/app/tokens/environment.token.ts`,
`src/app/utils/backend-env-resolve.util.ts`,
`src/app/services/external-storage.service.ts`). These were restored so the app
can build and run. `dist/` is a generated artifact — regenerate with
`npm run build` rather than hand-editing.
