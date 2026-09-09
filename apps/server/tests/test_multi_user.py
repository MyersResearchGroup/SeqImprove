#!/usr/bin/env python
"""
Multi-user regression suite for the SeqImprove server caches.

Covers everything that can be checked without a live SynBioHub or a second real
account: cache invalidation, tenancy partitioning, identity, concurrency,
capacity and cleanup. SynBioHub is stubbed, so this runs offline and fast.

The cases that genuinely need a live server and two accounts are in
MANUAL_CHECKS.md; this file deliberately does not pretend to cover them.

Run:  python test_multi_user.py            (all)
      python test_multi_user.py update     (only names containing "update")
"""

import json
import os
import shutil
import sys
import tempfile
import threading
import time
import traceback
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sbol2
sbol2.setHomespace("https://seqimprove.org")
sbol2.Config.setOption("validate", False)
sbol2.Config.setOption("sbol_typed_uris", False)

import conftest_helpers as H
import identity
import library_cache as LC

PUBLIC_URL = "https://synbiohub.org/public/TestCollection/TestCollection_collection/1"
ALICE_URL = "https://synbiohub.org/user/alice/Secret/Secret_collection/1"
BOB_URL = "https://synbiohub.org/user/bob/Secret/Secret_collection/1"


class Workspace:
    """A throwaway cache directory with its own LibraryCache/IndexManager."""

    def __init__(self, max_indexes=20):
        self.dir = tempfile.mkdtemp(prefix="seqimprove_test_")
        self.assets = os.path.join(self.dir, "assets")
        os.makedirs(self.assets, exist_ok=True)
        self.cache, self.index = LC.init_cache(
            cache_dir=os.path.join(self.dir, ".cache"), max_indexes=max_indexes)

    def local_library(self, name, parts):
        path = os.path.join(self.assets, name + ".xml")
        H.write_library(path, parts)
        return path

    def loose_library(self, name, parts):
        path = os.path.join(self.dir, name + ".xml")
        H.write_library(path, parts)
        return path

    def forget_in_memory(self, path):
        """Drop the parsed forms, as an LRU eviction or a restart would."""
        p = os.path.abspath(path)
        for store in (self.cache._documents, self.cache._xml_strings,
                      self.cache._feature_libraries):
            store.pop(p, None)
        self.cache._library_lru.pop(p, None)

    def close(self):
        shutil.rmtree(self.dir, ignore_errors=True)


def stub_synbiohub(body_holder):
    """Replace library_cache's requests module with a fake SynBioHub.

    body_holder is a dict with 'body' (what the server returns) and 'calls'
    (a counter), so a test can change the upstream content mid-run.
    """
    import requests as real_requests

    class Response:
        def __init__(self, text, status=200):
            self.text = text
            self.status_code = status

        def close(self):
            pass

    def get(url, headers=None, timeout=None, **kw):
        body_holder["calls"] += 1
        if body_holder.get("fail"):
            raise real_requests.exceptions.ConnectionError("stubbed outage")
        return Response(body_holder["body"], body_holder.get("status", 200))

    LC.requests = types.SimpleNamespace(get=get, exceptions=real_requests.exceptions)
    return body_holder


# ---------------------------------------------------------------- req 4:更新

def test_update_local_library_is_seen():
    """A library edited on disk must be reflected in the next annotation."""
    ws = Workspace()
    try:
        lib = ws.loose_library("lib", {"promoter": H.PARTS["promoter_region"]})
        before = H.part_names(ws.cache.get_feature_library_for_subset([lib]))
        H.write_library(lib, {"promoter": H.PARTS["promoter_region"],
                              "cds": H.PARTS["cds_region"]})
        after = H.part_names(ws.cache.get_feature_library_for_subset([lib]))
        assert before == ["promoter"], before
        assert after == ["cds", "promoter"], after
    finally:
        ws.close()


