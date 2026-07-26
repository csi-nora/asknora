# CSI Nora — 5-minute demo (animated deck + video)

## Contents

| File | Purpose |
|------|---------|
| `index.html` | **5-slide animated presentation** (auto-advances every 60s ≈ 5 min) |
| `record-demo.cjs` | Renders `output/csi-nora-5min-demo.mp4` via Playwright + ffmpeg |
| `output/csi-nora-5min-demo.mp4` | Generated ~5-minute demo video |

## Present live (keyboard)

Open `index.html` in Chrome:

- **→ / Space** next · **←** previous · **1–5** jump to slide  
- Progress bar at the bottom tracks the full 5 minutes  
- Faster preview: `index.html?ms=8000` (8s per slide)

## Slides

1. **Title** — CSI Nora Hybrid RAG Portfolio Advisor  
2. **Architecture** — proxy · bridge · KB · MCP  
3. **Responsible AI** — guardrails · Presidio · STRIDE S–E  
4. **Knowledge & access** — Hybrid RAG · roles · disk KB  
5. **Run the demo** — `RUN-ASKNORA.bat` / `start-linux.sh` · `:9090`

## Render the video

```powershell
cd docs\demo-5min
npm install
npx playwright install chrome
node record-demo.cjs
```

Requires **ffmpeg** on PATH. Optional: leave `http://localhost:9090/` running to embed a live UI B-roll clip.

Output: `docs/demo-5min/output/csi-nora-5min-demo.mp4`
