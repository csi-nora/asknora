# CSI Nora / AskNora — operations runbook

Single playbook for **Singtel sovereign cloud posture**, **Docker** (API-only vs split FE/BE), **AWS** deployments, and **on-premises** operations. Use this as the canonical reference; older scattered `README.txt` files in sibling repos point here.

---

## Table of contents

1. [Quick reference](#1-quick-reference)
2. [Singtel sovereign cloud](#2-singtel-sovereign-cloud)
3. [Container layouts (Docker)](#3-container-layouts-docker)
4. [Local smoke (docker compose)](#4-local-smoke-docker-compose)
5. [AWS Cloud deployment](#5-aws-cloud-deployment)
6. [On-premises deployment](#6-on-premises-deployment)
7. [Operational runbooks](#7-operational-runbooks)
8. [Appendix: project variants & paths](#8-appendix-project-variants--paths)

---

## 1. Quick reference

| Goal | Typical choice | Section |
|------|----------------|---------|
| Fastest managed API + static SPA on AWS | **ECR** + **App Runner** (API), **S3** + **CloudFront** (Angular) | [§5](#5-aws-cloud-deployment) |
| Full VPC control, ALB, private subnets | **ECS Fargate** + ALB (see `deploy/aws/ecs-task-definition.example.json`) | [§5.4](#54-api--ecs-fargate-alternative) |
| Laptop / lab: web + API together | `docker compose` split FE/BE | [§4](#4-local-smoke-docker-compose) |
| Data centre / private cloud | Compose or Kubernetes + corporate ingress + vault | [§6](#6-on-premises-deployment) |
| API only in a container | `single-api-container/Dockerfile` | [§3.1](#31-single-api-container) |

**Security baseline everywhere:** secrets from a vault or cloud secret manager (not git); **HTTPS** at the edge; **CORS** on the API limited to known web origins; **WAF** where the security architecture requires it.

---

## 2. Singtel sovereign cloud

**Intent:** Run the **same container images** your pipelines build, in an environment that meets **data residency**, **network isolation**, and **governance** requirements your enterprise defines (often an approved AWS account/region, dedicated landing zone, or partner sovereign stack).

**Platform-agnostic practices:**

- **Boundary:** Place the API behind approved ingress (API Gateway, load balancer, or service mesh) with TLS termination and allowlists.
- **Secrets:** Inject `OPENAI_API_KEY`, `JWT_SECRET`, and provider keys from **Singtel-approved vault** or **AWS Secrets Manager** / **SSM Parameter Store** — never bake into images or commit `.env`.
- **Networking:** Use **private subnets** and **VPC endpoints** / **PrivateLink** for AWS services where architecture mandates no public egress for sensitive paths.
- **Logging & audit:** Ship container logs to the approved log platform; avoid logging raw prompts, tokens, or API keys.
- **CORS:** Set server `origin` allowlist to your **public web hostname** (e.g. CloudFront or on-prem reverse proxy), not `*` in production.

**Dockerfiles** under `deploy/` are portable: sovereign deployment differs mainly by **registry**, **orchestrator**, **ingress URL**, and **secret injection** — not by application code forks.

---

## 3. Container layouts (Docker)

Layouts live in the **full-stack repo** (e.g. `asknora-agenticai`). The **Angular-only repo** (`csi-nora`) consumes the SPA build output; API images are built from the repo that contains `server/`.

### 3.1 Single API container

- **Path:** `deploy/single-api-container/Dockerfile`
- **Purpose:** Node token / hybrid API only, **port 3333**.
- **Build (from full-stack repo root):**

  ```bash
  docker build -f deploy/single-api-container/Dockerfile -t <name>-api:latest .
  ```

- **Run (dev only — use secret store in prod):**

  ```bash
  docker run --rm -p 3333:3333 --env-file server/.env <name>-api:latest
  ```

- **SPA:** Built and hosted separately (split FE/BE or static host / CDN).

### 3.2 Split frontend + backend

| Artifact | Path | Notes |
|----------|------|--------|
| API image | `deploy/split-fe-be/api/Dockerfile` | Same API as single-container style |
| Web image | `deploy/split-fe-be/web/Dockerfile` | Multi-stage: `ng build` + nginx static |
| Nginx | `deploy/split-fe-be/web/nginx.conf` | SPA fallback for Angular routes |
| Compose | `deploy/split-fe-be/docker-compose.yml` | Local: web **8080**, API **3333** |

**Production build arg:** `API_BASE_URL` must be the **browser-visible HTTPS URL** of the API (e.g. `https://api.company.sg`).

**Template for `environment.prod.ts`:** see `deploy/environment.prod.example.ts` in the full-stack repo (copy to `src/environments/environment.prod.ts` or rely on Dockerfile `sed` / build-arg).

**Repo root `.dockerignore`:** Keeps build context small; respect it in CI.

---

## 4. Local smoke (docker compose)

From **full-stack repo root** (`asknora-agenticai`):

```bash
docker compose -f deploy/split-fe-be/docker-compose.yml up --build
```

| Endpoint | URL |
|----------|-----|
| SPA | http://localhost:8080 |
| API health | http://localhost:3333/api/health |

`docker-compose.yml` sets `API_BASE_URL: http://localhost:3333` for the web build (aligned with dev CORS).

**Individual images:**

```bash
docker build -f deploy/split-fe-be/api/Dockerfile -t asknora-api:latest .
docker build -f deploy/split-fe-be/web/Dockerfile \
  --build-arg API_BASE_URL=https://your-api.example -t asknora-web:latest .
```

---

## 5. AWS Cloud deployment

### 5.1 Recommended stack (easy production)

| Layer | Service | Rationale |
|-------|---------|-----------|
| Angular static | **S3** + **CloudFront** | CDN, HTTPS, cache; invalidate on deploy |
| Node API | **ECR** + **App Runner** | Managed HTTPS, scaling, fewer VPC/ALB steps than ECS for a first cut |

Use **ECS Fargate + ALB** when you need private subnets, fixed integration patterns, WAF on a dedicated ALB, or org standards that require ECS.

**Region:** examples use `ap-southeast-1`; substitute your approved region.

### 5.2 Prerequisites

```bash
aws --version   # AWS CLI v2
aws sts get-caller-identity
aws configure set region ap-southeast-1
```

IAM (indicative): ECR, App Runner or ECS/ELB, S3, CloudFront, IAM pass roles, Secrets Manager.

### 5.3 Build & push API image to ECR

Build from the repo that contains the API `Dockerfile`, then:

```bash
export AWS_REGION=ap-southeast-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
export REPO_NAME="csi-nora-api"   # or asknora-api — match your naming

aws ecr create-repository --repository-name "${REPO_NAME}" --region "${AWS_REGION}" 2>/dev/null || true

aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_URI}"

docker tag <local-api-image>:latest "${ECR_URI}/${REPO_NAME}:latest"
docker push "${ECR_URI}/${REPO_NAME}:latest"
```

### 5.3.1 App Runner (API)

Create an IAM **ECR access role** for App Runner once. Then:

```bash
aws apprunner create-service --region "${AWS_REGION}" \
  --service-name "${REPO_NAME}" \
  --source-configuration "{
    \"AuthenticationConfiguration\": {
      \"AccessRoleArn\": \"ROLE_ARN\"
    },
    \"AutoDeploymentsEnabled\": false,
    \"ImageRepository\": {
      \"ImageIdentifier\": \"${ECR_URI}/${REPO_NAME}:latest\",
      \"ImageRepositoryType\": \"ECR\",
      \"ImageConfiguration\": {
        \"Port\": \"3333\",
        \"RuntimeEnvironmentVariables\": {
          \"NODE_ENV\": \"production\",
          \"PORT\": \"3333\"
        }
      }
    }
  }" \
  --instance-configuration Cpu=1,Memory=2 \
  --health-check-configuration Protocol=HTTP,Path=/api/health,Interval=10,Timeout=5,HealthyThreshold=1,UnhealthyThreshold=3
```

Wire **Secrets Manager** entries for `OPENAI_API_KEY`, `JWT_SECRET`, etc. in the console or service JSON. **CORS:** allow your CloudFront (or web) hostname on the API.

**Service URL:**

```bash
aws apprunner list-services --region "${AWS_REGION}" \
  --query "ServiceSummaryList[?ServiceName=='${REPO_NAME}'].ServiceUrl" --output text
```

Use that **HTTPS** URL as `apiBaseUrl` / `API_BASE_URL` when building the web app.

### 5.4 API — ECS Fargate (alternative)

```bash
aws ecs create-cluster --cluster-name <name> --region "${AWS_REGION}"
aws ecs register-task-definition --cli-input-json file://deploy/aws/ecs-task-definition.example.json
```

Complete with VPC, subnets, security groups, service, and (usually) **ALB** — account-specific. Template: `deploy/aws/ecs-task-definition.example.json` (replace `ACCOUNT_ID`, ARNs, secret ARNs).

### 5.5 Web — build & publish

**CSI Nora** (this repo): production build after setting `src/environments/environment.prod.ts`:

```bash
npm run build -- --configuration=production
# Output: dist/csi-nora/browser
```

**AskNora** full-stack repo: `dist/ask-nora-mvp/browser`, or build via `deploy/split-fe-be/web/Dockerfile` and copy `/usr/share/nginx/html` out of the image for S3 sync.

```bash
export WEB_BUCKET="csi-nora-web-${ACCOUNT_ID}-$(date +%s)"
aws s3 mb "s3://${WEB_BUCKET}" --region "${AWS_REGION}"
aws s3 sync dist/csi-nora/browser "s3://${WEB_BUCKET}/" --delete
```

Front the bucket with **CloudFront** + **Origin Access Control** (first setup often via console). After each deploy:

```bash
aws cloudfront create-invalidation --distribution-id DISTRIBUTION_ID --paths "/*"
```

### 5.6 Secrets (AWS)

```bash
aws secretsmanager create-secret --name csi-nora/api-env \
  --secret-string '{"OPENAI_API_KEY":"...","JWT_SECRET":"..."}' \
  --region "${AWS_REGION}"
```

Reference from App Runner or ECS task definitions — not from checked-in env files.

### 5.7 Smoke tests (AWS)

```bash
curl -s "https://YOUR_API_ORIGIN/api/health"
# Optional: token endpoint
curl -s -X POST "https://YOUR_API_ORIGIN/api/auth/token" \
  -H "Content-Type: application/json" \
  -d '{"clientId":"demo","clientSecret":"demo"}'
```

### 5.8 Cost & ops (AWS)

- CloudWatch alarms on **5xx**, CPU, memory.
- Rotate **JWT_SECRET** and API keys on policy.
- Same containers in a **governance-approved** account/region for sovereign alignment.

---

## 6. On-premises deployment

**Patterns** that map cleanly to the same Docker images:

### 6.1 Docker Compose (single host or small cluster)

- Use `deploy/split-fe-be/docker-compose.yml` as a baseline; replace `API_BASE_URL` with your **internal or external HTTPS API URL** (as users’ browsers will see it).
- Mount or inject secrets via **env_file** pointing to a host path **not** in git, or use your orchestrator’s secret mechanism.
- Put **TLS** at a reverse proxy (nginx, HAProxy, F5, etc.) in front of `web` and `api` services; avoid plain HTTP for user-facing URLs.

### 6.2 Reverse proxy (typical)

- **External:** `https://chat.company.sg` → web container (static).
- **API:** `https://api.company.sg` → API container port 3333.
- **Headers:** Preserve `Host` / `X-Forwarded-*` as required by your API CORS and cookie policy.

### 6.3 Kubernetes / OpenShift (on-prem cloud)

- Push images to **private registry** approved by the platform team.
- **Deployments** for API and web (or only API if web is on CDN elsewhere).
- **Ingress** + TLS certs via cert-manager or appliance.
- **Secrets:** Sealed Secrets, External Secrets, or vault CSI — align with Singtel / enterprise standard.

### 6.4 Air-gapped / restricted networks

- Preload images via `docker save` / `docker load` or registry mirror.
- Configure `apiBaseUrl` to the **reachable** API hostname inside the enclave.
- LLM / embedding calls may require **egress allowlists** or **dedicated** approved endpoints — validate with architecture review.

### 6.5 On-prem checklist

| Item | Action |
|------|--------|
| TLS | Terminate at load balancer or ingress; HSTS if policy requires |
| Secrets | Vault or K8s secrets; rotate regularly |
| CORS | API allows only web origin(s) |
| Health | Monitor `GET /api/health`; alert on failures |
| Logs | Central logging; no secrets in log lines |
| Backups | Policy for any stateful components (if added later) |

---

## 7. Operational runbooks

### 7.1 Deploy API (container)

1. Build image from CI with immutable tag (`:2026-04-03-1` or git SHA).
2. Push to registry (ECR or on-prem).
3. Update service (App Runner deploy, ECS task def, or `docker compose pull && up -d`).
4. Verify `/api/health` and one authenticated flow.

### 7.2 Deploy web (static)

1. Set production `apiBaseUrl`; `npm run build` (or web image build).
2. Sync to bucket or replace static files behind nginx.
3. Invalidate CDN (`/*` on CloudFront or equivalent).
4. Spot-check SPA load and API calls in browser devtools (network tab).

### 7.3 Rollback

- **AWS:** Revert App Runner to previous image tag or ECS task definition revision.
- **On-prem:** Redeploy previous image digest from registry.
- **Static:** Restore previous S3 snapshot or redeploy previous build artifact.

### 7.4 Incident: API unhealthy

1. Check container logs and `/api/health`.
2. Verify secrets and env (no accidental rotation mismatch).
3. Verify downstream LLM / provider quota (HTTP 502/429 often billing or rate limits).
4. Check CORS only if browser shows blocked requests — not typically the cause of server 5xx.

### 7.5 Rotate API keys

1. Add new key to secret store; update service to use new key (dual-key window if supported).
2. Invalidate old key at provider.
3. Restart / redeploy if the runtime caches env at boot.

---

## 8. Appendix: project variants & paths

| Item | CSI Nora (this repo) | AskNora full-stack repo |
|------|----------------------|-------------------------|
| Angular output | `dist/csi-nora/browser` | `dist/ask-nora-mvp/browser` |
| API Dockerfiles | N/A (use sibling repo) | `deploy/single-api-container/`, `deploy/split-fe-be/api/` |
| Env template | `src/environments/environment.prod.ts` | `deploy/environment.prod.example.ts` |

**Canonical artifacts in this repo:**

- `deploy/OPERATIONS-RUNBOOK.md` — this document
- `deploy/aws/ecs-task-definition.example.json` — ECS Fargate skeleton

**Sibling repo pointers:** `deploy/README.txt` in `asknora-agenticai` should reference this runbook when both trees exist under the same parent folder.

---

*Document version: consolidated playbook — Docker FE/BE, AWS CLI path, on-prem, sovereign posture.*
