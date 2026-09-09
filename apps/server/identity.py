"""
Caller identity and library visibility.

The server had no notion of a user: every cache and every library list was one
global object. That is fine for public data and wrong for private data, so this
module supplies the two facts the caches need to keep tenants apart:

  principal   -- who is asking, stable across that person's sessions
  visibility  -- whether a SynBioHub collection is public or private

Only private data is partitioned. Public libraries stay shared, because two
users annotating against the same public collection should reuse one cached file
and, more importantly, one alignment index; partitioning everything by user
would multiply index builds and disk by the number of users.
"""

import hashlib
import re
import threading
import time
from typing import Optional, Tuple

import requests

# A resolved principal is cached this long. Short enough that a revoked token
# stops working promptly, long enough that a burst of requests costs one lookup.
PRINCIPAL_TTL_SECONDS = 15 * 60
# Whether a collection is public rarely changes, but it can, so don't cache it
# forever -- a collection made private must stop being served from the shared
# path.
VISIBILITY_TTL_SECONDS = 10 * 60

_lock = threading.RLock()
_principal_cache: dict = {}   # (instance, token) -> (principal, expires_at)
_visibility_cache: dict = {}  # canonical url -> (is_public, expires_at)

# Fields that identify the account, most stable first. Verified against a live
# /profile response, which returns:
#   {"id":1188,"name":"Chunxiao Liao","username":"sophia2014cs",
#    "email":"...","graphUri":"https://synbiohub.org/user/sophia2014cs",...}
#
# `id` is SynBioHub's immutable primary key, so it survives a username change.
# `name` is deliberately NOT in this list: it is a display name ("Chunxiao Liao")
# and is not unique, so two different accounts sharing one could collide into the
# same cache partition -- exactly the cross-tenant leak this partitioning exists
# to prevent.
_IDENTITY_FIELDS = ("id", "username", "graphUri", "email")

DEFAULT_INSTANCE = "https://synbiohub.org"


def canonical_url(url: str) -> str:
    """Strip the api. prefix so api.synbiohub.org and synbiohub.org agree."""
    return re.sub(r'^(https?://)api\.', r'\1', url or '')


def _api_host(url: str) -> str:
    """Route through api.synbiohub.org, which is not behind Cloudflare."""
    return re.sub(r'^(https?://)(?!api\.)(synbiohub\.org)', r'\1api.\2', url or '')


def _digest(*parts: str) -> str:
    return hashlib.sha256('|'.join(parts).encode('utf-8')).hexdigest()[:16]


def _safe_component(value: str) -> str:
    """Keep a principal usable as a single path segment on any filesystem."""
    return re.sub(r'[^A-Za-z0-9_.-]', '_', value or '')


def resolve_principal(session_token: Optional[str],
                      instance: Optional[str] = None) -> Optional[str]:
    """Map a SynBioHub session token to a stable per-user key.

    Returns None for an anonymous caller, who may only use public libraries.

    The key is derived from (instance, username) rather than from the token
    itself: tokens rotate on every login, so a token-derived key would give the
    same person a fresh cache partition each session and re-fetch everything.
    The instance is part of the key because a user can be logged into different
    SynBioHub deployments, where the same username is a different account.

    If the profile lookup fails the caller is NOT treated as anonymous -- that
    would silently hand them the shared partition. They get a token-scoped key
    instead: correct and private, just not reusable across their sessions.
    """
    if not session_token:
        return None

    instance = canonical_url(instance or DEFAULT_INSTANCE).rstrip('/')
    cache_key = (instance, session_token)
    now = time.time()

    with _lock:
        hit = _principal_cache.get(cache_key)
        if hit and hit[1] > now:
            return hit[0]

    username = None
    try:
        response = requests.get(
            f"{_api_host(instance)}/profile",
            headers={"Accept": "application/json", "X-authorization": session_token},
            timeout=30,
        )
        if response.status_code == 200:
            try:
                payload = response.json()
            except ValueError:
                payload = None
            if isinstance(payload, dict):
                for field in _IDENTITY_FIELDS:
                    value = payload.get(field)
                    # `id` arrives as a number; everything else as a string.
                    if isinstance(value, (int, float)) and not isinstance(value, bool):
                        username = f"{field}:{value}"
                        break
                    if isinstance(value, str) and value.strip():
                        username = f"{field}:{value.strip()}"
                        break
    except requests.exceptions.RequestException:
        username = None

    if username:
        principal = "u_" + _digest(instance, username)
    else:
        # Unresolvable: partition by token so nothing is shared, and don't cache
        # it long -- the next attempt may resolve properly.
        principal = "t_" + _digest(instance, session_token)

    with _lock:
        _principal_cache[cache_key] = (principal, now + PRINCIPAL_TTL_SECONDS)
    return principal


# SynBioHub namespaces every object by owner in the URL itself:
#   https://<host>/public/<collection>/...      published, readable by all users
#   https://<host>/user/<username>/<...>        that user's own space
_PUBLIC_PATH = re.compile(r'^https?://[^/]+/public/', re.I)
_PRIVATE_PATH = re.compile(r'^https?://[^/]+/user/', re.I)


def is_public(url: str) -> bool:
    """Is this collection shareable between users of this SeqImprove instance?

    Decided from the URL namespace, because the obvious test -- fetch it with no
    credentials and see whether it returns 200 -- does not work against a
    SynBioHub that requires a login for everything, which is the deployment this
    talks to. There, every anonymous request returns 401 including /public/
    paths, so that test classified *everything* as private and the shared cache
    for public collections never engaged.

    The namespace is authoritative in SynBioHub's own model: /public/ means
    published, /user/<name>/ is that account's space. On an instance where
    everything needs a login, "public" therefore means "readable by any account
    on this instance", which is exactly the right boundary for sharing one cached
    copy and one alignment index between our users.

    This trusts a convention rather than verifying access, which is the trade
    being made. For a URL of neither shape we fall back to the anonymous probe,
    and to "private" if that fails -- the safe answer when we cannot tell.
    """
    canonical = canonical_url(url)

    if _PUBLIC_PATH.match(canonical):
        return True
    if _PRIVATE_PATH.match(canonical):
        return False

    now = time.time()
    with _lock:
        hit = _visibility_cache.get(canonical)
        if hit and hit[1] > now:
            return hit[0]

    public = False
    try:
        response = requests.get(_api_host(canonical),
                                headers={"Accept": "text/plain"},
                                timeout=60, stream=True)
        public = response.status_code == 200
        response.close()
    except requests.exceptions.RequestException:
        public = False

    with _lock:
        _visibility_cache[canonical] = (public, now + VISIBILITY_TTL_SECONDS)
    return public


def partition_for(url: str, principal: Optional[str]) -> Tuple[str, bool]:
    """Where a remote library's cached copy belongs.

    Returns (partition, shared). `partition` is '' for the shared public area,
    or the principal for a private one.
    """
    if is_public(url):
        return '', True
    return _safe_component(principal or 'anonymous'), False
