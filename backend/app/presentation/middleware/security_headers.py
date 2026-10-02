"""
Security headers middleware.

Adds standard defensive HTTP headers to every response. This is API-only
(no HTML templates rendered by this backend), so CSP is locked down hard;
the frontend (Next.js) sets its own appropriate CSP for rendered pages.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        for header, value in _SECURITY_HEADERS.items():
            if header == "Content-Security-Policy" and request.url.path in {"/docs", "/redoc", "/openapi.json"}:
                continue
            response.headers.setdefault(header, value)
        return response
