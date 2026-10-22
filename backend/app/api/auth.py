from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, get_auth_context, get_auth_context_optional, require_csrf
from app.core.config import settings
from app.core.errors import ApiError
from app.core.rate_limit import enforce_rate_limit, forgive_pair
from app.core.security import csrf_token_for_session
from app.db.session import get_db
from app.schemas.auth import (
    AuthTokenResponse,
    ForgotPasswordRequest,
    GenericMessageResponse,
    MeResponse,
    ResendOtpRequest,
    ResetPasswordRequest,
    UserLoginRequest,
    UserRegisterRequest,
    UserResponse,
    VerifyEmailRequest,
)
from app.services.auth_service import (
    ERR_SUSPENDED,
    ERR_UNVERIFIED,
    GENERIC_RESEND_MESSAGE,
    MSG_LOCKED,
    AuthService,
)
from app.services.email import get_email_service

router = APIRouter(prefix="/api/auth", tags=["Authentication & Identity"])

REGISTER_MESSAGE = (
    "Thanks! If this email address can be registered, a 6-digit verification code has been sent to it. "
    "Enter the code to finish creating your account."
)
FORGOT_MESSAGE = "If this email is registered, password reset instructions have been sent."


def _service(db: AsyncSession) -> AuthService:
    # Emails are queued and sent in a background task only AFTER the database commit.
    return AuthService(db, get_email_service(), defer_email=True)


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.session_lifetime_seconds,
        httponly=True,                      # scripts cannot read it
        secure=settings.cookie_secure,      # HTTPS only outside development
        samesite=settings.COOKIE_SAMESITE,
        path="/",
        domain=settings.COOKIE_DOMAIN,
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.auth_cookie_name,
        path="/",
        domain=settings.COOKIE_DOMAIN,
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.COOKIE_SAMESITE,
    )


@router.post(
    "/register",
    response_model=GenericMessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new bidder or seller account",
)
async def register(
    request: Request,
    data: UserRegisterRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    enforce_rate_limit("register", request, data.email)
    service = _service(db)
    try:
        await service.register_public(
            name=data.name,
            email=data.email,
            password=data.password,
            role=data.role,
            mobile=data.mobile or "",
            organization=data.organization or "",
        )
        await db.commit()
    except IntegrityError:
        # Two simultaneous registrations of the same new email: the other one won. Same answer.
        await db.rollback()
        return GenericMessageResponse(message=REGISTER_MESSAGE)
    background_tasks.add_task(service.send_pending_emails)
    return GenericMessageResponse(message=REGISTER_MESSAGE)


@router.post(
    "/verify-email",
    response_model=GenericMessageResponse,
    summary="Verify account email address using the 6-digit code",
)
async def verify_email(
    request: Request,
    data: VerifyEmailRequest,
    db: AsyncSession = Depends(get_db),
):
    enforce_rate_limit("verify", request, data.email)
    service = _service(db)
    success, message = await service.verify_email_public(data.email, data.otp)
    # Commit even on failure so attempt counts and invalidated codes are saved.
    # Without this, the error response rolls back and the attempt limit never applies.
    await db.commit()
    if not success:
        raise ApiError(400, message, "code_locked" if message == MSG_LOCKED else "invalid_code")
    return GenericMessageResponse(message=message)


@router.post(
    "/resend-otp",
    response_model=GenericMessageResponse,
    summary="Resend a verification or password-reset code",
)
async def resend_otp(
    request: Request,
    data: ResendOtpRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    enforce_rate_limit("resend", request, data.email)
    service = _service(db)
    await service.resend_otp(data.email, data.purpose)
    await db.commit()
    background_tasks.add_task(service.send_pending_emails)
    return GenericMessageResponse(message=GENERIC_RESEND_MESSAGE)


@router.post(
    "/login",
    response_model=AuthTokenResponse,
    summary="Sign in and receive an HttpOnly session cookie",
)
async def login(
    request: Request,
    data: UserLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    enforce_rate_limit("login", request, data.identifier)
    service = _service(db)

    user, token, session, error = await service.authenticate_user_with_session(
        data.identifier, data.password, request.headers.get("user-agent")
    )
    if error:
        if error == ERR_UNVERIFIED:
            raise ApiError(403, error, "email_not_verified")
        if error == ERR_SUSPENDED:
            raise ApiError(403, error, "account_suspended")
        raise ApiError(401, error, "invalid_credentials")

    await db.commit()
    forgive_pair("login", request, data.identifier)
    _set_auth_cookie(response, token)

    # Browsers get the token only in the HttpOnly cookie. Non-browser clients (for example a
    # mobile app) can ask for it in the body with "X-Auth-Mode: bearer".
    wants_bearer = request.headers.get("x-auth-mode", "").lower() == "bearer"
    return AuthTokenResponse(
        message="Login successful",
        access_token=token if wants_bearer else None,
        user=UserResponse.model_validate(user),
        csrf_token=csrf_token_for_session(str(session.id)),
    )


@router.get("/me", response_model=MeResponse, summary="Get the signed-in user (used to restore a session)")
async def get_me(request: Request, ctx: AuthContext = Depends(get_auth_context)):
    enforce_rate_limit("session", request)
    base = UserResponse.model_validate(ctx.user).model_dump()
    return MeResponse(**base, csrf_token=csrf_token_for_session(str(ctx.session.id)))


@router.post("/logout", response_model=GenericMessageResponse, summary="End this session on the server and clear the cookie")
async def logout(
    request: Request,
    response: Response,
    ctx: AuthContext | None = Depends(get_auth_context_optional),
    db: AsyncSession = Depends(get_db),
):
    enforce_rate_limit("session", request)
    if ctx is not None:
        # A valid cookie session needs the CSRF token, so another site cannot sign you out.
        await require_csrf(request, ctx)
        await _service(db).revoke_session(ctx.session.id, "logout")
        await db.commit()
    _clear_auth_cookie(response)  # idempotent: also fine when there was no valid session
    return GenericMessageResponse(message="Successfully logged out.")


@router.post("/logout-all", response_model=GenericMessageResponse, summary="Sign out on every device")
async def logout_all(
    request: Request,
    response: Response,
    ctx: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    enforce_rate_limit("session", request)
    await _service(db).revoke_all_sessions(ctx.user.id, "logout_all")
    await db.commit()
    _clear_auth_cookie(response)
    return GenericMessageResponse(message="Signed out on all devices.")


@router.post(
    "/forgot-password",
    response_model=GenericMessageResponse,
    summary="Request a password reset code",
)
async def forgot_password(
    request: Request,
    data: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    enforce_rate_limit("forgot", request, data.email)
    service = _service(db)
    await service.request_password_reset(data.email)
    await db.commit()
    background_tasks.add_task(service.send_pending_emails)
    return GenericMessageResponse(message=FORGOT_MESSAGE)


@router.post(
    "/reset-password",
    response_model=GenericMessageResponse,
    summary="Set a new password using the reset code",
)
async def reset_password(
    request: Request,
    data: ResetPasswordRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    enforce_rate_limit("reset", request, data.email)
    service = _service(db)
    success, message = await service.reset_password_public(data.email, data.otp, data.new_password)
    # Commit even on failure so attempt counts and invalidated codes are saved.
    await db.commit()
    if not success:
        raise ApiError(400, message, "code_locked" if message == MSG_LOCKED else "invalid_code")
    background_tasks.add_task(service.send_pending_emails)
    return GenericMessageResponse(message=message)