def test_update_of_equal_length_is_seen():
    """A same-length edit must invalidate too.

    The old hash shortcut reused the cached hash whenever the file size was
    unchanged, so an edit that kept the length was invisible.
    """
    ws = Workspace()
    try:
        seq = H.PARTS["promoter_region"]
        lib = ws.loose_library("lib", {"partA": seq})
        first = ws.cache.get_library_hash(lib)
        # same part name and same sequence length, different bases
        H.write_library(lib, {"partA": seq[:-4] + "tttt"})
        second = ws.cache.get_library_hash(lib)
        assert first != second, "equal-length edit went undetected"
    finally:
        ws.close()


def test_update_refreshes_document_and_subset():
    """Every layer must refresh, not just the hash.

    get_document/get_feature_library used to compare the freshly computed hash
    against the metadata entry that computing it had just overwritten, so the
    check could never fail.
    """
    ws = Workspace()
    try:
        lib = ws.loose_library("lib", {"promoter": H.PARTS["promoter_region"]})
        ws.cache.get_document(lib)
        ws.cache.get_feature_library(lib)
        ws.cache.get_feature_library_for_subset([lib])

        H.write_library(lib, {"promoter": H.PARTS["promoter_region"],
                              "term": H.PARTS["terminator_region"]})

        assert "term" in H.part_names(ws.cache.get_feature_library(lib))
        assert "term" in H.part_names(ws.cache.get_feature_library_for_subset([lib]))
    finally:
        ws.close()


def test_update_changes_the_index_key():
    """A changed library must invalidate the index built from it."""
    ws = Workspace()
    try:
        lib = ws.loose_library("lib", {"promoter": H.PARTS["promoter_region"]})
        before = ws.index._compute_index_key("blastn", [lib])
        H.write_library(lib, {"promoter": H.PARTS["promoter_region"],
                              "cds": H.PARTS["cds_region"]})
        after = ws.index._compute_index_key("blastn", [lib])
        assert before != after, "index would have been reused for changed libraries"
    finally:
        ws.close()


def test_update_from_synbiohub_without_reimport():
    """An upstream change is picked up without the user re-importing."""
    ws = Workspace()
    holder = stub_synbiohub({"body": H.library_text({"v1": H.PARTS["promoter_region"]}),
                             "calls": 0})
    try:
        path = ws.cache.cache_remote_library_content(
            ALICE_URL, holder["body"], principal="u_alice")
        assert H.part_names(ws.cache.get_feature_library_for_subset([path])) == ["v1"]

        # the user edits the collection on SynBioHub
        holder["body"] = H.library_text({"v1": H.PARTS["promoter_region"],
                                         "v2_new": H.PARTS["terminator_region"]})

        # inside the freshness window: still the old copy, by design
        ws.cache.materialize_remote_library(ALICE_URL, principal="u_alice")
        assert "v2_new" not in H.part_names(
            ws.cache.get_feature_library_for_subset([path]))

        # window expires -> synchronised on next use, no re-import
        ws.cache._remote_checked[os.path.abspath(path)] = 0
        ws.cache.materialize_remote_library(ALICE_URL, principal="u_alice")
        assert "v2_new" in H.part_names(
            ws.cache.get_feature_library_for_subset([path]))
    finally:
        ws.close()


def test_update_check_is_rate_limited():
    """Repeated use inside the window must not hammer SynBioHub."""
    ws = Workspace()
    holder = stub_synbiohub({"body": H.library_text({"v1": H.PARTS["promoter_region"]}),
                             "calls": 0})
    try:
        ws.cache.cache_remote_library_content(ALICE_URL, holder["body"],
                                              principal="u_alice")
        holder["calls"] = 0
        for _ in range(10):
            ws.cache.materialize_remote_library(ALICE_URL, principal="u_alice")
        assert holder["calls"] == 0, f"{holder['calls']} requests inside the window"
    finally:
        ws.close()


def test_update_survives_synbiohub_outage():
    """If SynBioHub is down the cached copy must still be usable."""
    ws = Workspace()
    holder = stub_synbiohub({"body": H.library_text({"v1": H.PARTS["promoter_region"]}),
                             "calls": 0})
    try:
        path = ws.cache.cache_remote_library_content(ALICE_URL, holder["body"],
                                                     principal="u_alice")
        holder["fail"] = True
        ws.cache._remote_checked[os.path.abspath(path)] = 0
        result = ws.cache.materialize_remote_library(ALICE_URL, principal="u_alice")
        assert result is not None
        assert H.part_names(ws.cache.get_feature_library_for_subset([path])) == ["v1"]
    finally:
        ws.close()


