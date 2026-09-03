#!/usr/bin/env python3
"""FastAPI application assembly for the Flow Agent API server.

Builds the app (title/description/version/lifespan), applies middleware, and
mounts every router. No route logic lives here — see flow_server/routes/ and flow_server/mcp/.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from flow_server.state import lifespan
from flow_server.routes import system, generation, chat, media
from flow_server.mcp import sse as mcp_sse

app = FastAPI(
    title="Flow Agent OpenAI API Wrapper",
    description="OpenAI-compatible endpoints for Google Flow AI image generation",
    version="2.0.3",
    lifespan=lifespan
)

import os

_CORS_ORIGINS_ENV = os.environ.get("CORS_ALLOW_ORIGINS", "")
_CORS_ORIGINS: list[str] = (
    [o.strip() for o in _CORS_ORIGINS_ENV.split(",") if o.strip()]
    if _CORS_ORIGINS_ENV
    else [
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8001",
        "http://127.0.0.1",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8001",
    ]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Router order mirrors the original single-file declaration order. No path
# shadows another (/v1/history/{filename} and /download/{filename} are the only
# parameterised routes and neither collides), so resolution is unchanged.
app.include_router(system.router)
app.include_router(generation.router)
app.include_router(chat.router)
app.include_router(media.router)
app.include_router(mcp_sse.router)
