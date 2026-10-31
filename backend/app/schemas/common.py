"""Response shapes shared by every list endpoint."""
from typing import Generic, List, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """One page of results plus enough information for the website to build page controls."""
    items: List[T]
    page: int
    page_size: int
    total: int
    pages: int
