"""
Routes for the signed-in user's own profile. Only the fields in `UpdateProfileRequest` can be changed;
role, account status, KYC status and email are never editable here.
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, get_auth_context, require_csrf
from app.core.rate_limit import enforce_rate_limit
from app.db.session import get_db
from app.schemas.auth import UserResponse
from app.schemas.users import UpdateProfileRequest

router = APIRouter(prefix="/api/users", tags=["Users"])


@router.get("/me", response_model=UserResponse, summary="The signed-in user's profile")
async def get_my_profile(request: Request, ctx: AuthContext = Depends(get_auth_context)):
    enforce_rate_limit("session", request)
    return UserResponse.model_validate(ctx.user)


@router.patch("/me", response_model=UserResponse, summary="Update your own name, mobile or organization")
async def update_my_profile(
    request: Request,
    body: UpdateProfileRequest,
    ctx: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    enforce_rate_limit("session", request)
    user = ctx.user
    old_mobile = user.mobile
    for field in body.model_fields_set:          # only the fields the caller actually sent
        setattr(user, field, getattr(body, field))
    if user.mobile != old_mobile:
        user.is_mobile_verified = False          # a new number is confirmed again with an SMS code
    await db.commit()
    return UserResponse.model_validate(user)
