Multi-repo / batch RAG content (optional)
=========================================

1. Add JSON files here (e.g. handbooks exported from other Git repos by CI).
2. List them in /corpus-manifest.json at the site root with "id", "url", and optional "name".
3. Each bundle file shape:
   { "documents": [ { "name": "file.md", "content": "...", "sensitivity": "internal" } ] }
4. In the app, use "Index all sources" (info panel) or RAG re-index to merge uploads + local KB + public-kb.json + these bundles.

See example-bundle.json for a minimal sample (not loaded unless you add it to corpus-manifest.json).
