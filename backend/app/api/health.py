from datetime import datetime, timezone
from fastapi import APIRouter, status, Response
from app.db.session import check_db_connectivity

router = APIRouter(prefix="/api", tags=["System Health"])


@router.get(
    "/health",
    status_code=status.HTTP_200_OK,
    summary="Liveness Probe",
    description="Reports whether the FastAPI application process is up and responding."
)
async def health_check():
    """
    Process liveness check.
    Returns 200 OK without disclosing internal host details or secrets.
    """
    return {
        "status": "online",
        "service": "Salvex Auction Platform API",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@router.get("/site-config", summary="Public switches the website needs (no secrets)")
async def site_config():
    from app.core.config import settings
    return {"online_payment": settings.ONLINE_PAYMENT_FLOW, "seller_accounts": settings.SELLER_ACCOUNTS,
            "mobile_otp": settings.MOBILE_OTP_REQUIRED}


@router.get(
    "/ready",
    summary="Readiness Probe",
    description="Verifies that the backend and required PostgreSQL persistence layer are operational."
)
async def readiness_check(response: Response):
    """
    Readiness probe for load balancers and orchestrators.
    Returns 200 OK if PostgreSQL is connected.
    Returns 503 Service Unavailable if database connection fails.
    Never exposes credentials, connection strings, or full stack traces.
    """
    is_connected, message = await check_db_connectivity()
    
    if is_connected:
        response.status_code = status.HTTP_200_OK
        return {
            "status": "ready",
            "database": "connected",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    else:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "not_ready",
            "database": message,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
