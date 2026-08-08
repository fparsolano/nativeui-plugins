"""NativeUI backend — FastAPI server.

The server your exported NativeUI app talks to. The app's NuiBackend.{kt,swift}
makes HTTP calls here (one per authored CALL_API / CALL_DATABASE / SUBMIT_FORM
action); this file answers them. The on-device contract is NuiBackend.* — this
is the OTHER half: your own server, on your own host.

Run:  uvicorn main:app --reload         (dev, http://127.0.0.1:8000)
Docs: http://127.0.0.1:8000/docs        (interactive, auto-generated)
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Config from the environment / a .env file. See .env.example.

    pydantic-settings reads NUI_* env vars (and a local .env) into these fields.
    If you'd rather not add the dependency, drop this class and read
    os.environ.get("NUI_...", default) inline — nothing else here needs it.
    """

    model_config = SettingsConfigDict(env_prefix="NUI_", env_file=".env", extra="ignore")

    # Comma-separated origins allowed to call this server from a browser.
    # Native apps (iOS/Android) are NOT subject to CORS — this matters only if a
    # web build or the NativeUI editor preview calls the same endpoints. "*" is
    # fine for local dev; pin real origins in production.
    cors_origins: str = "*"

    # Example of your own config (a key kept on the SERVER, never in the app).
    api_key: str = ""


settings = Settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: open DB pools / HTTP clients here, stash on app.state, close below.
    yield
    # Shutdown: release what you opened above.


app = FastAPI(title="NativeUI backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe. Most deploy targets (Cloud Run, Fly, Render) hit this."""
    return {"status": "ok"}


# === app endpoints (fill from nui-backend-plan) ===========================
# One route per authored interaction in your project.json. The plan derives the
# path/method/body from each CALL_API / CALL_DATABASE / SUBMIT_FORM action, and
# NuiBackend.{kt,swift} calls it. Worked example for a CALL_API target "login":
#
#   iOS    onCallApi("login", params)   -> POST {baseURL}/api/login   (JSON body)
#   Android onCallApi("login", params)  -> POST {baseURL}/api/login   (JSON body)
#
# params arrives as a flat string map on the device; model the body you expect.


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    ok: bool
    message: str | None = None


@app.post("/api/login", response_model=LoginResponse)
def login(body: LoginRequest) -> LoginResponse:
    if not body.email or not body.password:
        return LoginResponse(ok=False, message="email and password required")
    # Fail closed until this route is connected to a real auth provider.
    raise HTTPException(status_code=501, detail="login auth is not implemented in this scaffold")


# Add the rest of your project's endpoints below, one per authored action.
# ==========================================================================
