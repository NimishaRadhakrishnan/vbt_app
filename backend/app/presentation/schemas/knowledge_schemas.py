from pydantic import BaseModel, Field
from typing import Optional
import uuid
from datetime import datetime


class SynonymResponse(BaseModel):
    id: uuid.UUID
    term: str
    synonym: str
    is_active: bool
    created_at: datetime


class SynonymCreateRequest(BaseModel):
    term: str = Field(min_length=1, max_length=100)
    synonym: str = Field(min_length=1, max_length=100)


class SynonymUpdateRequest(BaseModel):
    term: Optional[str] = Field(default=None, min_length=1, max_length=100)
    synonym: Optional[str] = Field(default=None, min_length=1, max_length=100)
    is_active: Optional[bool] = None


# --- Phase 2: cases, solutions, versions ---

VERIFICATION_STATES = ("draft", "pending_review", "verified", "rejected", "archived")


class CaseImageInput(BaseModel):
    image_url: str = Field(max_length=500)
    image_type: Optional[str] = None  # leaf | plant | closeup | fruit | stem | other
    caption: Optional[str] = None


class CaseImageResponse(BaseModel):
    id: uuid.UUID
    image_url: str
    image_type: Optional[str] = None
    caption: Optional[str] = None


class CaseCreateRequest(BaseModel):
    """What an officer submits (spec section 8). Only `question` is
    required - an officer filing a case often does not yet know the
    disease, and demanding a crop/disease ID up front would push them to
    guess, which poisons the knowledge base with wrong labels."""
    question: str = Field(min_length=1)
    crop_id: Optional[uuid.UUID] = None
    disease_id: Optional[uuid.UUID] = None
    crop_text: Optional[str] = Field(default=None, max_length=200)
    disease_text: Optional[str] = Field(default=None, max_length=200)
    symptoms: Optional[str] = None
    solution_used: Optional[str] = None
    notes: Optional[str] = None
    district: Optional[str] = Field(default=None, max_length=100)
    images: list[CaseImageInput] = Field(default_factory=list)


class SolutionVersionResponse(BaseModel):
    id: uuid.UUID
    version_number: int
    solution_text: str
    instructions: Optional[str] = None
    precautions: Optional[str] = None
    source_reference: Optional[str] = None
    created_at: datetime


class SolutionResponse(BaseModel):
    id: uuid.UUID
    title: str
    disease_id: Optional[uuid.UUID] = None
    crop_id: Optional[uuid.UUID] = None
    status: str
    usage_count: int
    helpful_count: int
    not_helpful_count: int
    current_version: Optional[SolutionVersionResponse] = None
    created_at: datetime


class CaseResponse(BaseModel):
    id: uuid.UUID
    case_number: int
    question: str
    crop_id: Optional[uuid.UUID] = None
    disease_id: Optional[uuid.UUID] = None
    crop_text: Optional[str] = None
    disease_text: Optional[str] = None
    crop_name: Optional[str] = None
    disease_name: Optional[str] = None
    symptoms: Optional[str] = None
    solution_used: Optional[str] = None
    notes: Optional[str] = None
    district: Optional[str] = None
    verification_status: str
    rejection_reason: Optional[str] = None
    usage_count: int
    created_at: datetime
    images: list[CaseImageResponse] = Field(default_factory=list)
    solution: Optional[SolutionResponse] = None
    # Officer identity is included ONLY for admins - see spec section 32
    # and the router's own note on why it is withheld from officers.
    officer_name: Optional[str] = None


class SolutionCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    solution_text: str = Field(min_length=1)
    disease_id: Optional[uuid.UUID] = None
    crop_id: Optional[uuid.UUID] = None
    instructions: Optional[str] = None
    precautions: Optional[str] = None
    source_reference: Optional[str] = Field(default=None, max_length=500)


class SolutionNewVersionRequest(BaseModel):
    """Creates a NEW version rather than editing in place (spec section
    13) - the previous version stays intact for cases that used it."""
    solution_text: str = Field(min_length=1)
    instructions: Optional[str] = None
    precautions: Optional[str] = None
    source_reference: Optional[str] = Field(default=None, max_length=500)


class CaseVerifyRequest(BaseModel):
    # Optionally attach/create the verified solution at approval time.
    solution_id: Optional[uuid.UUID] = None


class CaseRejectRequest(BaseModel):
    reason: str = Field(min_length=1)
