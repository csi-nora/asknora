# Deploy documentation

| Document | Purpose |
|----------|---------|
| **[../DEPLOY-PRODUCTION.md](../DEPLOY-PRODUCTION.md)** | **Start here** — Docker, Node prod, release bundle, Netlify |
| **[OPERATIONS-RUNBOOK.md](./OPERATIONS-RUNBOOK.md)** | AWS, sovereign cloud, on-prem runbooks |
| **[docker/](./docker/)** | Production Docker Compose (web + API gateway) |
| **[../docs/ARCHITECTURE-LOCAL-LLM-ON-PREM.md](../docs/ARCHITECTURE-LOCAL-LLM-ON-PREM.md)** | On‑prem local LLM architecture (hardware, GPU/CPU/NPU, serving stack, RAG, egress) — **canonical**; `deploy/ARCHITECTURE-*.md` redirects here |
| [aws/ecs-task-definition.example.json](./aws/ecs-task-definition.example.json) | ECS Fargate task definition template |
| [aws/AWS-CLI-DEPLOYMENT.md](./aws/AWS-CLI-DEPLOYMENT.md) | Redirect to runbook §5 |

Dockerfiles for the full stack (API + optional web image) live in the **AskNora / agentic** repository under `deploy/` when that repo is present alongside this Angular project.
