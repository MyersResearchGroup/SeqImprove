# Multi-user readiness — investigation

Scope: what breaks if many people use SeqImprove at the same time, sharing the
same part libraries, the same alignment indexes and the same tools, where each
person can also update their own private SynBioHub libraries and must be
guaranteed to see their update on the next run.

Branch: `multi_users`. Everything under "Fixed" is committed on this branch and
has a reproduction test in the log below. "Needs a decision" is what is left —
it has shrunk as the tenancy work landed; what remains there genuinely needs a
product or architecture call.

---

## The one-sentence summary

**The server had no concept of a user.** Every cache, every index and every
library list was one global object shared by everyone. There is now a principal
(`identity.py`), private libraries are partitioned by owner while public ones
stay shared, and the cache-invalidation and locking bugs behind requirements 1–4
are fixed. What is left is mostly capacity and deployment shape, plus one real
product question about sharing.

---

## Fixed

### 1. An updated library was never picked up  — *req 4*

Three independent bugs stacked on top of each other, all in `library_cache.py`.
Any one of them alone was enough to serve stale parts forever.

**1a. The merged (subset) FeatureLibrary was keyed by path only.**

```python
key = frozenset(os.path.abspath(p) for p in file_paths)
if key in self._subset_feature_libraries:
    return self._subset_feature_libraries[key]     # never invalidated
```

This is the object annotation actually runs against. Once built for a given set
of libraries it was returned forever, whatever happened to the files. Proven
before the fix:

```
initial:  subset library contains ['partA']
after update: subset library contains ['partA']      <- partB_NEW missing
same object returned: True
```

Now keyed by `(paths, content-hashes)`, so updated content produces a different
key and the merged library is rebuilt. Superseded entries for the same path set
are dropped so the dict does not grow.

**1b. `get_library_hash` skipped hashing when the file size was unchanged.**

```python
if current_size == cached_info.file_size:
    return self._hashes[abs_path]      # stale hash
```

A same-length edit — a description tweak, any equal-size rewrite — kept the old
hash, and with it the old Document, FeatureLibrary *and* alignment index (index
validity is checked against this hash). Proven: writing 1000 `A`s then 1000 `B`s
produced an identical hash.

The largest library in the repo is 1.4 MB and hashes in **14 ms**, so the
shortcut saved nothing. Removed; the bytes are always hashed.

**1c. The invalidation check compared the new hash against itself.**

`get_document` and `get_feature_library` did:

```python
current_hash = self.get_library_hash(abs_path)          # ← refreshes metadata
cached_info  = self._metadata.libraries.get(abs_path)
if cached_info.content_hash == current_hash:            # ← always True
    return self._documents[abs_path]
```

`get_library_hash` writes the freshly computed hash into
`_metadata.libraries[path]` as a side effect, so by the time the comparison ran
both sides were the new value. The check could never fail. Even with 1a and 1b
fixed, updates still did not propagate.

Now the hash of the bytes *actually parsed into the cache* is tracked separately
(`_document_hashes`, `_feature_library_hashes`) and compared against that.

**End-to-end result**, simulating import → update on SynBioHub → re-import:

```
import #1  subset: ['partA']
import #2  subset: ['partA', 'partB_NEW']
  same disk path:                True
  annotation sees the new part:  True
  index key changed:             True    (old index auto-invalidated)
```

### 2. Two locks guarding one object  — *req 1, 2*

`IndexManager.__init__` did `self._metadata = library_cache._metadata` — the same
object — but also `self._lock = threading.RLock()`, a *second* lock. A thread
inside `LibraryCache._lock` and one inside `IndexManager._lock` could mutate that
shared metadata, and run `_save_metadata`, concurrently. Two locks around one
object provide no mutual exclusion.

`IndexManager` now shares `library_cache._lock`. It is an `RLock`, so the nested
acquisitions inside that class stay safe.

### 3. Metadata written non-atomically  — *req 1, 2*

`_save_metadata` used `open(path, 'w')`, which truncates first. A crash or a
concurrent writer left a half-written file; `_load_metadata` catches
`JSONDecodeError`, silently returns empty metadata, and **the entire index cache
is orphaned on the next boot** — every index rebuilt from scratch.

Now writes a sibling temp file, `fsync`s, and `os.replace`s it (atomic on POSIX).
Readers see either the old file or the new one.

### 4. Indexes could be deleted while in use  — *req 2*

`get_or_create_index` returns bare paths and releases the lock immediately; the
aligner then reads those files for a long time with no lock held. A concurrent
`create_index` calls `_evict_oldest`, which `shutil.rmtree`s the LRU directory —
possibly the one BWA/BLASTN is reading, which surfaces as a mid-run
"no such file". With `max_indexes=10` and several users this is a matter of load,
not luck.

Added `IndexManager.pin_index(algorithm, library_paths)`, a context manager that
ref-counts an index as in-use; `_evict_oldest` skips pinned entries and, if
everything is pinned, lets the cache overflow rather than corrupt a running job.
`app.py` wraps the whole alignment in it.

### 5. Two users needing the same new index both built it  — *req 2*

