# Deployment instructions

- Build and run the FastAPI backend together with the static React front-end:

  ```bash
  docker compose up --build
  ```

  The backend listens on `http://localhost:8000`, the front-end on `http://localhost:5173`. The Oxigraph store is persisted in the `vendange_store` named volume so your curation state survives container restarts.

- Build images separately if you prefer independent deployments:

  ```bash
  docker build -f Dockerfile.backend -t vendange-backend .
  docker build -f Dockerfile.frontend -t vendange-frontend .
  ```

  The backend image boots `uvicorn` with the app located at `data_curation.api.app:app`; the front-end image serves the pre-built Vite bundle via Nginx.
