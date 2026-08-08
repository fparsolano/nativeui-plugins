# Deploy to Google Cloud Run (default target)

Cloud Run runs your container, scales to zero, and gives you an HTTPS URL with a managed cert.
It matches NativeUI infra and `gcloud` is already installed here — this is the default.

**Prereqs:** a GCP project with billing, and the CLI authenticated:
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```
Pick a region near your users (NativeUI default: `us-central1`):
```bash
gcloud config set run/region us-central1
```

## Option A — deploy straight from source (simplest)
Cloud Run builds the container for you (uses the `Dockerfile` in this dir, or buildpacks if absent):
```bash
gcloud run deploy nui-backend \
  --source . \
  --allow-unauthenticated \
  --port 8080
```
The command prints a `Service URL` like `https://nui-backend-xxxxxxxx-uc.a.run.app`. Verify:
```bash
curl https://nui-backend-xxxxxxxx-uc.a.run.app/health   # -> {"ok":true}
```

## Option B — build, push, then deploy (CI-friendly, reproducible)
```bash
REGION=us-central1; PROJECT=$(gcloud config get-value project)
gcloud artifacts repositories create nui --repository-format=docker --location=$REGION 2>/dev/null || true
IMG=$REGION-docker.pkg.dev/$PROJECT/nui/backend:$(date +%s)
gcloud builds submit --tag $IMG .
gcloud run deploy nui-backend --image $IMG --allow-unauthenticated --port 8080
```

## Auth: `--allow-unauthenticated` tradeoff
A mobile app calling your API has no Google identity, so the service must accept unauthenticated
requests at the network edge: keep `--allow-unauthenticated`. That makes the URL **publicly
reachable** — so do your OWN auth in the app→server path (a bearer token / session the server
validates in `onCallApi`), and never rely on Cloud Run IAM as the app's auth. To LOCK a service to
internal/CI callers instead, drop the flag and grant `roles/run.invoker` to specific identities.

## Env + secrets (Secret Manager, never in the image)
Non-secret config as plain env vars; secrets via Secret Manager so they're never baked into the image
or printed in logs:
```bash
# non-secret config
gcloud run services update nui-backend \
  --set-env-vars ALLOWED_ORIGINS=https://yourapp.com,NODE_ENV=production

# a secret: create once, then mount as an env var
printf 'super-secret-value' | gcloud secrets create API_TOKEN --data-file=-
gcloud run services update nui-backend --set-secrets API_TOKEN=API_TOKEN:latest
```
Grant the service's runtime account read access if you used a non-default SA:
`gcloud secrets add-iam-policy-binding API_TOKEN --member=serviceAccount:... --role=roles/secretmanager.secretAccessor`.

## Custom domain (api.yourapp.com)
The `*.run.app` URL works immediately. For a branded domain, map it (then point DNS at the records
Cloud Run prints; the cert is provisioned automatically):
```bash
gcloud beta run domain-mappings create --service nui-backend --domain api.yourapp.com
```

---
## Final step — flip the app's API base URL
With `https://nui-backend-…run.app` (or `https://api.yourapp.com`) live and `/health` green,
set that as the **prod** value of the single `API_BASE` constant in `NuiBackend.{kt,swift}`
(see `../README.md`). Prod is HTTPS, so remove any dev cleartext/ATS opt-in from the release build.
