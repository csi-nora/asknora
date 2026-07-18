FROM quay.io/jupyter/scipy-notebook:python-3.11

USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

USER ${NB_UID}
WORKDIR /workspace

# Core demo deps baked into the image for faster notebook startup.
# Full pinned set lives in /workspace/requirements.txt (mounted at runtime).
COPY --chown=${NB_UID}:${NB_GID} requirements-jupyter.txt /tmp/requirements-jupyter.txt
RUN pip install --no-cache-dir -r /tmp/requirements-jupyter.txt

CMD ["start-notebook.sh", "--NotebookApp.token=${JUPYTER_TOKEN}", "--NotebookApp.allow_origin=*"]