`create_index` checked `has_index()` **outside** the lock and did not re-check
inside. Two requests for the same uncached library set both saw "missing", queued
on the lock, and the second rebuilt an index the first had just finished —
wasting a full `makeblastdb`, plus a second eviction round that could discard a
third user's index for nothing. Now re-checked under the lock.

### 6. `FEATURE_LIBRARIES` mutated without synchronisation  — *req 1*

A module-level dict written by `/api/importUserLibrary` and
`/api/deleteUserLibrary` while annotation requests read it, on a multi-threaded
server. The check-then-read in `create_feature_library` could `KeyError` if
another request deleted the entry in between. Now guarded by
`_feature_libraries_lock`, and the read is a single locked `.get()`.

### 7. Private libraries could not be re-fetched  — *req 5*

`materialize_remote_library` fetched with `{"Accept": "text/plain"}` and **no
token**, so any private collection came back `401` and was silently skipped. It
only ever worked when `/api/importUserLibrary` had already put the file on disk;
once the disk cache was cleared or the file was evicted, private libraries broke.

`sessionToken` is now accepted by `/api/annotateSequence` and threaded through
`resolve_library_paths` → `materialize_remote_library`. It is never logged and
never persisted. `force_refresh` was also added for an explicit re-fetch.

### 8. The import response enumerated everyone's libraries  — *req 5, privacy*

```python
return {"success": True, "cachedUrl": ..., "librariesInCache": list(FEATURE_LIBRARIES.keys())}
```

Importing anything returned the URLs of **every library every user had ever
imported**, including other people's private SynBioHub collections. Nothing in
the frontend read the field. Removed, along with the same listing in the log line.

---

## Fixed — round two (tenancy)

### 9. There is now a principal  — *req 5*

