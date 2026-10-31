"""
Pagination for list endpoints. Every list must use this so no endpoint can return an unbounded
result: the page size is capped, and the total is counted by the database.

    @router.get("/things", response_model=Page[ThingOut])
    async def list_things(params: PaginationParams = Depends(pagination_params), db=Depends(get_db)):
        return await paginate(db, select(Thing).order_by(Thing.created_at.desc()), params, ThingOut)
"""
import math
from dataclasses import dataclass
from typing import Any, Callable, Optional, Type, TypeVar

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.common import Page

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100
MAX_PAGE = 100_000

ItemT = TypeVar("ItemT", bound=BaseModel)


@dataclass(frozen=True)
class PaginationParams:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def pagination_params(
    page: int = Query(1, ge=1, le=MAX_PAGE, description="Page number, starting at 1"),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE, description=f"Items per page (at most {MAX_PAGE_SIZE})"),
) -> PaginationParams:
    return PaginationParams(page=page, page_size=page_size)


async def paginate(
    db: AsyncSession,
    stmt: Select,
    params: PaginationParams,
    schema: Type[ItemT],
    transform: Optional[Callable[[Any], ItemT]] = None,
) -> Page[ItemT]:
    """
    Run `stmt` (already filtered and ordered) one page at a time and return a Page of `schema` items.
    `transform` builds each item from a row when a plain `schema.model_validate(row)` is not enough.
    """
    total = (await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
    rows = (await db.execute(stmt.limit(params.page_size).offset(params.offset))).scalars().all()
    return Page[schema](
        items=[transform(row) if transform else schema.model_validate(row) for row in rows],
        page=params.page,
        page_size=params.page_size,
        total=total,
        pages=math.ceil(total / params.page_size) if total else 0,
    )