# ------------------------------------------------- req 5:租户隔离与身份

def test_tenancy_private_library_is_isolated():
    """Two users' copies of the same private URL must not be shared."""
    ws = Workspace()
    holder = stub_synbiohub({"body": "", "calls": 0})
    try:
        alice = ws.cache.cache_remote_library_content(
            ALICE_URL, H.library_text({"alice_only": H.PARTS["promoter_region"]}),
            principal="u_alice")
        bob = ws.cache.cache_remote_library_content(
            ALICE_URL, H.library_text({"bob_only": H.PARTS["terminator_region"]}),
            principal="u_bob")
        assert alice != bob, "same file served to both users"
        assert H.part_names(ws.cache.get_feature_library_for_subset([alice])) == ["alice_only"]
        assert H.part_names(ws.cache.get_feature_library_for_subset([bob])) == ["bob_only"]
    finally:
        ws.close()


def test_tenancy_public_library_is_shared():
    """A public collection must resolve to one file and one index for everyone."""
    ws = Workspace()
    try:
        a = ws.cache._remote_cache_path(PUBLIC_URL, "u_alice")[1]
        b = ws.cache._remote_cache_path(PUBLIC_URL, "u_bob")[1]
        assert a == b, "public collection was partitioned per user"
        ka = ws.index._compute_index_key("blastn", [str(a)]) if a.exists() else None
        ws.cache.cache_remote_library_content(
            PUBLIC_URL, H.library_text({"shared": H.PARTS["promoter_region"]}),
            principal="u_alice")
        ka = ws.index._compute_index_key("blastn", [str(a)])
        kb = ws.index._compute_index_key("blastn", [str(b)])
        assert ka == kb, "public collection produced two different indexes"
    finally:
        ws.close()


def test_tenancy_visibility_from_url_namespace():
    """/public/ is shareable, /user/ is not -- on every SynBioHub instance."""
    public = [
        "https://synbiohub.org/public/igem/igem_collection/1",
        "https://api.synbiohub.org/public/Cello_Parts/Cello_Parts_collection/1",
        "https://synbiohub.programmingbiology.org/public/Cello_Parts/LacI/1",
        "https://synbioks.org/public/CIDAR_MoClo_Toolkit_Densmore_Lab/I13453/1",
    ]
    private = [
        "https://synbiohub.org/user/sophia2014cs/MD5_backbone/MD5_backbone_collection/1",
        "https://synbiohub.org/user/ashu6280/MD5Collection/attP7/1",
    ]
    for url in public:
        assert identity.is_public(url), url
    for url in private:
        assert not identity.is_public(url), url


def test_identity_prefers_immutable_id():
    """The principal must come from the account id, never the display name."""
    profile = {"id": 1188, "name": "Chunxiao Liao", "username": "sophia2014cs",
               "email": "x@y.z", "graphUri": "https://synbiohub.org/user/sophia2014cs"}

    def pick(payload):
        for field in identity._IDENTITY_FIELDS:
            value = payload.get(field)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return f"{field}:{value}"
            if isinstance(value, str) and value.strip():
                return f"{field}:{value.strip()}"
        return None

    assert pick(profile) == "id:1188"
    assert "name" not in identity._IDENTITY_FIELDS, "display name must not identify"
    # two accounts sharing a display name must not collide
    assert pick({"id": 1, "name": "Zhang Wei"}) != pick({"id": 2, "name": "Zhang Wei"})


def test_identity_anonymous_has_no_principal():
    assert identity.resolve_principal(None) is None
    assert identity.resolve_principal("") is None


def test_tenancy_partition_path_is_filesystem_safe():
    """A principal is used as a directory name, so it must stay one segment."""
    identity._visibility_cache.clear()
    partition, shared = identity.partition_for(ALICE_URL, "u:a/b\\c")
    assert not shared
    assert "/" not in partition and "\\" not in partition and ":" not in partition


# ------------------------------------------- req 1-3:并发、容量与清理

