# Live checks — what to upload to SynBioHub, and what to look for

`test_multi_user.py` covers everything testable offline (22 cases). These are the
ones that need a running server, a real SynBioHub, and **two accounts** — they
cannot be faked, because what is being tested is precisely that two different
principals stay apart.

Target sequence for every run: **`test_part.fasta`** (Test_Part, 2301 bp). Every
part in the collections below is a real slice of it, so a correct run must
actually find them.

## Upload these four collections

Generated in `upload/`. On SynBioHub: **Submit → New Collection**, upload the
file, and set visibility as shown.

**These files contain only parts — no `<sbol:Collection>` object, deliberately.**
SynBioHub builds the collection itself from the submission form and adds the
file's top-level objects to it. A file that carries its own Collection makes the
parts members of *that* one, and the collection SynBioHub creates comes back
empty — which then fails annotation with "No DNA sequences could be extracted".

After uploading, confirm on SynBioHub that the collection actually lists its
parts before moving on. An empty collection there means the upload went wrong,
not SeqImprove.

| File | Upload as | Owner | Parts |
|---|---|---|---|
| `A_public_v1.xml` | **Public** | account 1 | TP_promoter, TP_rbs, TP_terminator |
| `B_private_v1.xml` | **Private** | account 1 | TP_promoter, TP_cds |
| `B_private_v2.xml` | *(later — same collection as B)* | account 1 | + **TP_origin** |
| `C_private_other_v1.xml` | **Private** | **account 2** | TP_terminator, TP_origin |

`B_private_v2.xml` is deliberately `B_private_v1` **plus one part**. That extra
part, `TP_origin`, is the signal the whole update test turns on: if it appears,
the update propagated; if it does not, something is still serving a cached copy.

You need a second SynBioHub account for `C`. Without one, checks 4 and 5 cannot
be performed at all — do not substitute "log out and back in", which produces a
new token for the *same* principal and proves nothing.

---

## 1. An update reaches the user without a re-import  — *the core requirement*

1. Account 1, SeqImprove: upload `test_part.fasta`, import collection **B**, annotate.
   → expect `TP_promoter` and `TP_cds`. Note the count.
2. On SynBioHub, update collection **B** with `B_private_v2.xml` (add `TP_origin`).
3. Back in SeqImprove **without re-importing**, wait past the freshness window
   (default 5 min, `SEQIMPROVE_REMOTE_FRESHNESS_MINUTES`) and annotate again.

**Expect** `TP_origin` in the results. Server log should show:

```
Remote library changed upstream, refreshed: https://.../B.../1
Library changed on disk, reloading: .../remote/u/u_xxxx/....xml
```

**If `TP_origin` is missing**, check the log for `Freshness check ... returned
HTTP 401` — that means the token is not reaching the server, not that caching is
broken.

**If the import fails with "came back with no parts in it"**: SynBioHub serves a
collection's bare URI as just the Collection object — no members, no parts. The
server retries the recursive `<uri>/sbol` endpoint automatically and logs
`returned a collection with no parts; retrying the recursive /sbol endpoint`. If
even that has no parts, the collection genuinely holds nothing you can read.

Also worth doing: annotate again **immediately** after step 2, inside the window.
The old result is the correct answer there; that is the staleness bound, not a bug.

## 2. Re-importing updates immediately

Same as check 1, but click **Import** on collection B after updating it. The new
part must appear on the very next annotation, with no waiting.

## 3. A public collection is shared, not duplicated

1. Account 1: import collection **A**, annotate.
2. Account 2: import collection **A**, annotate.

On the server:

```bash
ls .cache/seqimprove/remote/*.xml          # A appears ONCE here
ls -R .cache/seqimprove/remote/u/          # A must NOT appear under any principal
```

Both users' runs should also reuse one index — a second `Created index:` line for
the same libraries means sharing is not engaging.

## 4. Private collections stay apart  — *needs both accounts*

1. Account 1 imports **B**; account 2 imports **C**.
2. Each annotates `test_part.fasta`.

**Expect** account 1 sees `TP_cds` and never `TP_origin`-from-C; account 2 sees
C's parts and never B's. On disk:

```bash
ls -R .cache/seqimprove/remote/u/          # two principal directories, one file each
```

Then the important negative test: **account 2 pastes account 1's collection B
URL** into Import. It must fail with a SynBioHub authorization error — *not*
succeed by picking up account 1's cached copy. That was the original hole.

## 5. One user cannot delete another's library  — *needs both accounts*

With both B and C imported, account 2 calls delete on **B's** URL (paste it into
the library list and remove it). Account 1's next annotation must still find B's
parts, and B's file must still be on disk under account 1's principal directory.

## 6. Cleanup removes a library and its index together

```bash
# shrink the window so you don't wait three days
SEQIMPROVE_CACHE_TTL_HOURS=1 SEQIMPROVE_JANITOR_INTERVAL_MINUTES=1  # restart server
```

Import B, annotate, then leave it alone for over an hour.

**Expect** in the log: `Cache janitor removed 1 private library and 1 index(es)`.
The public collection A must still be there. Annotating again must work — it
re-downloads and rebuilds rather than erroring.

## 7. Concurrent use

Two browsers, two accounts, both annotate `test_part.fasta` at the same time
against different libraries.

**Expect** both complete; no `FileNotFoundError`, no `CalledProcessError`, and
`cache_metadata.json` still parses afterwards:

```bash
python -c "import json;json.load(open('.cache/seqimprove/cache_metadata.json'));print('ok')"
```

## 8. The server is loading the SYNBICT you think it is

At startup:

```
SYNBICT loaded from: /SYNBICT/sequences_to_features/__init__.py
TableFeatureMapper.extract_matches(self, min_feature_length=40, exact_match=True,
    pid_threshold=95.0, overlap_frac=0.5, apply_nms=False, target_length=None)
```

If `pid_threshold` is absent, the container is running an older SYNBICT and
several of the checks above will behave oddly for reasons unrelated to caching.

---

## Not covered by any of this

- Behaviour under real load (many simultaneous users) — needs a load test.
- Horizontal scaling: every cache here is per-process, so with two replicas an
  update on one is invisible to the other. Check 1 will pass on a single instance
  and fail behind a load balancer.
