# Multi-user readiness — investigation

Scope: what breaks if many people use SeqImprove at the same time, sharing the
same part libraries, the same alignment indexes and the same tools, where each
person can also update their own private SynBioHub libraries and must be
guaranteed to see their update on the next run.

Branch: `multi_users`. Everything under "Fixed" is committed on this branch and
has a reproduction test in the log below. Everything under "Needs a decision" is
untouched — those need a product/architecture call before code.

---

## The one-sentence summary

**The server has no concept of a user.** `grep` for a session, a user id, or a
principal anywhere in `apps/server/` returns exactly one hit: the SynBioHub token
that `/api/importUserLibrary` uses for a single outbound fetch and then throws
away. Every cache, every index and every library list is one global object shared
by everyone. Requirements 1–3 (concurrent use) are now mostly safe; requirements
4–5 (per-user private libraries with an update guarantee) cannot be finished
without introducing an identity, which is the main open decision.

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

## Needs a decision

### A. There is no user identity — this blocks everything below

Nothing distinguishes one caller from another. Adding per-user behaviour needs a
principal first. The natural candidate is the SynBioHub session the user already
has, resolved to a stable id (SynBioHub's `/profile` with `X-authorization`
returns the username). Hashing the raw token is *not* equivalent: tokens rotate
per login, so the same person would get a different cache partition each session
— safe, but it discards all reuse.

Complication: a user can log into **different SynBioHub instances**
(`synBioHubUrlPrefix` is stored per session), so the identity is really
`(instance, username)`, not a bare username.

Also note the frontend keeps the imported-library list only in the browser
(`importedLibraries` in the zustand store). Even with server-side identity, a
user switching browser or device loses their list unless it is persisted server
side.

### B. Private library content is served to other users — the central hole

Remote libraries are cached at `remote/<sha256(url)>.xml`, keyed by URL alone.
User A imports a private collection with A's token; the content lands in that
shared file. User B selects the same URL and `resolve_library_paths` hands them
A's content **with no authorization check at all**. B never needed a token.

Fixing this means partitioning the remote cache by principal. But note the
tension with efficiency, which is worth deciding deliberately:

- **Public libraries should stay shared.** Two users annotating against the same
  public collection should reuse one cached file and, more importantly, one
  alignment index. Partitioning everything by user multiplies index builds and
  disk by the number of users.
- **Private libraries must not be shared.**

So the cache key needs to depend on whether a collection is public. There is a
cheap, reliable test for that: **fetch the URL anonymously — `200` means public,
`401` means private.** I verified this behaves as expected against the real
service (a private collection and its members all return `401` without a token).
A public library can then keep the current shared, content-addressed path, and a
private one goes to `remote/<principal>/<hash>.xml`.

Open question for you: should a private library imported by A ever be visible to
B if A wants to share it? If yes this becomes an ACL, not a partition.

### C. Any user can delete any user's library

`/api/deleteUserLibrary` takes a URL and deletes it from the global dict with no
ownership check; `/api/cache/clear` wipes everything for everyone. With
partitioning (B) these become per-principal operations; until then, deleting is
a cross-tenant action. Consider whether `deleteUserLibrary` should even touch
server state, or only the caller's own browser list.

### D. `/api/checkLibraryCache` is an existence oracle

It answers "is this URL cached?" for any URL, unauthenticated — letting anyone
probe which private collections other users have imported. Should be scoped to
the caller's own partition.

### E. Prokka is a global singleton

`ProkkaAligner` uses hardcoded paths (`./database_protein.fasta`,
`./PROKKA_SYNBICT/`) in the process working directory, so concurrent runs would
overwrite each other. `_prokka_lock` serialises them, which is correct but means
**one user's Prokka run blocks every other user's** for its full duration — and
Prokka is the slowest thing in the pipeline. Fixing it properly means running
each invocation in its own temp directory, which is a change to SYNBICT's
`ProkkaAligner`, not to SeqImprove.

### F. Index builds hold the global lock

`create_index` holds `self._lock` across `extractor.build_index()`, which shells
out to `makeblastdb`/`bwa index`. Since `IndexManager` now shares
`LibraryCache`'s lock, **every cache operation server-wide blocks for the entire
duration of an index build** — including other users' hash lookups and document
reads. (This was true before my change too, just against a second lock that
didn't protect anything.) The fix is a per-index-key build lock so unrelated work
proceeds, but that needs care: it reintroduces the possibility of two threads
building different indexes while a third evicts.

### G. Index capacity is 10, globally

`DEFAULT_MAX_INDEXES = 10`, shared by all users. With N users × M library
combinations the LRU will thrash and indexes will be rebuilt constantly. Needs
sizing against expected concurrency, or a per-principal quota.

### H. The server runs 4 threads

`serve(app, host="0.0.0.0", port=8080)` — waitress defaults to `threads=4`. That
is the hard ceiling on concurrent annotations regardless of anything else, and
long jobs (Prokka, index builds) occupy a thread for minutes.

### I. All state is per-process, so this does not scale horizontally

Every cache here is in-process memory plus a local disk directory. Run two
replicas behind a load balancer and user A's library update on replica 1 is
invisible to replica 2 — which breaks requirement 4 as soon as the service is
scaled out. Shared state would have to move to something external (a shared
volume plus a real cache-invalidation signal, or a database).

### J. `FEATURE_LIBRARIES` grows without bound

Nothing ever evicts it except an explicit delete. Every library every user has
ever imported stays in memory for the life of the process. With many users this
is a slow leak; the on-disk index cache has an LRU, this does not.

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

Not verified: none of this has been exercised against a running server with real
concurrent users. The fixes are unit-level and reasoned; a load test with several
simultaneous annotations is the obvious next step.
