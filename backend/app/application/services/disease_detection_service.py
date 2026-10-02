"""
Disease detection provider (spec sections 15, 17, 33).

STATUS: no model is configured. This module is the INTERFACE and the
architectural boundary, not a working detector.

Why it is not stubbed with plausible output
-------------------------------------------
A fake prediction here would be actively dangerous, not merely useless.
An officer who is told "Tomato Early Blight, 87% confidence" and treats
a crop accordingly has acted on a fabricated diagnosis - real cost to a
real farmer. It would also contradict the whole premise of this system,
which is that answers come from verified records rather than being
invented. So `detect()` returns an explicit unavailable result, and
every caller is written to handle that as a normal path rather than an
error.

The boundary the spec asks for (section 33)
-------------------------------------------
Detection NEVER produces a solution. Its only output is a disease
identifier plus a confidence score. The knowledge search then runs
exactly as it would for a typed query. That separation is enforced by
this module's return type: there is no field in DetectionResult that
could carry solution text even if a future provider tried to supply it.

Wiring a real model in later
----------------------------
Implement `DetectionProvider.detect()` in a new subclass, set
DISEASE_DETECTION_PROVIDER to point at it, and nothing else in the
application changes - the router, the search handoff, and the logging
are all provider-agnostic already.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import uuid


@dataclass
class DetectionResult:
    """Deliberately carries NO solution text - see module docstring."""
    available: bool
    predicted_disease_id: Optional[uuid.UUID] = None
    predicted_disease_name: Optional[str] = None
    confidence: Optional[float] = None
    provider: str = "none"
    # Shown to the officer when available is False, so the UI never has
    # to invent an explanation for why nothing came back.
    message: Optional[str] = None


class DetectionProvider:
    """Interface a real model implementation would satisfy."""

    name = "base"

    async def detect(self, image_url: str) -> DetectionResult:  # pragma: no cover - interface
        raise NotImplementedError


class UnconfiguredProvider(DetectionProvider):
    """The active provider until a real model is deployed.

    Returns unavailable rather than raising: image search is an
    enhancement, and an officer using it should be told plainly that
    automatic identification is not switched on and offered the text
    search instead - not shown an error that looks like a malfunction.
    """

    name = "none"

    async def detect(self, image_url: str) -> DetectionResult:
        return DetectionResult(
            available=False,
            provider=self.name,
            message=(
                "Automatic disease identification from photos isn't available yet. "
                "You can still describe the symptoms in the search box, or attach this "
                "photo to a new case for an expert to review."
            ),
        )


# Swap this for a real implementation to enable detection app-wide.
DISEASE_DETECTION_PROVIDER: DetectionProvider = UnconfiguredProvider()


async def detect_disease(image_url: str) -> DetectionResult:
    """Single entry point used by the router.

    Failures are contained here and converted into an unavailable
    result: a detection provider going down must degrade image search
    to "not available", never break the officer's ability to search or
    file a case.
    """
    try:
        return await DISEASE_DETECTION_PROVIDER.detect(image_url)
    except Exception:
        return DetectionResult(
            available=False,
            provider=DISEASE_DETECTION_PROVIDER.name,
            message="Automatic disease identification is temporarily unavailable. Please describe the symptoms instead.",
        )