def test_concurrency_distinct_indexes_build_in_parallel():
    """Different indexes must not queue behind each other."""
    ws = Workspace(max_indexes=50)
    original = LC.FeatureExtractor

    class SlowExtractor:
        def __init__(self, docs):
            pass

        def write_fasta(self, path):
            open(path, "w").write(">x\nACGT\n")

        def build_index(self, fasta, prefix, tool):
            time.sleep(0.4)
            for ext in LC.IndexManager.INDEX_FILES.get("blast", [".nhr"]):
                open(prefix + ext, "w").write("idx")

    LC.FeatureExtractor = SlowExtractor
    ws.cache.get_documents_for_libraries = lambda paths: [None]
    try:
        libs = [ws.loose_library(f"l{i}", {f"p{i}": H.PARTS["promoter_region"]})
                for i in range(4)]
        errors = []

        def build(subset):
            try:
                ws.index.get_or_create_index("blastn", subset)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=build, args=([libs[i]],)) for i in range(4)]
        threads += [threading.Thread(target=build, args=(libs[:2],)) for _ in range(4)]
        start = time.time()
        [t.start() for t in threads]
        [t.join() for t in threads]
        elapsed = time.time() - start

        assert not errors, errors
        assert elapsed < 1.5, f"took {elapsed:.2f}s -- builds serialised"
        assert len(ws.index._metadata.indexes) == 5, ws.index._metadata.indexes
    finally:
        LC.FeatureExtractor = original
        ws.close()


def test_concurrency_pinned_index_is_not_evicted():
    """An index an aligner is reading must survive an eviction round."""
    ws = Workspace(max_indexes=1)
    try:
        lib = ws.loose_library("lib", {"p": H.PARTS["promoter_region"]})
        key = ws.index._compute_index_key("blastn", [lib])
        ws.index._access_order[key] = time.time()
        with ws.index.pin_index("blastn", [lib]):
            ws.index._evict_oldest()
            assert key in ws.index._access_order, "pinned index was evicted"
    finally:
        ws.close()


def test_concurrency_metadata_stays_valid():
    """Concurrent saves must never leave unreadable JSON."""
    ws = Workspace(max_indexes=5)
    try:
        libs = [ws.loose_library(f"l{i}", {f"p{i}": H.PARTS["promoter_region"]})
                for i in range(5)]
        errors = []

        def worker():
            try:
                for _ in range(25):
                    ws.cache.get_feature_library_for_subset(libs[:2])
                    ws.cache.get_library_hash(libs[0])
                    ws.cache._save_metadata()
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert not errors, errors
        with open(os.path.join(ws.dir, ".cache", "cache_metadata.json")) as f:
            json.load(f)
        leftovers = [f for f in os.listdir(os.path.join(ws.dir, ".cache"))
                     if f.endswith(".tmp")]
        assert not leftovers, leftovers
    finally:
        ws.close()


def test_concurrency_single_lock():
    """Both classes must guard the shared metadata with the same lock."""
    ws = Workspace()
    try:
        assert ws.cache._lock is ws.index._lock
    finally:
        ws.close()


def test_capacity_shipped_libraries_are_never_evicted():
    """assets/ libraries stay resident however many imports arrive."""
    ws = Workspace()
    original = LC.DEFAULT_MAX_CACHED_LIBRARIES
    LC.DEFAULT_MAX_CACHED_LIBRARIES = 3
    try:
        for i in range(3):
            ws.local_library(f"L{i}", {f"L{i}": H.PARTS["promoter_region"]})
        ws.cache.preload_libraries(ws.assets)
        shipped = list(ws.cache._library_name_map.values())

        for i in range(10):
            path = ws.loose_library(f"imported{i}", {f"i{i}": H.PARTS["terminator_region"]})
            ws.cache.get_feature_library(path)

        resident = [p for p in shipped
                    if p in ws.cache._documents and p in ws.cache._feature_libraries]
        assert len(resident) == len(shipped), f"{len(resident)}/{len(shipped)} survived"
        assert len(ws.cache._library_lru) <= 3, len(ws.cache._library_lru)
    finally:
        LC.DEFAULT_MAX_CACHED_LIBRARIES = original
        ws.close()


