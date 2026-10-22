import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.errors import register_error_handlers
from app.core.middleware import SecurityMiddleware
from app.api.health import router as health_router
from app.api.auth import router as auth_router
from app.services.email import get_email_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("salvex.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle hook for startup and shutdown procedures."""
    logger.info(f"Starting Salvex API in {settings.APP_ENV} mode...")
    logger.info(f"Configured CORS origins: {settings.cors_origins}")
    get_email_service()  # fail at startup (not at the first registration) if email is misconfigured
    if not settings.cookie_secure:
        logger.warning("Auth cookies are NOT marked Secure (allowed only in development/test).")
    yield
    logger.info("Shutting down Salvex API...")


def create_application() -> FastAPI:
    """FastAPI Application factory configuring middleware, lifespan, and routers."""
    app = FastAPI(
        title="Salvex Auction Platform API",
        description="Unified Enterprise Auction API for Web (React) and Mobile (Flutter)",
        version="1.0.0",
        docs_url="/docs" if settings.is_dev_like else None,
        redoc_url="/redoc" if settings.is_dev_like else None,
        openapi_url="/openapi.json" if settings.is_dev_like else None,
        lifespan=lifespan
    )

    # Added first = runs closer to the application: cross-site origin check + security headers
    app.add_middleware(SecurityMiddleware)

    # Restrictive CORS configuration: explicitly configured frontend origins only, explicit headers
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-CSRF-Token", "X-Auth-Mode"],
    )

    register_error_handlers(app)

    # Mount API routers
    app.include_router(health_router)
    app.include_router(auth_router)

    return app


app = create_application()