New `apps/server/identity.py`. `resolve_principal(session_token, instance)` maps
the SynBioHub session the user already holds to a stable key by calling
`/profile` with `X-authorization` (verified: that path is an auth endpoint — 401
anonymously and with a bad token, versus 404 for a path that doesn't exist).

Three deliberate choices:

- The key is `(instance, username)`, **not** the token. Tokens rotate on every
  login, so a token-derived key would give the same person a fresh cache
  partition each session and re-fetch everything. The instance is part of the key
  because a user can be logged into different SynBioHub deployments, where the
  same username is a different account.
- If the profile lookup fails the caller is **not** treated as anonymous — that
  would hand them the shared partition. They fall back to a token-scoped key:
  correct and private, just not reusable across sessions.
- Resolved principals are cached for 15 minutes, so a burst of requests costs one
  lookup and a revoked token stops working promptly.

The frontend now sends `sessionToken` and `synBioHubUrlPrefix` on every library
call and on annotate, via one `synBioHubCredentials()` helper.

### 10. Private libraries are partitioned; public ones stay shared  — *req 5*

This was gap **B**, the central hole: `remote/<sha256(url)>.xml` was keyed by URL
alone, so content user A fetched with A's token was handed to any user B who
named the same URL, with no authorization check.

Visibility is decided the only way that is authoritative: **fetch the URL with no
credentials — 200 means public, 401/403 means private**; anything else (network
error, 5xx) is treated as private, the safe answer when we can't tell. Cached for
10 minutes so a collection made private stops being served from the shared path.

- public  → `remote/<url-hash>.xml`               (shared: one file, one index)
- private → `remote/u/<principal>/<url-hash>.xml` (per owner)

`FEATURE_LIBRARIES` is keyed the same way. Public sharing is kept deliberately:
partitioning everything by user would multiply index builds and disk by the
number of users, for data everyone is allowed to read anyway.

Verified with two principals against the same private URL and the same public
URL:

```
private  alice -> .cache/remote/u/u_alice/d0367cd3.xml
private  bob   -> .cache/remote/u/u_bob/d0367cd3.xml     isolated
         alice sees ['alice_secret_part'], bob sees ['bob_own_part']
public   alice -> .cache/remote/22e6769a.xml
public   bob   -> .cache/remote/22e6769a.xml             shared
```

### 11. Ownership checks on the library endpoints  — *req 5*

- `/api/deleteUserLibrary` now deletes only the caller's own partition entry.
  Previously any user could evict any library by naming its URL.
- `/api/checkLibraryCache` answers for the caller's partition only. It was an
  existence oracle: anyone could probe any URL and learn which private
  collections other people had imported.

### 12. Index builds no longer hold the global lock  — *req 2, 3*

`create_index` held the cache lock across `makeblastdb`/`bwa index`, so one
user's build froze **every** cache operation server-wide — other users' hash
lookups, document reads, even index hits — for its full duration. On a 4-thread
server that is most of the way to a stall.

The FASTA write and the tool invocation now run in a scratch directory with no
cache lock held; the finished index is moved into place under the lock. A
per-index-key build lock keeps two callers wanting the *same* index from building
it twice, while callers wanting *different* indexes proceed in parallel.

Verified with 8 concurrent requests for 5 distinct indexes and a stubbed 0.4 s
build: **0.56 s wall clock against 2.0 s+ if serialised**, exactly 5 indexes
built, no leftover staging directories, metadata intact.

### 13. `FEATURE_LIBRARIES` is bounded  — was gap J

Imported collections accumulated one entry per (user, collection) with nothing to
evict them — a leak that grows with every user, made worse by partitioning. Now
an LRU capped at `MAX_REMOTE_FEATURE_LIBRARIES = 32`, touched on every cache hit.
Locally preloaded libraries are a fixed set and are not subject to it.

---

## Needs a decision

### A. The imported-library list is still browser-only

Identity itself is now implemented (fix 9). What is not: the frontend keeps
`importedLibraries` in the zustand store, so a user switching browser or device
loses their list even though the server could now reconstruct it per principal.
Persisting it server-side is a small feature, but it is a feature, not a fix.

Also unverified: `/profile`'s exact response shape. The resolver tries
`username`, `user`, `name`, `email` in that order and falls back to a
token-scoped key if none is present. It has not been run against a live
authenticated session — worth a single manual check with a real token.

### B. Should a private library ever be shareable?

The partition is implemented (fix 10): private content is now strictly per-owner.
The remaining question is product, not code — **if A wants to share a private
collection with B, should that be possible?** Today it is not, by construction.
Supporting it turns a partition into an ACL, which needs a place to store grants
and a UI to manage them. Worth deciding before anyone asks for it.

Related: two users who both have legitimate access to the same private collection
each get their own copy and their own alignment index. That is correct but
wasteful. Deduplicating it safely would mean keying private content by
`(content hash, set of principals who proved access)`, which is materially more
complex — only worth it if that case turns out to be common.

### C. `/api/cache/clear` is still global and unauthenticated

`deleteUserLibrary` and `checkLibraryCache` are scoped now (fix 11), but
`/api/cache/clear` still wipes every cache for everyone, with no auth. It is
presumably an operator tool; it should either require an admin credential or be
removed from the public surface.

### D. Index capacity is 10, globally — now more pressing

`DEFAULT_MAX_INDEXES = 10`, shared by all users. Partitioning private libraries
*increases* the number of distinct indexes (two users with the same private
collection now have two), so the LRU will thrash sooner than before. Needs sizing
against expected concurrency, or a per-principal quota. Same for
`MAX_REMOTE_FEATURE_LIBRARIES = 32`, which I picked without data.

### E. Prokka is a global singleton

`ProkkaAligner` uses hardcoded paths (`./database_protein.fasta`,
`./PROKKA_SYNBICT/`) in the process working directory, so concurrent runs would
overwrite each other. `_prokka_lock` serialises them, which is correct but means
**one user's Prokka run blocks every other user's** for its full duration — and
Prokka is the slowest thing in the pipeline. Fixing it properly means running
each invocation in its own temp directory, which is a change to SYNBICT's
`ProkkaAligner`, not to SeqImprove.

### F. The server runs 4 threads

`serve(app, host="0.0.0.0", port=8080)` — waitress defaults to `threads=4`. That
is the hard ceiling on concurrent annotations regardless of anything else, and
long jobs (Prokka, index builds) occupy a thread for minutes.

### G. All state is per-process, so this does not scale horizontally

Every cache here is in-process memory plus a local disk directory. Run two
replicas behind a load balancer and user A's library update on replica 1 is
invisible to replica 2 — which breaks requirement 4 as soon as the service is
scaled out. Shared state would have to move to something external (a shared
volume plus a real cache-invalidation signal, or a database).

---

## Log of what was verified, and how

| Claim | How it was checked |
|---|---|
| Subset library never invalidated | built a library, updated it, re-read — `partB_NEW` missing, same object returned |
| Size shortcut hides changes | 1000×`A` vs 1000×`B` → identical hash |
| Invalidation compared new hash to itself | traced `get_library_hash`'s write into `_metadata` before the comparison |
| Update now propagates | import → update → re-import; new part visible, index key changed |
| Locks/atomicity hold | 8 threads × 25 iterations of subset reads, hashing, pinning, eviction and metadata saves: no exceptions, metadata still parses, no temp files left, both classes share one lock |
| Private collections 401 anonymously | live request to the real SynBioHub for a private collection and two of its members |
| Prokka/threads/capacity | read from `app.py` and `library_cache.py` constants |
| `/profile` is an auth endpoint | live: 401 anonymous, 401 with a bad token, 404 for a nonexistent path |
| Private isolated, public shared | two principals against the same private and the same public URL — separate paths for private, one path for public |
| Parallel index builds | 8 concurrent requests for 5 distinct indexes, stubbed 0.4 s build: 0.56 s wall vs 2.0 s+ serial, 5 indexes built, no staging left |
| LRU bound on remote libraries | 8 inserts against a cap of 5, then a hit on the oldest survivor before 2 more inserts — cap held, recently-used entry retained |

Not verified: none of this has been exercised against a running server with real
concurrent users, and `/profile`'s response shape has not been confirmed with a
live authenticated session (the resolver tries several field names and degrades
to a token-scoped key). The fixes are unit-level and reasoned; a load test with
several simultaneous annotations, by two real accounts, is the obvious next step.