def test_cleanup_prunes_private_but_not_public():
    """The janitor must leave shared public downloads alone."""
    ws = Workspace()
    stub_synbiohub({"body": "", "calls": 0})
    try:
        pub = ws.cache.cache_remote_library_content(
            PUBLIC_URL, H.library_text({"pub": H.PARTS["promoter_region"]}),
            principal="u_alice")
        priv = ws.cache.cache_remote_library_content(
            ALICE_URL, H.library_text({"priv": H.PARTS["terminator_region"]}),
            principal="u_alice")
        stale = time.time() - 1000 * 3600
        for path in (pub, priv):
            ws.cache._metadata.libraries[os.path.abspath(path)].last_accessed = stale
            ws.forget_in_memory(path)
        ws.cache.prune_expired(ws.index, ttl_seconds=72 * 3600)
        assert os.path.exists(pub), "public download was pruned"
        assert not os.path.exists(priv), "private download survived the TTL"
    finally:
        ws.close()


def test_cleanup_removes_index_with_its_library():
    """An index must not outlive the library it was built from."""
    ws = Workspace()
    stub_synbiohub({"body": "", "calls": 0})
    try:
        path = ws.cache.cache_remote_library_content(
            ALICE_URL, H.library_text({"p": H.PARTS["promoter_region"]}),
            principal="u_alice")
        key = ws.index._compute_index_key("blastn", [path])
        index_dir = ws.index._get_index_dir(key)
        index_dir.mkdir(parents=True, exist_ok=True)
        for ext in LC.IndexManager.INDEX_FILES["blast"]:
            (index_dir / f"index{ext}").write_text("x")
        now = time.time()
        ws.index._metadata.indexes[key] = LC.IndexInfo(
            "blastn", [ws.cache.get_library_hash(path)], key,
            str(index_dir / "index"), str(index_dir / "library.fasta"), now, now, [path])
        ws.index._access_order[key] = now

        ws.cache._metadata.libraries[os.path.abspath(path)].last_accessed = now - 1000 * 3600
        ws.forget_in_memory(path)
        removed = ws.cache.prune_expired(ws.index, ttl_seconds=72 * 3600)

        assert not os.path.exists(path)
        assert not index_dir.exists(), "index outlived its library"
        assert removed["indexes"] >= 1, removed
    finally:
        ws.close()


def test_cleanup_missing_library_does_not_raise():
    """A stale index must degrade to 'invalid', not blow up a request."""
    ws = Workspace()
    stub_synbiohub({"body": "", "calls": 0})
    try:
        path = ws.cache.cache_remote_library_content(
            ALICE_URL, H.library_text({"p": H.PARTS["promoter_region"]}),
            principal="u_alice")
        key = ws.index._compute_index_key("blastn", [path])
        now = time.time()
        ws.index._metadata.indexes[key] = LC.IndexInfo(
            "blastn", ["stale"], key, "x", "y", now, now, [path])
        os.unlink(path)
        ws.forget_in_memory(path)
        ws.cache._hashes.pop(os.path.abspath(path), None)
        assert ws.index.has_index("blastn", [path]) is False
    finally:
        ws.close()


def test_cleanup_ages_by_use_not_by_download():
    """A library used today must survive even if downloaded long ago."""
    ws = Workspace()
    stub_synbiohub({"body": "", "calls": 0})
    try:
        path = ws.cache.cache_remote_library_content(
            ALICE_URL, H.library_text({"p": H.PARTS["promoter_region"]}),
            principal="u_alice")
        ws.cache._metadata.libraries[os.path.abspath(path)].last_accessed = time.time()
        old = time.time() - 1000 * 3600
        os.utime(path, (old, old))          # downloaded long ago
        ws.forget_in_memory(path)
        ws.cache.prune_expired(ws.index, ttl_seconds=72 * 3600)
        assert os.path.exists(path), "a library in daily use was pruned"
    finally:
        ws.close()




# ------------------------------- collection URI 只返回外壳时要退回 /sbol

COLLECTION_SHELL = """<?xml version="1.0" ?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sbol="http://sbols.org/v2#">
  <sbol:Collection rdf:about="%s"><sbol:displayId>c</sbol:displayId></sbol:Collection>
</rdf:RDF>""" % ALICE_URL


