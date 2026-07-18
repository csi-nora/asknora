FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Lean dashboard deps (see requirements-dashboard.txt). The app source is
# bind-mounted at runtime, so only the Python environment is baked in here.
COPY infra/streamlit/requirements-dashboard.txt /app/requirements-dashboard.txt
RUN pip install --no-cache-dir -r requirements-dashboard.txt

EXPOSE 8501

HEALTHCHECK CMD curl -fsS http://127.0.0.1:8501/_stcore/health || exit 1

CMD ["streamlit", "run", "dashboard/app_lite.py", "--server.port=8501", "--server.address=0.0.0.0", "--browser.gatherUsageStats=false"]
