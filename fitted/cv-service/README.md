# CV inference service (Python)

Self-contained CV inference service: `cv.py` (rembg + PIL + CLIP) + FastAPI. All CV code lives in this folder. Your Next.js app on Vercel calls this service instead of running Python locally.

**How to use (local + API + production):** see **`docs/cv-usage.md`**.

## Run locally

From the **`fitted/`** directory (parent of `cv-service/`):

```bash
cd fitted
pip install -r cv-service/requirements.txt
uvicorn cv-service.main:app --reload --host 0.0.0.0 --port 8000
```

Test:

```bash
curl -X POST http://localhost:8000/infer -F "file=@ml-system/test-images/flannel.jpg"
```

## Deploy (Render – free tier)

1. **Create a Render account** at [render.com](https://render.com) (free).

2. **New → Web Service**. Connect your repo. Set:
   - **Root directory**: `fitted`
   - **Runtime**: Python 3
   - **Build command**: `pip install -r cv-service/requirements.txt`
   - **Start command**: `uvicorn cv-service.main:app --host 0.0.0.0 --port $PORT`
   - **Instance type**: Free (or paid for always-on)

3. Deploy. You get a URL like `https://your-cv-service.onrender.com`.

4. **In your Next.js API route** (`app/api/cv/infer/route.ts`), when you want to use the Python backend, `POST` the uploaded file to `https://your-cv-service.onrender.com/infer` and return the JSON (see docs/cv-vercel.md).

**Cost (Render):** Free tier spins down after ~15 min idle; first request after that has a long cold start (30–60+ s with torch/CLIP). No charge for the free tier; paid plans if you need always-on or more RAM.

## Deploy (Railway)

1. **railway.app** → New Project → Deploy from GitHub. Choose repo, set root to `fitted`.
2. Add a **Web Service**: build `pip install -r cv-service/requirements.txt`, start `uvicorn cv-service.main:app --host 0.0.0.0 --port $PORT`.
3. Railway gives a URL. Use that as the CV backend in your Next app.

**Cost:** Railway gives a small monthly free credit; heavy ML can exceed it. After that you pay for usage (a few dollars/month for light use).

## Deploy (Docker / Cloud Run, Fly.io)

A `Dockerfile` can be added to build a image that installs deps and runs `uvicorn`. Then:
- **Google Cloud Run**: `gcloud run deploy` – free tier (2M requests/month), then pay per request + CPU time.
- **Fly.io**: `fly launch` – free tier for small VMs; cold starts possible.

## Will it cost?

- **Render free tier**: $0. Service sleeps when idle; cold starts are slow. Fine for demos and low traffic.
- **Railway**: Free credit then ~\$5–20+/month depending on usage and instance size.
- **Cloud Run**: Free tier is generous; you pay only if you exceed it. Cold starts can be 30–60 s with this stack.
- **Fly.io**: Free allowance; then pay per VM.

For a side project or MVP, Render free tier or Railway’s credit is usually enough. If you need fast, always-on responses, expect to pay for an always-on instance (e.g. Railway or Render paid, or a small Cloud Run service).