def test_fetch_falls_back_to_sbol_endpoint():
    """A collection URI returning only the Collection must trigger the /sbol retry.

    SynBioHub serves the bare URI as just that object -- no members, no parts --
    which produced an empty FASTA and an unreadable makeblastdb failure.
    """
    ws = Workspace()
    seen = []
    full = H.library_text({"TP_promoter": H.PARTS["promoter_region"]})

    import requests as real_requests

    class Response:
        def __init__(self, text):
            self.text, self.status_code = text, 200

    def get(url, headers=None, timeout=None, **kw):
        seen.append(url)
        return Response(full if url.rstrip("/").endswith("/sbol") else COLLECTION_SHELL)

    LC.requests = types.SimpleNamespace(get=get, exceptions=real_requests.exceptions)
    try:
        text, status = ws.cache._fetch_library_sbol(ALICE_URL, "tok")
        assert status == 200
        assert ws.cache._has_parts(text), "fell back but still got no parts"
        assert len(seen) == 2, seen
        assert seen[1].endswith("/sbol"), seen
    finally:
        ws.close()


def test_fetch_does_not_retry_when_parts_are_present():
    """A URL that already returns parts must not cost a second request."""
    ws = Workspace()
    seen = []
    full = H.library_text({"TP_promoter": H.PARTS["promoter_region"]})

    import requests as real_requests

    class Response:
        def __init__(self, text):
            self.text, self.status_code = text, 200

    def get(url, headers=None, timeout=None, **kw):
        seen.append(url)
        return Response(full)

    LC.requests = types.SimpleNamespace(get=get, exceptions=real_requests.exceptions)
    try:
        text, status = ws.cache._fetch_library_sbol(ALICE_URL, "tok")
        assert ws.cache._has_parts(text)
        assert len(seen) == 1, seen
    finally:
        ws.close()


def test_fetch_reports_a_shell_that_stays_empty():
    """If even /sbol has no parts, hand it back so the caller can say why."""
    ws = Workspace()
    import requests as real_requests

    class Response:
        def __init__(self, text):
            self.text, self.status_code = text, 200

    LC.requests = types.SimpleNamespace(
        get=lambda url, **kw: Response(COLLECTION_SHELL),
        exceptions=real_requests.exceptions)
    try:
        text, status = ws.cache._fetch_library_sbol(ALICE_URL, "tok")
        assert status == 200
        assert not ws.cache._has_parts(text)
    finally:
        ws.close()


# ------------------------------- 分区改造之前留下的共享缓存要迁移掉

def test_migration_removes_private_files_from_shared_area():
    """Private collections cached before partitioning must not linger.

    They landed in <cache>/remote/<hash>.xml regardless of owner. Nothing reads
    them there any more, and the janitor only scans remote/u/, so they would sit
    in the shared area forever holding private content.
    """
    ws = Workspace()
    stub_synbiohub({"body": "", "calls": 0})
    try:
        shared = ws.cache.cache_dir / "remote"
        shared.mkdir(parents=True, exist_ok=True)

        def legacy(name, uri, part):
            path = shared / name
            doc = sbol2.Document()
            cd = doc.componentDefinitions.create(part)
            cd.types = [sbol2.BIOPAX_DNA]
            seq = doc.sequences.create(part + "_seq")
            seq.elements = H.PARTS["promoter_region"]
            cd.sequences = [seq.identity]
            text = doc.writeString().replace(
                "<rdf:RDF", f'<!-- {uri} --><rdf:RDF', 1)
            # the URI the migration looks for is the first rdf:about
            text = text.replace("<sbol:ComponentDefinition rdf:about=\"",
                                f'<sbol:Collection rdf:about="{uri}"/>'
                                '<sbol:ComponentDefinition rdf:about="', 1)
            path.write_text(text)
            return path

        priv = legacy("aaaa.xml", ALICE_URL, "priv_part")
        pub = legacy("bbbb.xml", PUBLIC_URL, "pub_part")

        removed = ws.cache.migrate_shared_private_downloads()

        assert not priv.exists(), "private library left in the shared area"
        assert pub.exists(), "public library was removed"
        assert removed == 1, removed
    finally:
        ws.close()


