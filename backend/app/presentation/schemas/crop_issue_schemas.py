"""
CropIssue Pydantic schemas.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class ReportCropIssueRequest(BaseModel):
    farmer_id: uuid.UUID
    crop: str = Field(min_length=1, max_length=100)
    district: str = Field(min_length=1, max_length=100)
    symptoms: str = Field(min_length=1)
    image_url: Optional[str] = None
    voice_notes_url: Optional[str] = None


class CropIssueResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    farmer_id: uuid.UUID
    crop: str
    district: str
    symptoms: str
    assigned_expert_whatsapp: str
    image_url: Optional[str] = None
    voice_notes_url: Optional[str] = None
    status: str
    expert_reply: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ResolveCropIssueRequest(BaseModel):
    expert_reply: str = Field(..., min_length=1)

    # Knowledge-base auto-feed controls. Default True so the knowledge
    # base grows by itself from ordinary expert work - an opt-in default
    # would leave it empty, because nobody ticks an extra box on a form
    # they have already finished.
    add_to_knowledge: bool = True

    # Optional rewrite of the reply for reuse. An expert answering one
    # farmer often writes something that only makes sense to that farmer;
    # this is where they can put the version other officers can act on.
    # Supplying it also skips the reusability heuristic, since writing it
    # IS the expert deciding it is reusable.
    reusable_solution: Optional[str] = None