# Multi-user readiness — investigation

Scope: what breaks if many people use SeqImprove at the same time, sharing the
same part libraries, the same alignment indexes and the same tools, where each
person can also update their own private SynBioHub libraries and must be
guaranteed to see their update on the next run.

Branch: `multi_users`. Everything under "Fixed" is committed on this branch and
has a regression test in `apps/server/tests/`. "Needs a decision" is what is left —
it has shrunk as the tenancy work landed; what remains there genuinely needs a
product or architecture call.

---

## Contents

- [The one-sentence summary](#the-one-sentence-summary)
- [Fixed](#fixed)
  - [1. An updated library was never picked up](#1-an-updated-library-was-never-picked-up---req-4)
  - [2. Two locks guarding one object](#2-two-locks-guarding-one-object---req-1-2)
  - [3. Metadata written non-atomically](#3-metadata-written-non-atomically---req-1-2)
  - [4. Indexes could be deleted while in use](#4-indexes-could-be-deleted-while-in-use---req-2)
  - [5. Two users needing the same new index both built it](#5-two-users-needing-the-same-new-index-both-built-it---req-2)
  - [6. FEATURE_LIBRARIES mutated without synchronisation](#6-feature_libraries-mutated-without-synchronisation---req-1)
  - [7. Private libraries could not be re-fetched](#7-private-libraries-could-not-be-re-fetched---req-5)
  - [8. The import response enumerated everyone's libraries](#8-the-import-response-enumerated-everyones-libraries---req-5-privacy)
- [Fixed — round two (tenancy)](#fixed--round-two-tenancy)
  - [9. There is now a principal](#9-there-is-now-a-principal---req-5)
  - [10. Private libraries are partitioned; public ones stay shared](#10-private-libraries-are-partitioned-public-ones-stay-shared---req-5)
  - [11. Ownership checks on the library endpoints](#11-ownership-checks-on-the-library-endpoints---req-5)
  - [12. Index builds no longer hold the global lock](#12-index-builds-no-longer-hold-the-global-lock---req-2-3)
  - [13. FEATURE_LIBRARIES is bounded](#13-feature_libraries-is-bounded---was-gap-j)
  - [14. A cached library could be read while it was being rewritten](#14-a-cached-library-could-be-read-while-it-was-being-rewritten---req-1-4)
  - [15. The index was pinned only after it was handed out](#15-the-index-was-pinned-only-after-it-was-handed-out---req-2)
  - [Fetching a collection's members](#fetching-a-collections-members)
  - [Keeping up with SynBioHub](#keeping-up-with-synbiohub)
  - [What happens to the old index when a library changes](#what-happens-to-the-old-index-when-a-library-changes)
  - [Which caches the shipped libraries take part in](#which-caches-the-shipped-libraries-take-part-in)
  - [Public collections are re-checked too](#public-collections-are-re-checked-too)
  - [Migrating caches written before partitioning](#migrating-caches-written-before-partitioning)
  - [Scheduled cleanup](#scheduled-cleanup)
  - [Shipped libraries resident; imported ones lazy](#shipped-libraries-resident-imported-ones-lazy)
- [Configuration reference](#configuration-reference)
  - [The merged-library cache needs no pool of its own](#the-merged-library-cache-needs-no-pool-of-its-own)
  - [Two pools, not one queue](#two-pools-not-one-queue)
  - [The eviction policy is LRU — recency, not frequency](#the-eviction-policy-is-lru--recency-not-frequency)
- [Needs a decision](#needs-a-decision)
  - [A. The imported-library list was lost on every reload — now remembered per browser](#a-the-imported-library-list-was-lost-on-every-reload--now-remembered-per-browser)
  - [B. Should a private library ever be shareable? — decided: no](#b-should-a-private-library-ever-be-shareable--decided-no)
  - [C. /api/cache/clear was global and unauthenticated — removed](#c-apicacheclear-was-global-and-unauthenticated--removed)
  - [D. Capacity limits — sized, and now configurable](#d-capacity-limits--sized-and-now-configurable)
  - [E. Prokka was a global singleton — each run now has its own directory](#e-prokka-was-a-global-singleton--each-run-now-has-its-own-directory)
  - [F. The server ran 4 threads — now configurable](#f-the-server-ran-4-threads--now-configurable)
  - [G. All state is per-process, so this does not scale horizontally](#g-all-state-is-per-process-so-this-does-not-scale-horizontally)
- [What has not been verified](#what-has-not-been-verified)

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

Three independent bugs in `library_cache.py`, stacked. Any one alone was enough
to serve stale parts forever.

**1a. The merged (subset) FeatureLibrary was keyed by path only.** This is the
object annotation actually runs against, and once built for a given set of
libraries it was returned forever, whatever happened to the files. Now keyed by
`(paths, content-hashes)`, so new content produces a new key. Superseded entries
for the same path set are dropped so the dict does not grow.

**1b. `get_library_hash` skipped hashing when the file size was unchanged.** A
same-length edit kept the old hash, and with it the old Document, FeatureLibrary
*and* alignment index — index validity is checked against this hash. The largest
library in the repo is 1.4 MB and hashes in 14 ms, so the shortcut saved nothing.
Removed; the bytes are always hashed.

**1c. The invalidation check compared the new hash against itself.**

```python
current_hash = self.get_library_hash(abs_path)   # writes the new hash into _metadata
cached_info  = self._metadata.libraries.get(abs_path)
if cached_info.content_hash == current_hash:     # ...so this is always True
    return self._documents[abs_path]
```

The hash of the bytes *actually parsed into the cache* is now tracked separately
(`_document_hashes`, `_feature_library_hashes`) and compared against that.

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
`/profile` with `X-authorization`. Confirmed against a live authenticated
session, which returns:

```json
{"id":1188,"name":"...","username":"<username>","email":"...",
 "graphUri":"https://synbiohub.org/user/<username>","isAdmin":true}
```

The identity is taken from `id` first — SynBioHub's immutable primary key, so it
survives a username change — then `username`, `graphUri`, `email`. **`name` is
deliberately excluded**: it is a display name and is not unique, so two accounts
sharing one would collide into a single cache partition, which is precisely the
cross-tenant leak this partitioning exists to prevent.

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
  A public collection is not deleted at all: its cached copy and index are
  shared, so one user removing it from their list would make everyone else
  re-download and re-index it. The delete only drops it from that user's list;
  the file-count cap, the public memory pool and the index TTL reclaim it once
  it goes unused. (Public downloads are not aged out by time unless
  `SEQIMPROVE_PRUNE_PUBLIC=1`.)
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

### 14. A cached library could be read while it was being rewritten  — *req 1, 4*

The freshness check deliberately runs *outside* the cache lock, because it makes
a network call and holding the lock across that would stall every other request.
But it also wrote the file there, with `Path.write_text` — which truncates first.
A thread parsing the same path under the lock could therefore read a truncated
document, or hash one.

All three writes of a cached library now go through `_atomic_write_text`: temp
file, `fsync`, `os.replace`. A reader sees the old bytes or the new ones, never a
mix. This is the same treatment `_save_metadata` already had; these writes had
been missed.

### 15. The index was pinned only after it was handed out  — *req 2*

`pin_index` exists so a concurrent build cannot `rmtree` the directory an aligner
is reading. `app.py` took the paths first and pinned afterwards, leaving a window
between the two in which exactly that could happen.

The pin is now taken first and the build happens inside it. `pin_index` needs
only the index *key*, which is derived from the algorithm and the library
content, so it can name an index that does not exist yet.

---

### Fetching a collection's members

SynBioHub serves two different things at a collection's URI: the bare URI returns
only that object, while `<uri>/sbol` returns the complete document with its
members and their sequences. Both the import path and the annotation path asked
for the bare URI, so a collection always arrived with no parts in it, produced an
empty FASTA, and surfaced as an opaque `makeblastdb` failure. The frontend
already knew this convention — it appends `/sbol` when loading a document by URL.

`_fetch_library_sbol()` tries the URL as given and retries with `/sbol` only when
the response contains no `ComponentDefinition`, so a URL that already points at a
part, or already ends in `/sbol`, still costs one request. Import, on-demand
materialization and the freshness check all share it, which puts the token
handling and the `api.synbiohub.org` routing in one place instead of three.

If even the retry has no parts, the import is rejected with an explanation rather
than caching an empty shell for the annotator to trip over later.

### Keeping up with SynBioHub

A cached remote library used to be trusted until something pruned it, so a user
who updated a collection on SynBioHub kept getting the old parts — for up to the
full 72 h TTL — unless they re-imported by hand. `force_refresh` existed as a
parameter but no caller ever set it.

Cached copies are now re-checked against SynBioHub at most once per
`SEQIMPROVE_REMOTE_FRESHNESS_MINUTES` (5). The file is rewritten only when the
bytes actually differ, at which point the content-hash machinery refreshes
everything downstream — Document, FeatureLibrary, merged subsets, and the index —
by itself. The check runs *outside* the cache lock, since it is a network call.

Failure is not an error: if SynBioHub is unreachable or refuses the request, the
cached copy is kept and the check retried next window. A stale library beats a
failed annotation.

| Path to an update | Latency |
|---|---|
| user re-imports by hand | immediate |
| user just runs annotation again | ≤ 5 min |
| nobody touches it | pruned at the TTL, re-fetched on next use |

**Visibility is decided by URL namespace, not by an anonymous probe.** The
obvious test — fetch with no credentials and see whether it returns 200 — does
not work here: this SynBioHub requires a login for everything, so every anonymous
request returns 401 including `/public/...` paths, on both `synbiohub.org` and
`api.synbiohub.org` (confirmed). That test classified *everything* as private, so
the shared cache never engaged and each user got their own copy and index of a
public collection.

SynBioHub namespaces objects by owner in the URL itself, and that is
authoritative in its own model:

```
https://<host>/public/<collection>/...   published — shared partition
https://<host>/user/<username>/...       that account's space — per-user partition
```

On an instance where everything needs a login, "public" means "readable by any
account on this instance", which is exactly the right boundary for sharing one
cached copy and one index between our users. A URL of neither shape still falls
back to the anonymous probe, and to private if that fails.

The trade being made: this trusts a convention instead of verifying access. If a
`/public/` collection were ever access-restricted, it would be cached in the
shared partition.

---

### What happens to the old index when a library changes

The index key is a hash of the algorithm plus the libraries' content, so updated
content produces a different key and the new index is built fresh — the old one
is never consulted again. It was not *removed*, though: with its key no longer
computable it simply sat on disk until the LRU or the 72 h TTL reached it, so
every update leaked one index for up to three days.

Detecting a content change now retires the indexes built from the previous
content in the same step. Pinned indexes are skipped, so an aligner mid-run is
unaffected; it will be retired on the next pass.

### Which caches the shipped libraries take part in

They are exempt from all of it:

| | shipped (`assets/`) | imported |
|---|---|---|
| `MAX_CACHED_LIBRARIES` LRU | never enters it | bounded |
| `MAX_REMOTE_FEATURE_LIBRARIES` (FlashText dict) | not tracked | bounded |
| janitor TTL | never scanned | private ones aged out |

Verified by pushing 40 imports through a cap of 3: all ten shipped libraries
stayed resident. They also no longer occupy a slot in the FlashText dict's LRU —
they are a fixed set of about ten that `LibraryCache` holds permanently anyway,
so letting them compete with imports would evict an import for no gain.

### Public collections are re-checked too

The freshness check is not private-only. `materialize_remote_library` runs it for
every remote library, so a public collection updated on SynBioHub reaches users
within the same window — and because the copy is shared, one user's request
refreshes it for everyone. Only the *janitor* treats public and private
differently, and that is about reclaiming disk, not about correctness.

### Migrating caches written before partitioning

Before downloads were partitioned by owner, every remote library landed in
`<cache>/remote/<hash>.xml` regardless of who fetched it. Those files are now
unreachable — a `/user/` URL resolves to `remote/u/<principal>/` — but they are
private content sitting in the shared area, and the janitor only scans the
private subtree, so they would stay there indefinitely.

`migrate_shared_private_downloads()` runs once at startup: it reads each file's
own URI and deletes the ones that are private. Deleted rather than moved, because
the file records no owner — which principal's partition it belongs in is
unknowable — and the next request re-fetches it into the right place.

On the current dev cache this identified two, both real private collections,
and left the two public ones alone.

### Scheduled cleanup

Count caps only fire when a cap is exceeded, so a quiet server keeps one user's
private library and its index indefinitely. A daemon janitor thread now ages
them out: everything is kept for the short term, then released.

| Variable | Default | Meaning |
|---|---|---|
| `SEQIMPROVE_CACHE_TTL_HOURS` | 72 | how long a download or index survives unused |
| `SEQIMPROVE_JANITOR_INTERVAL_MINUTES` | 60 | how often the sweep runs |
| `SEQIMPROVE_PRUNE_PUBLIC` | 0 | also age out *public* downloads |

**Only private downloads are aged out by default**, because they are the growth
this cleanup exists for:

| | count | heat | cost of dropping one |
|---|---|---|---|
| private | users × collections — unbounded | one user, occasionally | that user re-downloads |
| public | a small fixed set | shared, usually hot | **everyone** waits for a re-download *and* an index rebuild |

Reclaiming public downloads punishes every user to free a bounded amount of disk,
so it is off unless `SEQIMPROVE_PRUNE_PUBLIC=1`.

**An index is removed together with the library it was built from.** They used to
age on independent clocks, and an index outliving its source was not merely
untidy: `has_index()` re-hashes each source library to check validity, so the
leftover metadata made it raise `FileNotFoundError` in the middle of an
annotation request. Now pruning a library takes its indexes with it, deleting a
library through `/api/deleteUserLibrary` does the same, and both `has_index()`
and `_compute_index_key()` tolerate a missing source by treating the index as
invalid instead of throwing. Indexes with a live source are still TTL-pruned on
their own — they are derived data and rebuild on demand.

**Age is measured from last use, not from download.** Pruning keyed off the
file's mtime, which is set once when the library is fetched and never updated, so
a private library someone used every day would still have been deleted 72 h after
it was first downloaded. It now uses the recorded `last_accessed`, falling back to
mtime only when there is no metadata entry.

Otherwise conservative: libraries under `assets/` are never touched, a file still
parsed into memory is skipped (deleting it would leave a live Document pointing at
a missing path), and a pinned index — one an aligner is reading right now — is
left alone. Nothing removed is data: a pruned library is re-fetched from
SynBioHub and a pruned index is rebuilt, both automatically on next use. The
thread is a daemon and swallows exceptions, so a failed sweep retries next tick
rather than taking the server down.

`/api/deleteUserLibrary` now also removes the on-disk copy and every in-memory
form via `forget_remote_library()`. It previously deleted only the FlashText dict
entry, which — now that the dict is lazy — is often empty for a library that is
very much still cached.

### Shipped libraries resident; imported ones lazy

Two different sets, treated differently on purpose.

**Shipped libraries** (`assets/synbict/feature-libraries/`, ten files) are a
fixed set the server must be able to offer at any moment. They are preloaded at
startup — Documents *and* FeatureLibraries — and marked protected, so the LRU and
the janitor never touch them. Verified: with the cap forced to 3 and ten imported
libraries pushed through, all four shipped libraries stayed resident and the
janitor at TTL 0 left them alone.

**Imported libraries** are per-user and unbounded in number, so those are the
ones that are lazy and evictable. `/api/importUserLibrary` validates the SBOL and
then releases it, keeping only the disk copy; `create_feature_library()` parses
on first FlashText use.

The distinction matters because `FEATURE_LIBRARIES` is consulted **only** by the
FlashText path — BWA, Minimap2 and BLASTN all go through
`library_cache.get_feature_library_for_subset()`. Holding every user's imported
library there permanently paid ~20× its XML in RAM for a path most requests never
take.

`/api/checkLibraryCache` was changed to ask the disk cache rather than the dict,
since an imported library is legitimately absent from the dict until FlashText
needs it.

Real sizing still wants load data.

## Configuration reference

Everything tunable, in one place. All are read at import time, so a change needs
a server restart.

| Variable | Default | Bounds | Cost per entry |
|---|---|---|---|
| `SEQIMPROVE_MAX_INDEXES` | 150 | alignment indexes on disk | 0.6–1.2 MB |
| `SEQIMPROVE_MAX_REMOTE_FILES` | 200 | downloaded SynBioHub XML on disk | the file |
| `SEQIMPROVE_MAX_CACHED_PUBLIC` | 16 | parsed **public** libraries in RAM | **~15–20× the XML** |
| `SEQIMPROVE_MAX_CACHED_PRIVATE` | 32 | parsed **private** libraries in RAM | **~15–20× the XML** |
| `SEQIMPROVE_MAX_CACHED_PER_USER` | 8 | one account's share of the private pool | — |
| `SEQIMPROVE_MAX_CACHED_SUBSETS` | 12 | merged libraries in RAM | ~0 (see below) |
| `SEQIMPROVE_MAX_REMOTE_LIBRARIES` | 32 | FlashText dict entries | ~0 (references) |
| `SEQIMPROVE_CACHE_TTL_HOURS` | 72 | how long an unused download or index survives | — |
| `SEQIMPROVE_JANITOR_INTERVAL_MINUTES` | 60 | how often the sweep runs | — |
| `SEQIMPROVE_REMOTE_FRESHNESS_MINUTES` | 5 | how long a cached copy is reused before re-checking SynBioHub | one request |
| `SEQIMPROVE_PRUNE_PUBLIC` | 0 | set to 1 to age out public downloads too | — |
| `SEQIMPROVE_THREADS` | 8 | waitress worker threads — concurrent requests (see F) | memory of one annotation |

Only the two `MAX_CACHED_PUBLIC`/`MAX_CACHED_PRIVATE` pools are real memory
levers: a `FeatureLibrary` is a thin index over Documents it does not own, so the
merged-subset and FlashText caps bound dictionaries rather than RAM.

### The merged-library cache needs no pool of its own

`_subset_feature_libraries` is keyed by the *set of library paths*, and those
paths are already partitioned, so two users naming the same private collection
get different paths and therefore different entries. Isolation falls out of the
layout rather than being enforced again:

```
['remote/u/u_alice/bbd960d3.xml']                      Alice, private
['remote/u/u_bob/bbd960d3.xml']                        Bob, same URL, separate
['remote/1cb29c22.xml']                                public, one entry for everyone
['remote/1cb29c22.xml', 'u_alice/bbd960d3.xml']        Alice: public + her own
['remote/1cb29c22.xml', 'u_bob/bbd960d3.xml']          Bob:   public + his own
```

It also costs essentially nothing (a merged 4-library subset measured +0.0 MB),
so it is left as a single LRU.

Worth knowing that this isolation is *derived*: if `_remote_cache_path` ever
stopped partitioning, this cache would silently start serving one user's private
parts to another. There is a regression test pinning it for that reason.

### Two pools, not one queue

A single LRU over every cached library let public and private compete on equal
terms, and public always lost. Measured with three public libraries loaded and
four users importing three private ones each:

```
public libraries still in memory: 0/3
```

That is the wrong trade twice over. A public library is shared, so evicting it is
paid back by *every* user who needs it, not just whoever caused the eviction —
while a private library matters to exactly one person. And nothing stopped a
single busy account from filling the whole cache and flushing everyone else's.

So there are now two pools, and the private one carries a per-account quota:

| Pool | Bound | Protects against |
|---|---|---|
| public | `MAX_CACHED_PUBLIC` | private imports evicting shared libraries |
| private | `MAX_CACHED_PRIVATE` | private libraries as a whole outgrowing RAM |
| per account | `MAX_CACHED_PER_USER` | one account flushing another's |

Pool membership is read back off the cache path — private downloads live under
`remote/u/<principal>/` — rather than threaded through every call for a fact the
layout already records. Shipped libraries are in neither pool.

Same scenario after the split, with caps squeezed to 4/12/3:

```
public libraries still in memory: 3/3
private slots held: {user0: 3, user1: 3, user2: 3, user3: 3}
```

Every account keeps its own share, and a busy one trims itself rather than its
neighbours. `SEQIMPROVE_MAX_CACHED_LIBRARIES`, the single ceiling this replaced,
is gone rather than left as a variable that silently does nothing.

### The eviction policy is LRU — recency, not frequency

Least **Recently** Used, not least *frequently* used (that would be LFU). Only
"how long since this was last touched" matters; a use count is never kept. A
library used a hundred times yesterday is evicted before one used once an hour
ago:

```
A touched 100×, long ago;  B, C, D touched once each, just now;  cap 3
kept: ['B', 'C', 'D']      A evicted
```

That is the right shape here — what matters is whose session is active now, not
who was busy last week — but it does mean a popular library goes cold like any
other once nobody is using it. Re-reading it from disk is the only cost.

## Needs a decision

### ~~A. The imported-library list was lost on every reload~~ — now remembered per browser

The list of imported SynBioHub libraries lived only in the zustand store, in
memory, so it was gone not just on another device but on every page reload.

The frontend now keeps each imported library's URL and label in `localStorage`
(`seqimprove.importedLibraries`, the 10 most recent) and, on load, lists again
those the server still has cached **for this user** — asked through
`/api/checkLibraryCache`, which is scoped by principal (fix 11). Deleting a
library removes it from the saved list too.

- *Not cached* (the janitor evicted it, or the user has not logged in yet, so a
  private library is not found under them): it is shown greyed out with a
  **Re-import** button, so getting it back is one click instead of finding it in
  the SynBioHub dialog again, and the check runs again after a login. It is
  **not** re-imported in the background — a large collection can take minutes,
  and nobody asked for it. The entry is not dropped on a failed check either,
  because "not cached" can simply mean "not logged in", or a `t_` principal
  from a failed `/profile` lookup.
- *Shared browser*: another user sees a saved library only if the server has it
  cached for them. A private one never appears for anyone but its owner; a
  public one can, which is harmless. Only URLs and labels are stored.
- *Still per browser*: a different device starts empty. Making the list follow
  the user would mean storing it server-side per principal, which runs straight
  into G.

### ~~B. Should a private library ever be shareable?~~ — decided: no

**Decided: private libraries are never shared.** The partition implemented in
fix 10 is the final behaviour, not a placeholder. No ACL, no grant storage, no
sharing UI.

One consequence to accept knowingly: two users who both legitimately have access
to the same private collection each get their own cached copy and their own
alignment index. That is the correct outcome of "never shared" and the cost is
bounded by the caps below — deduplicating it would require keying private
content by `(content hash, set of principals who proved access)`, which
re-introduces exactly the cross-tenant coupling this decision rules out.

### ~~C. `/api/cache/clear` was global and unauthenticated~~ — removed

`deleteUserLibrary` and `checkLibraryCache` are scoped by principal (fix 11), but
`/api/cache/clear` bypassed all of that: any unauthenticated POST wiped every
index for every user. Nothing was lost — indexes are derived data — but everyone
online then waited for a rebuild, which made it a very cheap denial of service.

Nothing in the frontend called it, and the janitor reclaims indexes on its own,
so the endpoint is gone rather than gated. `IndexManager.clear_cache()` stays as
a maintenance helper; it is simply no longer reachable over HTTP.

`/api/cache/stats` is also unauthenticated. It exposes the server's cache path,
the index count and access timestamps — index keys are hashes and library names
never appear, so no tenant data leaks, but it is still more than an anonymous
caller needs.

### ~~D. Capacity limits~~ — sized, and now configurable

Both caps were originally picked without data. Current values are in the
[configuration reference](#configuration-reference); what informed them:

- **Nearly all the memory is the parsed `sbol2.Document`**, at ~15–20× the XML
  size. A `FeatureLibrary` is a thin index over Documents it does not own
  (+0.1 MB for four), so the subset and FlashText caps bound dictionaries, not
  RAM. The two `MAX_CACHED_PUBLIC`/`MAX_CACHED_PRIVATE` pools are the real lever.
- **Index cap raised 10 → 150** (~150 MB disk worst case). Indexes are cheap and
  rebuildable, and partitioning private libraries per user multiplies the number
  of distinct index keys, so the cap has to be generous or the LRU thrashes.

Accounting for this turned up two further unbounded caches, both made worse by
partitioning:

*Disk.* `<cache>/remote/` had no cap at all — one XML per (user, private
library), kept forever. Now bounded by `SEQIMPROVE_MAX_REMOTE_FILES`. Files still
loaded in memory are skipped: deleting one out from under a live Document would
leave the cache pointing at a missing path. A pruned file is re-fetched on next
use, so this costs a download, not data.

*Memory.* The four in-memory dicts were documented as *"loaded once at startup,
never evicted"* — true when the only libraries were the ten shipped in `assets/`,
but with per-user partitioning every (user, library) pair joined them
permanently. All are now LRU-bounded; eviction drops only the parsed forms, never
the file on disk.

There was also a duplicate: `create_feature_library()` used to `readString` its
own private copy of a remote library, so a collection used by both FlashText and
an aligner was held twice (+16.4 MB for a 1.3 MB collection). It now goes through
`LibraryCache`, sharing the Document and inheriting the same LRU, TTL and update
detection as everything else.

### ~~E. Prokka was a global singleton~~ — each run now has its own directory

`ProkkaAligner` wrote to fixed paths (`./database_protein.fasta`,
`./PROKKA_SYNBICT/`) in the working directory, so `_prokka_lock` had to
serialise every run, and one user's Prokka job blocked everyone else's.

SYNBICT's `ProkkaAligner` now takes `output_dir` and `database_path` (defaults
unchanged, so SYNBICT's own CLI is unaffected). `_run_prokka` stages the protein
database and Prokka's output in a `TemporaryDirectory` per call, so runs proceed
in parallel. Against a SYNBICT without those parameters — detected from the
constructor's signature — it falls back to the old fixed paths under the lock.

Checked with Prokka 1.14.6: the Test_Part sequence and its reverse complement,
run in two threads at once, each produced its own GFF at the right length and
its own BLAST output, and nothing was written to the working directory.

**Needs a SYNBICT push.** The Docker image clones `SYNBICT2`, so until that
change is pushed a rebuilt image still takes the serialised path.

### ~~F. The server ran 4 threads~~ — now configurable

The entry point that matters is the Dockerfile's `waitress-serve --call
app:create_app`, not the `serve(...)` call under `__main__`; both left waitress
at its default of 4 threads. That is the ceiling on concurrent requests, and a
Prokka run or an index build holds its thread for minutes.

Both now read `SEQIMPROVE_THREADS`, default 8. More threads mostly wait on
subprocesses, so they are cheap in CPU, but each annotation holds parsed
Documents in memory — raise it together with the container's memory.

### G. All state is per-process, so this does not scale horizontally

Every cache here is in-process memory plus a local disk directory. Run two
replicas behind a load balancer and user A's library update on replica 1 is
invisible to replica 2 — which breaks requirement 4 as soon as the service is
scaled out. Shared state would have to move to something external (a shared
volume plus a real cache-invalidation signal, or a database).

---

## What has not been verified

None of this has been exercised against a running server with real concurrent
users. Every fix has a regression test in `apps/server/tests/`, but those are
unit-level; `apps/server/tests/MANUAL_CHECKS.md` lists the live checks that need
a running server and two real SynBioHub accounts.