def test_migration_is_idempotent():
    """Running it again on a clean cache must do nothing."""
    ws = Workspace()
    stub_synbiohub({"body": "", "calls": 0})
    try:
        assert ws.cache.migrate_shared_private_downloads() == 0
        assert ws.cache.migrate_shared_private_downloads() == 0
    finally:
        ws.close()


def test_update_retires_the_superseded_index():
    """Changing a library must retire the index built from its old content.

    The index key is a hash of the library content, so after an update the old
    key is never computed again -- the index becomes unreachable and would sit on
    disk until the LRU or the TTL got to it.
    """
    ws = Workspace(max_indexes=50)
    try:
        lib = ws.loose_library("lib", {"p1": H.PARTS["promoter_region"]})
        ws.cache.get_document(lib)

        key = ws.index._compute_index_key("blastn", [lib])
        index_dir = ws.index._get_index_dir(key)
        index_dir.mkdir(parents=True, exist_ok=True)
        for ext in LC.IndexManager.INDEX_FILES["blast"]:
            (index_dir / f"index{ext}").write_text("x")
        now = time.time()
        ws.index._metadata.indexes[key] = LC.IndexInfo(
            "blastn", [ws.cache.get_library_hash(lib)], key,
            str(index_dir / "index"), str(index_dir / "library.fasta"), now, now, [lib])
        ws.index._access_order[key] = now

        H.write_library(lib, {"p1": H.PARTS["promoter_region"],
                              "p2": H.PARTS["terminator_region"]})
        ws.cache.get_document(lib)          # detects the change

        assert not index_dir.exists(), "index built from the old content survived"
        assert key not in ws.index._metadata.indexes
    finally:
        ws.close()


def test_update_is_checked_for_public_libraries_too():
    """Public collections are re-checked upstream, not only private ones."""
    ws = Workspace()
    holder = stub_synbiohub({"body": H.library_text({"v1": H.PARTS["promoter_region"]}),
                             "calls": 0})
    try:
        path = ws.cache.cache_remote_library_content(
            PUBLIC_URL, holder["body"], principal="u_alice")
        assert "remote/u/" not in path.replace(os.sep, "/"), "public went to a partition"

        holder["body"] = H.library_text({"v1": H.PARTS["promoter_region"],
                                         "v2_new": H.PARTS["terminator_region"]})
        ws.cache._remote_checked[os.path.abspath(path)] = 0
        # a different user triggers it; the shared copy must still refresh
        ws.cache.materialize_remote_library(PUBLIC_URL, principal="u_bob")
        assert "v2_new" in H.part_names(
            ws.cache.get_feature_library_for_subset([path]))
    finally:
        ws.close()


def test_capacity_shipped_libraries_do_not_use_import_slots():
    """The shipped set must not compete with imports for the bounded slots."""
    ws = Workspace()
    try:
        for i in range(3):
            ws.local_library(f"L{i}", {f"L{i}": H.PARTS["promoter_region"]})
        ws.cache.preload_libraries(ws.assets)
        shipped = list(ws.cache._library_name_map.values())
        assert all(p in ws.cache._protected for p in shipped)
        assert not any(p in ws.cache._library_lru for p in shipped), \
            "a shipped library is taking an LRU slot"
    finally:
        ws.close()


# ------------------------------------------------------------------ runner

def main():
    pattern = sys.argv[1] if len(sys.argv) > 1 else ""
    tests = [(name, fn) for name, fn in sorted(globals().items())
             if name.startswith("test_") and callable(fn) and pattern in name]
    if not tests:
        print(f"No test matches {pattern!r}")
        return 1

    passed, failed = [], []
    for name, fn in tests:
        label = name[len("test_"):].replace("_", " ")
        try:
            fn()
            passed.append(name)
            print(f"  PASS  {label}")
        except Exception:
            failed.append(name)
            print(f"  FAIL  {label}")
            print("        " + traceback.format_exc().strip().replace("\n", "\n        "))

    print(f"\n{len(passed)} passed, {len(failed)} failed")
    if failed:
        print("Failed: " + ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
