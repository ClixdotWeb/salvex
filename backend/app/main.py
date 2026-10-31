import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.errors import register_error_handlers
from app.core.middleware import SecurityMiddleware
from app.api.health import router as health_router
from app.api.contact import router as contact_router
from app.api.ready_to_lift import router as ready_to_lift_router
from app.api.admin_bulk import router as admin_bulk_router
from app.api.admin_search import router as admin_search_router
from app.api.auth import router as auth_router
from app.api.admin import router as admin_router
from app.api.users import router as users_router
from app.api.kyc import router as kyc_router
from app.api.auctions import bids_router
from app.api.orders import router as orders_router
from app.api.notifications import router as notifications_router
from app.api.parts import requests_router as part_requests_router
from app.api.parts import router as parts_router
from app.api.auctions import router as auctions_router
from app.api.vehicles import catalogue as catalogue_router
from app.api.vehicles import router as vehicles_router
from app.services.auction_closer import AuctionCloser, closer_enabled
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
    closer = None
    if closer_enabled():
        from app.db.session import AsyncSessionLocal
        closer = AuctionCloser(AsyncSessionLocal, settings.AUCTION_CLOSER_INTERVAL_SECONDS)
        closer.start()
    yield
    if closer is not None:
        await closer.stop()
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
        allow_headers=["Content-Type", "Authorization", "X-CSRF-Token", "X-Auth-Mode", "Idempotency-Key"],
    )

    register_error_handlers(app)

    # Mount API routers
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(admin_search_router)        # before admin_router: /vehicles/{id}/overview
    app.include_router(admin_bulk_router)          # before admin_router: /vehicles/bulk-* must not match /vehicles/{id}
    app.include_router(admin_router)
    app.include_router(users_router)
    app.include_router(kyc_router)
    app.include_router(vehicles_router)
    app.include_router(catalogue_router)
    app.include_router(auctions_router)
    app.include_router(bids_router)
    app.include_router(orders_router)
    app.include_router(notifications_router)
    app.include_router(parts_router)
    app.include_router(part_requests_router)
    app.include_router(contact_router)
    app.include_router(ready_to_lift_router)

    return app


app = create_application()
