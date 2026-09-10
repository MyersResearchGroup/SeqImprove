"""
Library caching and index management system for SeqImprove.

This module provides efficient caching mechanisms for SBOL libraries and alignment indexes:
- Content-based hashing (SHA256) for cache invalidation
- LRU eviction for index cache (configurable size)
- Persistent storage across server restarts
- Thread-safe operations
"""

import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Set
import requests
import sbol2

import identity
from sequences_to_features import FeatureLibrary
from sequences_to_features.FeatureExtractor import FeatureExtractor


# configuration
DEFAULT_CACHE_DIR = "./.cache/seqimprove"
# Each index is a FASTA plus the aligner's index files: measured at 0.6-1.2 MB
# for the libraries shipped here, so even a few hundred cost well under a GB of
# disk -- and an evicted index is rebuilt automatically. Partitioning private
# libraries per user multiplies the number of distinct index keys, so this needs
# to be generous. Override with SEQIMPROVE_MAX_INDEXES.
DEFAULT_MAX_INDEXES = int(os.environ.get("SEQIMPROVE_MAX_INDEXES", "150"))
# In-memory library caches. These were built as "permanent, never evicted", which
# was fine when the only libraries were the handful preloaded from assets/. Once
# private libraries are partitioned per user, every (user, library) pair
# materializes to disk AND loads into these dicts forever. The cost is in the
# sbol2.Document -- measured at ~15-20x the XML size -- so this grows without
# bound.
#
# The caps apply ONLY to imported libraries. The ones shipped in assets/ are a
# fixed set the server must always be able to offer, so they are preloaded and
# exempt (see LibraryCache._protected). An evicted import is re-read from disk.
#
# SEQIMPROVE_MAX_CACHED_LIBRARIES used to be a single ceiling over everything.
# It was replaced by the public/private split below, because one queue let a few
# users' private imports evict every shared public library.
# Public and private libraries are cached in separate pools, because one shared
# LRU let them compete on equal terms and a public collection always lost: a
# handful of users importing private libraries evicted every public one, and each
# eviction is paid back by *every* user who needs it, not just the importer.
DEFAULT_MAX_CACHED_PUBLIC = int(os.environ.get("SEQIMPROVE_MAX_CACHED_PUBLIC", "16"))
DEFAULT_MAX_CACHED_PRIVATE = int(os.environ.get("SEQIMPROVE_MAX_CACHED_PRIVATE", "32"))
# ...and one user does not get the whole private pool. Splitting public from
# private alone still let a single busy account flush everyone else's libraries,
# which is the same unfairness one level down.
DEFAULT_MAX_CACHED_PER_USER = int(os.environ.get("SEQIMPROVE_MAX_CACHED_PER_USER", "8"))
# Merged libraries turn out to be nearly free: a FeatureLibrary is an index over
# Documents it does not own, so a 4-library subset measured +0.0 MB on top of the
# Documents already cached. This cap only stops the dict itself accumulating one
# entry per distinct combination; it is not the memory lever -- that is
# MAX_CACHED_LIBRARIES above, which bounds the Documents.
DEFAULT_MAX_CACHED_SUBSETS = int(os.environ.get("SEQIMPROVE_MAX_CACHED_SUBSETS", "12"))
# Downloaded SynBioHub XML under <cache>/remote. Unbounded before: one file per
# (user, private library), kept forever.
DEFAULT_MAX_REMOTE_FILES = int(os.environ.get("SEQIMPROVE_MAX_REMOTE_FILES", "200"))

# Scheduled cleanup. The count caps above only fire when a cap is exceeded, so a
# quiet server keeps one user's private library and its index indefinitely. These
# add an age bound: keep everything for the short term, then let it go. Nothing
# here is data -- a pruned library is re-fetched from SynBioHub and a pruned
# index is rebuilt, both automatically on next use.
CACHE_TTL_SECONDS = int(os.environ.get("SEQIMPROVE_CACHE_TTL_HOURS", "72")) * 3600
# Whether the janitor also ages out PUBLIC downloads. Off by default: the growth
# this cleanup exists for is private libraries, which are one per (user,
# collection) and therefore unbounded. Public collections are a small fixed set,
# shared by everyone and usually hot, and dropping one costs a re-download plus
# an index rebuild that every user waits for. Set to 1 to reclaim them too.
PRUNE_PUBLIC_DOWNLOADS = os.environ.get("SEQIMPROVE_PRUNE_PUBLIC", "0") == "1"
JANITOR_INTERVAL_SECONDS = int(os.environ.get("SEQIMPROVE_JANITOR_INTERVAL_MINUTES", "60")) * 60
# How long a cached remote library may be reused without asking SynBioHub whether
# it changed. A cached copy used to be trusted until it was pruned, so a user who
# updated a collection on SynBioHub kept getting the old parts for up to the full
# cache TTL unless they re-imported by hand. This bounds that staleness: one
# lightweight request per library per window, not one per annotation.
REMOTE_FRESHNESS_SECONDS = int(os.environ.get("SEQIMPROVE_REMOTE_FRESHNESS_MINUTES", "5")) * 60
METADATA_FILE = "cache_metadata.json"


@dataclass
class LibraryInfo:
    """Metadata about a cached library."""
    file_path: str
    content_hash: str
    last_accessed: float
    file_size: int
    component_count: int = 0


@dataclass
class IndexInfo:
    """Metadata about a cached index."""
    algorithm: str
    library_hashes: List[str]  # sorted list of library content hashes
    combined_hash: str  # hash of algorithm + library hashes (cache key)
    index_path: str
    fasta_path: str
    created_at: float
    last_accessed: float
    library_files: List[str]  # original file paths for reference


@dataclass
class CacheMetadata:
    """Persistent cache state."""
    libraries: Dict[str, LibraryInfo] = field(default_factory=dict)
    indexes: Dict[str, IndexInfo] = field(default_factory=dict)
    version: str = "1.0"

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "libraries": {k: asdict(v) for k, v in self.libraries.items()},
            "indexes": {k: asdict(v) for k, v in self.indexes.items()}
        }

    @classmethod
    def from_dict(cls, data: dict) -> "CacheMetadata":
        metadata = cls(version=data.get("version", "1.0"))

        for k, v in data.get("libraries", {}).items():
            metadata.libraries[k] = LibraryInfo(**v)

        for k, v in data.get("indexes", {}).items():
            metadata.indexes[k] = IndexInfo(**v)

        return metadata


class LibraryCache:
    """
    Manages loading and caching of SBOL library documents.

    Two-tier caching strategy:
    - Tier 1 (permanent, in-memory): SBOL Documents, XML strings, FeatureLibraries
      Loaded once at startup, never evicted. Used for indexing (read-only) and as
      templates for fast fresh copies when annotation mutates docs.
    - Tier 2 (per-subset): FeatureLibrary objects keyed by frozenset of library paths.
      Reused for exact-match annotation where no mutation occurs.

    For similar-match annotation (which mutates library docs via variant creation),
    fresh Document copies are created from cached XML strings — no disk I/O needed.
    """

    def __init__(self, cache_dir: str = DEFAULT_CACHE_DIR):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.RLock()
        self._documents: Dict[str, sbol2.Document] = {}  # abs_path -> document (permanent)
        self._xml_strings: Dict[str, str] = {}  # abs_path -> serialized XML (for fast fresh copies)
        self._feature_libraries: Dict[str, FeatureLibrary] = {}  # abs_path -> single-library FeatureLibrary
        self._subset_feature_libraries: Dict[Tuple[frozenset, tuple], FeatureLibrary] = {}  # (frozenset(paths), content hashes) -> merged FeatureLibrary
        # Recency for the two bounded caches above. Caller must hold self._lock.
        # Two pools rather than one queue: public entries are shared by every
        # user, private ones matter to exactly one, so they must not evict each
        # other. Private additionally carries a per-principal quota.
        self._public_lru: OrderedDict = OrderedDict()    # abs_path -> None
        self._private_lru: OrderedDict = OrderedDict()   # abs_path -> None
        # Libraries that ship with the app (assets/). A fixed, known set that the
        # server is expected to be able to offer at any time, so they are loaded
        # once at startup and never evicted -- only per-user imported libraries,
        # which are unbounded in number, take part in the LRU.
        self._protected: set = set()
        self._subset_lru: OrderedDict = OrderedDict()    # subset key -> None
        # abs_path -> when we last asked SynBioHub whether this copy is current
        self._remote_checked: Dict[str, float] = {}
        # Set by init_cache(); lets a detected content change retire the index
        # built from the previous content.
        self._index_manager = None
        self._hashes: Dict[str, str] = {}  # abs_path -> content_hash
        # Hash of the bytes actually parsed into _documents / _feature_libraries.
        # Kept separate from _metadata because get_library_hash() refreshes the
        # metadata entry as a side effect -- comparing against that could never
        # detect a change (it compared the new hash with itself).
        self._document_hashes: Dict[str, str] = {}
        self._feature_library_hashes: Dict[str, str] = {}
        self._library_name_map: Dict[str, str] = {}  # filename -> abs_path (e.g. "iGEM.xml" -> "/full/path/iGEM.xml")
        self._metadata = self._load_metadata()

    def _load_metadata(self) -> CacheMetadata:
        """Load cache metadata from disk."""
        metadata_path = self.cache_dir / METADATA_FILE
        if metadata_path.exists():
            try:
                with open(metadata_path, 'r') as f:
                    data = json.load(f)
                return CacheMetadata.from_dict(data)
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Warning: Could not load cache metadata: {e}")
        return CacheMetadata()

    def _save_metadata(self):
        """Save cache metadata to disk, atomically.

        Writing in place with open(..., 'w') truncates first, so a crash or a
        concurrent writer leaves a half-written file; _load_metadata then hits
        JSONDecodeError, silently returns empty metadata, and the whole index
        cache is orphaned on the next boot. Write a sibling temp file and rename
        it -- os.replace is atomic on POSIX, so readers see either the old file
        or the new one, never a partial one.
        """
        metadata_path = self.cache_dir / METADATA_FILE
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile('w', dir=str(self.cache_dir),
                                             prefix='.cache_metadata.', suffix='.tmp',
                                             delete=False) as f:
                tmp_path = f.name
                json.dump(self._metadata.to_dict(), f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, metadata_path)
        except (IOError, OSError) as e:
            print(f"Warning: Could not save cache metadata: {e}")
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    @staticmethod
    def _atomic_write_text(path: Path, text: str) -> None:
        """Write a cached library file so no reader can ever see it half-written.

        Path.write_text truncates first, and the refresh path deliberately runs
        outside the cache lock (it makes a network call), so a thread parsing the
        same file under the lock could read a partial document. Write a sibling
        temp file and rename: os.replace is atomic on POSIX, so a reader gets
        either the old bytes or the new ones.
        """
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile('w', dir=str(path.parent),
                                             prefix='.' + path.name + '.', suffix='.tmp',
                                             delete=False, encoding='utf-8') as f:
                tmp_path = f.name
                f.write(text)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, str(path))
        except BaseException:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
            raise

    def compute_file_hash(self, file_path: str) -> str:
        """Compute SHA256 hash of file contents."""
        hasher = hashlib.sha256()
        with open(file_path, 'rb') as f:
            # read in chunks for large files
            for chunk in iter(lambda: f.read(8192), b''):
                hasher.update(chunk)
        return hasher.hexdigest()

    def compute_content_hash(self, content: str) -> str:
        """Compute SHA256 hash of string content."""
        return hashlib.sha256(content.encode('utf-8')).hexdigest()

    @staticmethod
    def _principal_of_path(abs_path: str) -> Optional[str]:
        """The owner of a cached private library, from its path.

        Private downloads live under <cache>/remote/u/<principal>/; anything else
        is shared. Reading it back off the path avoids threading the principal
        through every cache call for a fact the layout already records.
        """
        parts = abs_path.replace(os.sep, "/").split("/")
        try:
            i = len(parts) - 1 - parts[::-1].index("u")
        except ValueError:
            return None
        if i >= 1 and parts[i - 1] == "remote" and i + 1 < len(parts):
            return parts[i + 1]
        return None

    def _drop_parsed(self, abs_path: str, reason: str) -> None:
        """Forget the parsed forms of a library. The file on disk stays."""
        self._documents.pop(abs_path, None)
        self._xml_strings.pop(abs_path, None)
        self._feature_libraries.pop(abs_path, None)
        self._document_hashes.pop(abs_path, None)
        self._feature_library_hashes.pop(abs_path, None)
        print(f"Evicted parsed library from memory ({reason}): "
              f"{os.path.basename(abs_path)}")

    def _touch_library(self, abs_path: str) -> None:
        """Mark a library most-recently-used and evict past its pool's cap.

        Evicting drops the parsed forms only; the file on disk is untouched, so
        the next use just re-reads it. Caller must hold self._lock.
        """
        if abs_path in self._protected:
            return

        principal = self._principal_of_path(abs_path)
        if principal is None:
            self._public_lru.pop(abs_path, None)
            self._public_lru[abs_path] = None
            while len(self._public_lru) > DEFAULT_MAX_CACHED_PUBLIC:
                oldest, _ = self._public_lru.popitem(last=False)
                self._drop_parsed(oldest, "public pool full")
            return

        self._private_lru.pop(abs_path, None)
        self._private_lru[abs_path] = None

        # This user's own quota first, so a busy account trims itself rather than
        # its neighbours.
        mine = [p for p in self._private_lru
                if self._principal_of_path(p) == principal]
        while len(mine) > DEFAULT_MAX_CACHED_PER_USER:
            oldest = mine.pop(0)
            self._private_lru.pop(oldest, None)
            self._drop_parsed(oldest, "per-user quota")

        # Then the shared private ceiling, oldest across all users.
        while len(self._private_lru) > DEFAULT_MAX_CACHED_PRIVATE:
            oldest, _ = self._private_lru.popitem(last=False)
            self._drop_parsed(oldest, "private pool full")

    def _touch_subset(self, key) -> None:
        """Same, for merged subset libraries. Caller must hold self._lock."""
        self._subset_lru.pop(key, None)
        self._subset_lru[key] = None
        while len(self._subset_lru) > DEFAULT_MAX_CACHED_SUBSETS:
            oldest, _ = self._subset_lru.popitem(last=False)
            self._subset_feature_libraries.pop(oldest, None)

    def get_library_hash(self, file_path: str) -> str:
        """Get content hash for a library file, computing if needed."""
        with self._lock:
            abs_path = os.path.abspath(file_path)

            # Always hash the bytes. The previous shortcut returned the cached
            # hash whenever the file SIZE was unchanged, so a same-length edit --
            # re-importing a SynBioHub library after changing a description, or
            # any equal-size rewrite of the same path -- kept the stale hash, and
            # with it the stale Document, FeatureLibrary and alignment index. The
            # largest library here is 1.4 MB and hashes in ~14 ms, so the
            # shortcut bought nothing and cost correctness.
            # compute fresh hash
            content_hash = self.compute_file_hash(abs_path)
            self._hashes[abs_path] = content_hash

            # update metadata
            try:
                file_size = os.path.getsize(abs_path)
                self._metadata.libraries[abs_path] = LibraryInfo(
                    file_path=abs_path,
                    content_hash=content_hash,
                    last_accessed=time.time(),
                    file_size=file_size
                )
                self._save_metadata()
            except OSError:
                pass

            return content_hash

    def get_document(self, file_path: str, force_reload: bool = False) -> sbol2.Document:
        """
        Get an SBOL Document for a library file (permanently cached).

        Documents are loaded from disk once and kept in memory forever.
        The cached XML string is also stored for creating fast fresh copies.

        Args:
            file_path: Path to the library XML file
            force_reload: If True, bypass cache and reload from disk

        Returns:
            sbol2.Document instance (from permanent cache — do NOT mutate)
        """
        with self._lock:
            abs_path = os.path.abspath(file_path)
            current_hash = self.get_library_hash(abs_path)

            # check if we need to reload
            if not force_reload and abs_path in self._documents:
                if self._document_hashes.get(abs_path) == current_hash:
                    self._touch_library(abs_path)
                    cached_info = self._metadata.libraries.get(abs_path)
                    if cached_info:
                        cached_info.last_accessed = time.time()
                    return self._documents[abs_path]
                print(f"Library changed on disk, reloading: {abs_path}")
                # The index built from the old content is now unreachable -- its
                # key is a hash of the old content and will never be computed
                # again -- so it would sit on disk until the LRU or the TTL got
                # to it. Drop it now that we know it is superseded.
                if self._index_manager is not None:
                    self._index_manager.remove_indexes_for_library(abs_path)

            # load from disk (one-time cost per library)
            doc = sbol2.Document()
            doc.read(abs_path)
            self._documents[abs_path] = doc
            self._document_hashes[abs_path] = current_hash
            self._touch_library(abs_path)

            # cache the XML string for fast fresh copies later
            self._xml_strings[abs_path] = doc.writeString()

            # update metadata
            if abs_path in self._metadata.libraries:
                self._metadata.libraries[abs_path].last_accessed = time.time()
                self._metadata.libraries[abs_path].component_count = len(doc.componentDefinitions)

            self._save_metadata()
            return doc

    def get_fresh_document(self, file_path: str) -> sbol2.Document:
        """
        Get a fresh (mutable) copy of an SBOL Document.

        Creates a new Document by deserializing the cached XML string — no disk I/O.
        Use this when the annotation process will mutate the document (e.g. similar matches
        create variant definitions inside library docs).
        """
        with self._lock:
            abs_path = os.path.abspath(file_path)

            # ensure the document and XML string are cached
            if abs_path not in self._xml_strings:
                self.get_document(abs_path)

            doc = sbol2.Document()
            doc.readString(self._xml_strings[abs_path])
            return doc

    def get_feature_library(self, file_path: str, force_reload: bool = False) -> FeatureLibrary:
        """
        Get a FeatureLibrary for a single library file (permanently cached).

        Args:
            file_path: Path to the library XML file
            force_reload: If True, bypass cache and reload

        Returns:
            FeatureLibrary instance (from permanent cache — do NOT mutate)
        """
        with self._lock:
            abs_path = os.path.abspath(file_path)
            current_hash = self.get_library_hash(abs_path)

            # check if we need to reload
            if not force_reload and abs_path in self._feature_libraries:
                if self._feature_library_hashes.get(abs_path) == current_hash:
                    self._touch_library(abs_path)
                    cached_info = self._metadata.libraries.get(abs_path)
                    if cached_info:
                        cached_info.last_accessed = time.time()
                    return self._feature_libraries[abs_path]

            # load fresh
            doc = self.get_document(abs_path, force_reload)
            feature_lib = FeatureLibrary([doc])
            self._feature_libraries[abs_path] = feature_lib
            self._feature_library_hashes[abs_path] = current_hash
            self._touch_library(abs_path)

            return feature_lib

    def get_feature_library_for_subset(self, file_paths: List[str]) -> FeatureLibrary:
        """
        Get a cached FeatureLibrary for a subset of libraries (step 2).

        Merges features from multiple libraries into a single FeatureLibrary.
        Cached by frozenset of absolute paths — reused across requests with the
        same library selection.

        Only use the returned FeatureLibrary for read-only operations
        (exact-match annotation). For similar-match annotation that mutates docs,
        use get_fresh_feature_library_for_subset() instead.
        """
        with self._lock:
            paths = frozenset(os.path.abspath(p) for p in file_paths)

            # Key on the CONTENT of the libraries, not just their paths. Keying
            # on paths alone meant this cache was never invalidated: once a
            # subset had been built, updating any member library on SynBioHub and
            # re-importing it left every later annotation running against the old
            # parts, with nothing to signal that. Folding the content hashes into
            # the key makes an updated library produce a different key, so the
            # merged FeatureLibrary is rebuilt automatically.
            hashes = tuple(sorted(self.get_library_hash(p) for p in paths))
            key = (paths, hashes)

            if key in self._subset_feature_libraries:
                self._touch_subset(key)
                return self._subset_feature_libraries[key]

            docs = self.get_documents_for_libraries(list(paths))
            feature_lib = FeatureLibrary(docs)

            # Drop any previously cached entry for this same path set -- its
            # content is now superseded and nothing will ask for it again.
            for stale in [k for k in self._subset_feature_libraries
                          if k[0] == paths and k != key]:
                del self._subset_feature_libraries[stale]
                self._subset_lru.pop(stale, None)

            self._subset_feature_libraries[key] = feature_lib
            self._touch_subset(key)
            return feature_lib

    def get_fresh_feature_library_for_subset(self, file_paths: List[str]) -> FeatureLibrary:
        """
        Get a fresh (mutable) FeatureLibrary for a subset of libraries.

        Creates fresh Document copies from cached XML strings, then builds a new
        FeatureLibrary. Use this for similar-match annotation which mutates library docs.
        No disk I/O — all from in-memory XML cache.
        """
        fresh_docs = self.get_fresh_documents_for_libraries(file_paths)
        return FeatureLibrary(fresh_docs)

    def get_documents_for_libraries(self, file_paths: List[str]) -> List[sbol2.Document]:
        """Get permanently cached documents for multiple library files."""
        return [self.get_document(fp) for fp in file_paths]

    def get_fresh_documents_for_libraries(self, file_paths: List[str]) -> List[sbol2.Document]:
        """Get fresh (mutable) copies of documents from in-memory XML cache."""
        return [self.get_fresh_document(fp) for fp in file_paths]

    def get_feature_extractor_for_subset(self, file_paths: List[str]) -> FeatureExtractor:
        """
        Build a FeatureExtractor over the given libraries.

        Used by Prokka annotation, which needs FeatureExtractor.cds_id_map to
        translate BLASTP protein hit IDs (CDS_000001 etc.) back to library
        component identities.
        """
        docs = self.get_documents_for_libraries(file_paths)
        return FeatureExtractor(docs)

    def get_protein_fasta_path(self, file_paths: List[str]) -> str:
        """
        Get path to a cached protein FASTA built from the given libraries.

        Prokka requires a protein database file as input (--proteins). The FASTA
        is keyed by the combined hash of library contents — same library subset
        reuses the same file.
        """
        sorted_paths = sorted(os.path.abspath(p) for p in file_paths)
        library_hashes = [self.get_library_hash(p) for p in sorted_paths]
        subset_hash = hashlib.sha256(":".join(library_hashes).encode('utf-8')).hexdigest()[:16]

        protein_dir = self.cache_dir / "protein"
        protein_path = protein_dir / f"{subset_hash}.fasta"

        with self._lock:
            if protein_path.exists():
                return str(protein_path.resolve())

            protein_dir.mkdir(parents=True, exist_ok=True)
            extractor = self.get_feature_extractor_for_subset(sorted_paths)
            extractor.write_protein_fasta(str(protein_path))
            return str(protein_path.resolve())

    def _prune_remote_files(self) -> None:
        """Keep <cache>/remote from growing forever.

        One XML lands here per (user, private library) and nothing ever removed
        them. Drop the least-recently-used files past the cap; a pruned file is
        re-fetched from SynBioHub on next use, so this costs a download, not
        data. Anything still loaded in memory is kept regardless -- evicting a
        file out from under a live Document would leave the cache referring to a
        path that no longer exists.
        """
        remote_root = self.cache_dir / "remote"
        if not remote_root.exists():
            return
        files = [p for p in remote_root.rglob("*.xml") if p.is_file()]
        if len(files) <= DEFAULT_MAX_REMOTE_FILES:
            return
        in_use = set(self._documents)
        files.sort(key=lambda p: p.stat().st_mtime)
        for path in files[:len(files) - DEFAULT_MAX_REMOTE_FILES]:
            if str(path.resolve()) in in_use:
                continue
            try:
                path.unlink()
                print(f"Pruned cached remote library: {path.name}")
            except OSError:
                pass

    def migrate_shared_private_downloads(self) -> int:
        """Remove private collections left in the shared cache area.

        Before downloads were partitioned by owner, every remote library landed
        in <cache>/remote/<hash>.xml regardless of who fetched it. Those files
        are now unreachable -- a /user/ URL resolves to remote/u/<principal>/ --
        but they are private content sitting in the shared area, and the janitor
        does not scan there, so they would stay forever.

        They are deleted rather than moved: the file records no owner, so which
        principal's partition it belongs in is unknowable. The next request for
        that collection re-fetches it into the right place.
        """
        remote_root = self.cache_dir / "remote"
        if not remote_root.exists():
            return 0

        removed = 0
        with self._lock:
            for path in sorted(remote_root.glob("*.xml")):
                try:
                    head = path.read_text(encoding="utf-8", errors="ignore")[:4000]
                except OSError:
                    continue
                match = re.search(r'rdf:about="(https?://[^"]+)"', head)
                if not match or identity.is_public(match.group(1)):
                    continue
                abs_path = os.path.abspath(str(path))
                try:
                    path.unlink()
                except OSError:
                    continue
                for store in (self._documents, self._xml_strings, self._feature_libraries,
                              self._document_hashes, self._feature_library_hashes,
                              self._hashes, self._remote_checked):
                    store.pop(abs_path, None)
                self._public_lru.pop(abs_path, None)
                self._private_lru.pop(abs_path, None)
                self._metadata.libraries.pop(abs_path, None)
                removed += 1
                print(f"Migrated away a private library cached in the shared area: "
                      f"{match.group(1)}")
            if removed:
                self._save_metadata()
        return removed

    def prune_expired(self, index_manager=None, ttl_seconds: int = None) -> dict:
        """Age out cached downloads and indexes. Safe to call at any time.

        Returns a summary of what was removed.

        By default only PRIVATE downloads are aged out. Those are one per (user,
        collection) and are the unbounded growth this exists for; public
        collections are few, shared and usually hot, and dropping one makes every
        user pay for a re-download and an index rebuild.
        SEQIMPROVE_PRUNE_PUBLIC=1 includes them.

        Otherwise conservative:
          - libraries under assets/ are never touched (they ship with the app)
          - a file still parsed into memory is left alone, so no live Document
            ends up pointing at a path that no longer exists
          - a pinned index -- one an aligner is reading right now -- is skipped
        """
        ttl = CACHE_TTL_SECONDS if ttl_seconds is None else ttl_seconds
        cutoff = time.time() - ttl
        removed = {"remote_files": 0, "indexes": 0}

        remote_root = self.cache_dir / "remote"
        # Private downloads live under remote/u/<principal>/; public ones sit
        # directly in remote/.
        scan_root = remote_root if PRUNE_PUBLIC_DOWNLOADS else remote_root / "u"
        with self._lock:
            in_use = set(self._documents) | self._protected
            if scan_root.exists():
                for path in list(scan_root.rglob("*.xml")):
                    if not path.is_file():
                        continue
                    abs_path = str(path.resolve())
                    # Age by last USE, not by file mtime. mtime is set when the
                    # library is downloaded and never touched again, so a library
                    # someone uses daily would still have been pruned 72h after
                    # its download. Fall back to mtime only when there is no
                    # recorded access (e.g. a file left by an older version).
                    info = self._metadata.libraries.get(abs_path)
                    last_used = info.last_accessed if info else path.stat().st_mtime
                    if last_used >= cutoff:
                        continue
                    if abs_path in in_use:
                        continue
                    try:
                        path.unlink()
                        removed["remote_files"] += 1
                    except OSError:
                        continue
                    # Take the derived index with it, on the same pass.
                    self._metadata.libraries.pop(abs_path, None)
                    for store in (self._hashes, self._document_hashes,
                                  self._feature_library_hashes):
                        store.pop(abs_path, None)
                    self._public_lru.pop(abs_path, None)
                    self._private_lru.pop(abs_path, None)
                    if index_manager is not None:
                        removed["indexes"] += index_manager.remove_indexes_for_library(abs_path)
                # tidy up any partition directories left empty
                for d in sorted(scan_root.rglob("*"), reverse=True):
                    if d.is_dir() and not any(d.iterdir()):
                        try:
                            d.rmdir()
                        except OSError:
                            pass

        if index_manager is not None:
            removed["indexes"] += index_manager.prune_expired(ttl_seconds=ttl)

        if removed["remote_files"] or removed["indexes"]:
            scope = "downloaded" if PRUNE_PUBLIC_DOWNLOADS else "private"
            print(f"Cache janitor removed {removed['remote_files']} {scope} "
                  f"librar{'y' if removed['remote_files'] == 1 else 'ies'} and "
                  f"{removed['indexes']} index(es) older than {ttl // 3600}h")
        return removed

    def _remote_cache_path(self, url: str, principal: Optional[str] = None) -> Tuple[str, Path, bool]:
        """Where a remote library's copy lives, and whether that spot is shared.

        A public collection keeps the shared, content-addressed path so every
        user reuses one file and one alignment index. A private one is filed
        under its owner's partition, because the previous URL-only key meant the
        content one user fetched with their token was handed to anyone else who
        named the same URL, with no authorization check at all.
        """
        canonical = identity.canonical_url(url)
        url_hash = hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:16]
        partition, shared = identity.partition_for(canonical, principal)
        remote_dir = self.cache_dir / "remote" if shared else self.cache_dir / "remote" / "u" / partition
        return canonical, remote_dir / f"{url_hash}.xml", shared

    def materialize_remote_library(self, url: str, session_token: str = None,
                                   force_refresh: bool = False,
                                   principal: Optional[str] = None) -> Optional[str]:
        """
        Ensure a SynBioHub library is available on disk so alignment algorithms
        (BWA / Minimap2 / BLASTN) can index it.

        Canonicalizes the URL (strips api. prefix), fetches via api.synbiohub.org
        to bypass Cloudflare, and writes the SBOL XML under
        <cache_dir>/remote/<hash>.xml. Subsequent calls reuse the cached file.

        Returns the absolute path to the cached XML, or None on failure.
        """
        canonical, cached_path, _shared = self._remote_cache_path(url, principal)
        remote_dir = cached_path.parent
        abs_path = str(cached_path.resolve()) if cached_path.exists() else os.path.abspath(str(cached_path))

        # Ask SynBioHub whether the cached copy is still current, at most once per
        # REMOTE_FRESHNESS_SECONDS. Done before taking the lock: it is a network
        # call, and holding the cache lock across it would stall every other
        # request. _refresh_if_stale rewrites the file only when the bytes differ,
        # so the content-hash machinery downstream refreshes everything -- the
        # Document, the FeatureLibrary, the merged subsets and the index -- on its
        # own from there.
        if cached_path.exists() and not force_refresh:
            self._refresh_if_stale(canonical, cached_path, session_token)

        with self._lock:
            # already loaded into permanent cache
            if abs_path in self._documents and not force_refresh:
                return abs_path

            # disk file exists but not loaded — load it
            if cached_path.exists() and not force_refresh:
                try:
                    self.get_document(abs_path)
                    return abs_path
                except Exception as e:
                    print(f"Warning: cached remote library at {abs_path} unreadable ({e}), refetching")

            # fetch from SynBioHub via api. subdomain (bypasses Cloudflare)
            remote_dir.mkdir(parents=True, exist_ok=True)
            # Forwards the caller's token and falls back to /sbol when the bare
            # URI yields a collection with no parts in it.
            text, status = self._fetch_library_sbol(canonical, session_token)
            if text is None:
                print(f"Could not fetch remote library '{canonical}' (HTTP {status})")
                return None

            try:
                self._atomic_write_text(cached_path, text)
                self._prune_remote_files()
            except OSError as e:
                print(f"Failed to write remote library to {cached_path}: {e}")
                return None

            try:
                self.get_document(abs_path)
                print(f"Materialized remote library '{canonical}' -> {abs_path}")
                return abs_path
            except Exception as e:
                print(f"Failed to parse remote library '{canonical}': {e}")
                try:
                    cached_path.unlink()
                except OSError:
                    pass
                return None

    @staticmethod
    def _has_parts(sbol_text: str) -> bool:
        """Does this SBOL actually contain component definitions?

        A collection fetched by its bare URI comes back as just the Collection
        object -- no members, no parts -- which yields an empty FASTA and an
        unreadable makeblastdb failure downstream.
        """
        return "<sbol:ComponentDefinition" in sbol_text

    def _fetch_library_sbol(self, canonical: str, session_token: str = None,
                            timeout: int = 300):
        """Fetch a library's SBOL, falling back to the recursive /sbol endpoint.

        SynBioHub serves two things at a collection's URI: the bare URI returns
        only that object, while <uri>/sbol returns the complete document with its
        members and their sequences. Asking for the bare URI therefore produced a
        Collection with nothing in it -- which is what the frontend already
        works around when loading a document by URL, appending /sbol there.

        Try as given first (some URIs already point at a part, or already end in
        /sbol), and retry recursively only when the response has no parts, so a
        URL that already worked keeps working.

        Returns (text, status_code); text is None if nothing usable came back.
        """
        headers = {"Accept": "text/plain"}
        if session_token:
            headers["X-authorization"] = session_token

        attempts = [canonical]
        if not canonical.rstrip("/").endswith("/sbol"):
            attempts.append(canonical.rstrip("/") + "/sbol")

        last_status = None
        for attempt, url in enumerate(attempts):
            fetch_url = re.sub(r'^(https?://)(?!api\.)(synbiohub\.org)', r'\1api.\2', url)
            try:
                response = requests.get(fetch_url, headers=headers, timeout=timeout)
            except requests.exceptions.RequestException as e:
                print(f"Fetch failed for '{fetch_url}': {e}")
                return None, last_status
            last_status = response.status_code
            if response.status_code != 200:
                continue
            if self._has_parts(response.text):
                return response.text, 200
            if attempt + 1 < len(attempts):
                print(f"'{url}' returned a collection with no parts; "
                      f"retrying the recursive /sbol endpoint")
            else:
                # Nothing better available -- hand back what we got so the
                # caller's own emptiness check can produce a useful message.
                return response.text, 200
        return None, last_status

    def _refresh_if_stale(self, canonical: str, cached_path: Path,
                          session_token: str = None) -> bool:
        """Re-download a cached remote library if it may have changed upstream.

        Returns True if the file on disk was replaced. Failure is not an error:
        if SynBioHub is unreachable or refuses the request, the cached copy is
        kept and the check is retried next window -- a stale library is far
        better than a failed annotation.
        """
        abs_path = str(cached_path.resolve())
        now = time.time()
        with self._lock:
            last = self._remote_checked.get(abs_path, 0.0)
            if now - last < REMOTE_FRESHNESS_SECONDS:
                return False
            # Record the attempt up front so concurrent requests don't all fire
            # their own fetch for the same library.
            self._remote_checked[abs_path] = now

        new_text, status = self._fetch_library_sbol(canonical, session_token, timeout=120)
        if new_text is None:
            print(f"Freshness check for '{canonical}' failed (HTTP {status}); "
                  f"keeping cached copy")
            return False
        try:
            if cached_path.read_text(encoding='utf-8') == new_text:
                return False        # unchanged upstream; nothing to do
        except OSError:
            pass

        try:
            self._atomic_write_text(cached_path, new_text)
        except OSError as e:
            print(f"Could not refresh '{canonical}': {e}")
            return False
        print(f"Remote library changed upstream, refreshed: {canonical}")
        return True

    def cache_remote_library_content(self, url: str, sbol_text: str,
                                     principal: Optional[str] = None) -> Optional[str]:
        """
        Write already-fetched SBOL content to the disk cache so alignment
        algorithms (BWA / Minimap2 / BLASTN) can index it without a redundant
        anonymous fetch. Called from /api/importUserLibrary after a successful
        authenticated fetch — also makes private libraries reachable for BLASTN.

        Returns the absolute path to the cached XML, or None on failure.
        """
        canonical, cached_path, _shared = self._remote_cache_path(url, principal)
        remote_dir = cached_path.parent
        abs_path = str(cached_path.resolve()) if cached_path.exists() else os.path.abspath(str(cached_path))

        with self._lock:
            remote_dir.mkdir(parents=True, exist_ok=True)
            try:
                self._atomic_write_text(cached_path, sbol_text)
                # This content just came from SynBioHub, so it is current by
                # definition -- start the freshness window now instead of letting
                # the next request immediately re-check it.
                self._remote_checked[abs_path] = time.time()
                self._prune_remote_files()
            except OSError as e:
                print(f"Failed to write imported library to {cached_path}: {e}")
                return None

            try:
                self.get_document(abs_path)
                print(f"Cached imported library '{canonical}' -> {abs_path}")
                return abs_path
            except Exception as e:
                print(f"Failed to parse imported library '{canonical}': {e}")
                try:
                    cached_path.unlink()
                except OSError:
                    pass
                return None

    def forget_remote_library(self, url: str, principal: Optional[str] = None,
                              index_manager=None) -> bool:
        """Drop a remote library from disk and from every in-memory cache.

        A public collection is left alone: its cached copy and index are shared
        by every user, so one user removing it from their list must not make
        everyone else re-download and re-index it. The caps and the janitor
        reclaim it once nobody uses it.

        Returns True if anything was actually removed.
        """
        _canonical, cached_path, shared = self._remote_cache_path(url, principal)
        if shared:
            return False
        abs_path = os.path.abspath(str(cached_path))
        removed = False
        with self._lock:
            for store in (self._documents, self._xml_strings, self._feature_libraries,
                          self._document_hashes, self._feature_library_hashes,
                          self._hashes):
                removed = store.pop(abs_path, None) is not None or removed
            self._public_lru.pop(abs_path, None)
            self._private_lru.pop(abs_path, None)
            for key in [k for k in self._subset_feature_libraries if abs_path in k[0]]:
                del self._subset_feature_libraries[key]
                self._subset_lru.pop(key, None)
                removed = True
            self._metadata.libraries.pop(abs_path, None)
            if index_manager is not None and index_manager.remove_indexes_for_library(abs_path):
                removed = True
            if cached_path.exists():
                try:
                    cached_path.unlink()
                    removed = True
                except OSError:
                    pass
            self._save_metadata()
        return removed

    def resolve_library_paths(self, names: List[str], library_dir: str = None,
                              session_token: str = None,
                              principal: Optional[str] = None) -> Tuple[List[str], List[str]]:
        """
        Resolve library display names to absolute file paths.

        Handles:
        - Plain filenames ("iGEM.xml") -> looked up in name map
        - Absolute paths -> returned as-is if they exist
        - SynBioHub URLs -> fetched and cached on disk via materialize_remote_library

        Returns:
            Tuple of (resolved_paths, skipped_names)
        """
        resolved = []
        skipped = []

        for name in names:
            # SynBioHub URL — fetch and cache to disk so alignment can index it
            if 'synbiohub.org' in name or name.startswith('http'):
                materialized = self.materialize_remote_library(
                    name, session_token=session_token, principal=principal)
                if materialized:
                    resolved.append(materialized)
                else:
                    skipped.append(name)
                continue

            # check name map first
            if name in self._library_name_map:
                resolved.append(self._library_name_map[name])
                continue

            # try as absolute path
            abs_path = os.path.abspath(name)
            if os.path.exists(abs_path):
                resolved.append(abs_path)
                continue

            # try joining with library_dir
            if library_dir:
                joined = os.path.abspath(os.path.join(library_dir, name))
                if os.path.exists(joined):
                    resolved.append(joined)
                    continue

            skipped.append(name)

        return resolved, skipped

    def get_available_library_names(self) -> List[str]:
        """Get list of available library filenames."""
        return list(self._library_name_map.keys())

    def preload_libraries(self, library_dir: str):
        """
        Preload all libraries from a directory into permanent cache (step 1).

        Loads XML -> SBOL Documents, caches XML strings, and builds the
        name-to-path map for library selection by name.
        """
        lib_path = Path(library_dir)
        if not lib_path.exists():
            return

        for xml_file in sorted(lib_path.glob("*.xml")):
            try:
                abs_path = str(xml_file.resolve())
                # Mark protected BEFORE loading so the LRU never counts these.
                with self._lock:
                    self._protected.add(abs_path)
                self.get_document(abs_path)
                # Build the FeatureLibrary too, not just the Document: this is
                # the shipped set, expected to be ready to serve immediately.
                self.get_feature_library(abs_path)
                # build name -> path map for selection by name
                self._library_name_map[xml_file.name] = abs_path
                print(f"Preloaded library: {xml_file.name}")
            except Exception as e:
                print(f"Warning: Could not preload {xml_file}: {e}")

    def clear_cache(self):
        """Clear all in-memory caches."""
        with self._lock:
            self._documents.clear()
            self._xml_strings.clear()
            self._feature_libraries.clear()
            self._subset_feature_libraries.clear()
            self._hashes.clear()


class IndexManager:
    """
    Manages alignment index caching with LRU eviction.

    Features:
    - Persistent indexes survive server restarts
    - Content-hash based invalidation
    - LRU eviction when max capacity reached
    - Support for BWA, Minimap2, and BLASTN indexes
    """

    # index file extensions for each algorithm (only required files)
    INDEX_FILES = {
        'bwa': ['.amb', '.ann', '.bwt', '.pac', '.sa'],
        'minimap2': ['.mmi'],
        'blast': ['.nhr', '.nin', '.nsq']  # only required files, .ndb/.not/.ntf/.nto are optional
    }

    def __init__(self,
                 library_cache: LibraryCache,
                 cache_dir: str = DEFAULT_CACHE_DIR,
                 max_indexes: int = DEFAULT_MAX_INDEXES):
        self.library_cache = library_cache
        self.cache_dir = Path(cache_dir) / "indexes"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.max_indexes = max_indexes

        # Share LibraryCache's lock rather than holding a second one. Both classes
        # mutate the SAME CacheMetadata object (assigned just below), so two
        # independent locks provided no mutual exclusion at all: a thread inside
        # LibraryCache._lock and one inside IndexManager._lock could write
        # _metadata -- and _save_metadata -- concurrently. RLock is reentrant, so
        # the nested acquisitions in this class remain safe.
        self._lock = library_cache._lock
        self._access_order: OrderedDict[str, float] = OrderedDict()
        self._metadata = library_cache._metadata
        # Indexes currently being read by an aligner; never evict these.
        self._pinned: Dict[str, int] = {}
        # One build lock per index key, so unrelated index builds run in parallel
        # while duplicate requests for the same index still build it only once.
        self._build_locks: Dict[str, threading.Lock] = {}

        # initialize access order from metadata
        self._init_access_order()

    def _init_access_order(self):
        """Initialize LRU order from persisted metadata."""
        with self._lock:
            # sort by last_accessed time
            sorted_indexes = sorted(
                self._metadata.indexes.items(),
                key=lambda x: x[1].last_accessed
            )
            for key, info in sorted_indexes:
                self._access_order[key] = info.last_accessed

    def _compute_index_key(self, algorithm: str, library_paths: List[str]) -> str:
        """
        Compute a unique key for an index based on algorithm and library content.

        The key is a hash of:
        - Algorithm name
        - Sorted list of library content hashes
        """
        # get content hashes for all libraries
        library_hashes = []
        for path in sorted(library_paths):  # sort for consistency
            try:
                lib_hash = self.library_cache.get_library_hash(path)
            except OSError:
                # A library that is no longer on disk still has to produce a
                # deterministic key, or callers blow up with FileNotFoundError
                # deep inside a request. Key it by its path instead; the result
                # cannot match any real index, which is exactly right -- an index
                # whose source is gone must not be treated as valid.
                lib_hash = "missing:" + hashlib.sha256(
                    os.path.abspath(path).encode()).hexdigest()[:16]
            library_hashes.append(lib_hash)

        # combine algorithm and hashes
        combined = f"{algorithm.lower()}:" + ",".join(library_hashes)
        return hashlib.sha256(combined.encode()).hexdigest()[:16]

    def _get_index_dir(self, index_key: str) -> Path:
        """Get directory path for an index."""
        return self.cache_dir / index_key

    def _evict_oldest(self):
        """Evict the oldest index if at capacity."""
        with self._lock:
            while len(self._access_order) >= self.max_indexes:
                if not self._access_order:
                    break

                # Never evict an index an aligner is currently reading. Eviction
                # rmtree's the directory while BWA/BLASTN may still have the files
                # open, which surfaces as a mid-run "no such file" from the
                # aligner. Skip pinned entries; if every entry is pinned there is
                # nothing safe to reclaim, so let the cache overflow instead.
                evictable = [k for k in self._access_order if not self._pinned.get(k)]
                if not evictable:
                    print("Index cache at capacity but every index is in use; "
                          "skipping eviction this round")
                    break
                oldest_key = evictable[0]

                # remove from disk
                index_dir = self._get_index_dir(oldest_key)
                if index_dir.exists():
                    try:
                        shutil.rmtree(index_dir)
                        print(f"Evicted old index: {oldest_key}")
                    except OSError as e:
                        print(f"Warning: Could not remove index directory: {e}")

                # remove from tracking
                del self._access_order[oldest_key]
                if oldest_key in self._metadata.indexes:
                    del self._metadata.indexes[oldest_key]

            self.library_cache._save_metadata()

    def has_index(self, algorithm: str, library_paths: List[str]) -> bool:
        """Check if a valid index exists for the given algorithm and libraries."""
        index_key = self._compute_index_key(algorithm, library_paths)

        with self._lock:
            if index_key not in self._metadata.indexes:
                return False

            info = self._metadata.indexes[index_key]
            index_dir = self._get_index_dir(index_key)

            # verify index files exist
            algo_lower = algorithm.lower()
            if algo_lower == 'blastn':
                algo_lower = 'blast'

            extensions = self.INDEX_FILES.get(algo_lower, [])
            index_prefix = index_dir / "index"

            for ext in extensions:
                if not (Path(str(index_prefix) + ext)).exists():
                    # index is incomplete, remove metadata
                    del self._metadata.indexes[index_key]
                    if index_key in self._access_order:
                        del self._access_order[index_key]
                    return False

            # verify library hashes haven't changed
            current_hashes = []
            for path in sorted(library_paths):
                try:
                    current_hashes.append(self.library_cache.get_library_hash(path))
                except OSError:
                    # The library this index was built from is gone -- pruned, or
                    # deleted by hand. Treat the index as invalid rather than
                    # letting FileNotFoundError escape into the request, which is
                    # what used to happen.
                    print(f"Index {index_key}: source library missing ({path}); discarding")
                    self._remove_index(index_key)
                    return False

            if current_hashes != info.library_hashes:
                # libraries have changed, invalidate cache
                self._remove_index(index_key)
                return False

            return True

    def _remove_index(self, index_key: str):
        """Remove an index from cache."""
        with self._lock:
            index_dir = self._get_index_dir(index_key)
            if index_dir.exists():
                try:
                    shutil.rmtree(index_dir)
                except OSError:
                    pass

            if index_key in self._metadata.indexes:
                del self._metadata.indexes[index_key]
            if index_key in self._access_order:
                del self._access_order[index_key]

            self.library_cache._save_metadata()

    def get_index_paths(self, algorithm: str, library_paths: List[str]) -> Tuple[str, str]:
        """
        Get paths to the index files for the given algorithm and libraries.

        Returns:
            Tuple of (index_prefix, fasta_path)

        Raises:
            ValueError if index doesn't exist (call create_index first)
        """
        index_key = self._compute_index_key(algorithm, library_paths)

        with self._lock:
            if not self.has_index(algorithm, library_paths):
                raise ValueError(f"No index exists for {algorithm} with given libraries")

            # update access time (move to end of OrderedDict)
            if index_key in self._access_order:
                self._access_order.move_to_end(index_key)
                self._access_order[index_key] = time.time()

            info = self._metadata.indexes[index_key]
            info.last_accessed = time.time()
            self.library_cache._save_metadata()

            return info.index_path, info.fasta_path

    def create_index(self, algorithm: str, library_paths: List[str]) -> Tuple[str, str]:
        """
        Create an index for the given algorithm and libraries.

        If an index already exists and is valid, returns the existing paths.
        Otherwise, creates a new index (evicting oldest if at capacity).

        The expensive part -- writing the FASTA and shelling out to
        makeblastdb/bwa index -- runs OUTSIDE the cache lock, in a scratch
        directory, and the finished index is moved into place under the lock.
        Building under the lock meant one user's index build froze every cache
        operation server-wide (other users' hash lookups, document reads, index
        hits) for its whole duration, which on a 4-thread server is most of the
        way to a stall. A per-key build lock still ensures two callers needing
        the same index build it once.

        Returns:
            Tuple of (index_prefix, fasta_path)
        """
        # check if valid index already exists
        if self.has_index(algorithm, library_paths):
            return self.get_index_paths(algorithm, library_paths)

        index_key = self._compute_index_key(algorithm, library_paths)

        # One builder per index key. Callers wanting *different* indexes proceed
        # in parallel; callers wanting the same one queue here, and the loser
        # finds it already built by the re-check below.
        with self._lock:
            build_lock = self._build_locks.setdefault(index_key, threading.Lock())

        with build_lock:
            # Someone may have finished it while we waited for the build lock.
            if self.has_index(algorithm, library_paths):
                return self.get_index_paths(algorithm, library_paths)

            index_dir = self._get_index_dir(index_key)
            staging_dir = Path(tempfile.mkdtemp(prefix=f".build_{index_key}_",
                                                dir=str(self.cache_dir)))
            try:
                staged_fasta = str(staging_dir / "library.fasta")
                staged_prefix = str(staging_dir / "index")

                # Reading the library documents needs the cache lock; building
                # does not.
                with self._lock:
                    library_docs = self.library_cache.get_documents_for_libraries(library_paths)
                    library_hashes = [
                        self.library_cache.get_library_hash(p)
                        for p in sorted(library_paths)
                    ]

                extractor = FeatureExtractor(library_docs)
                extractor.write_fasta(staged_fasta)

                # An empty FASTA makes makeblastdb (and bwa/minimap2) fail with a
                # bare non-zero exit status, which surfaces to the user as an
                # unreadable CalledProcessError. It means the selected libraries
                # yielded no sequences at all -- typically a SynBioHub collection
                # that came back as a bare Collection shell (members not
                # resolvable), not real parts.
                if os.path.getsize(staged_fasta) == 0:
                    names = ', '.join(os.path.basename(p) for p in library_paths)
                    raise ValueError(
                        f"No DNA sequences could be extracted from the selected "
                        f"librar{'y' if len(library_paths) == 1 else 'ies'} ({names}). "
                        f"A SynBioHub collection whose members are not accessible "
                        f"returns only the collection itself, with no parts in it. "
                        f"Check that the collection contains parts you have access to."
                    )

                algo_map = {
                    'bwa': 'bwa',
                    'minimap2': 'minimap2',
                    'blastn': 'blast',
                    'blast': 'blast'
                }
                tool_name = algo_map.get(algorithm.lower(), algorithm.lower())
                # The slow part, deliberately outside self._lock.
                extractor.build_index(staged_fasta, staged_prefix, tool_name)

                # Publish: evict if needed, then move the finished index in.
                with self._lock:
                    self._evict_oldest()
                    if index_dir.exists():
                        shutil.rmtree(index_dir, ignore_errors=True)
                    staging_dir.rename(index_dir)
                    staging_dir = None  # ownership transferred

                    fasta_path = str(index_dir / "library.fasta")
                    index_prefix = str(index_dir / "index")

                    now = time.time()
                    self._metadata.indexes[index_key] = IndexInfo(
                        algorithm=algorithm,
                        library_hashes=library_hashes,
                        combined_hash=index_key,
                        index_path=index_prefix,
                        fasta_path=fasta_path,
                        created_at=now,
                        last_accessed=now,
                        library_files=list(library_paths)
                    )
                    self._access_order[index_key] = now
                    self.library_cache._save_metadata()

                print(f"Created index: {index_key} for {algorithm} with {len(library_paths)} libraries")
                return index_prefix, fasta_path
            finally:
                if staging_dir is not None:
                    shutil.rmtree(str(staging_dir), ignore_errors=True)

    def get_or_create_index(self, algorithm: str, library_paths: List[str]) -> Tuple[str, str]:
        """
        Get existing index or create new one.

        This is the main entry point for getting index paths.
        """
        if self.has_index(algorithm, library_paths):
            return self.get_index_paths(algorithm, library_paths)
        return self.create_index(algorithm, library_paths)

    def remove_indexes_for_library(self, library_path: str) -> int:
        """Drop every index built from this library.

        An index outlives its source library otherwise: they were pruned on
        independent clocks, and the leftover index then made has_index() raise
        FileNotFoundError on the next request. An index is derived data, so
        removing it alongside its input is always safe.
        """
        target = os.path.abspath(library_path)
        with self._lock:
            keys = [k for k, info in self._metadata.indexes.items()
                    if any(os.path.abspath(p) == target for p in info.library_files)]
            for key in keys:
                if self._pinned.get(key):
                    continue          # in use; the next sweep will get it
                self._remove_index(key)
            return len(keys)

    def prune_expired(self, ttl_seconds: int = None) -> int:
        """Remove indexes not accessed within the TTL. Pinned ones are skipped."""
        ttl = CACHE_TTL_SECONDS if ttl_seconds is None else ttl_seconds
        cutoff = time.time() - ttl
        count = 0
        with self._lock:
            for key in [k for k, info in list(self._metadata.indexes.items())
                        if info.last_accessed < cutoff and not self._pinned.get(k)]:
                self._remove_index(key)
                count += 1
        return count

    @contextmanager
    def pin_index(self, algorithm: str, library_paths: List[str]):
        """Hold an index against eviction for the duration of a block.

        get_or_create_index returns bare paths and releases the lock immediately,
        but the aligner then reads those files for a long time with no lock held.
        Wrap the alignment in this so a concurrent create_index cannot rmtree the
        directory out from under a running BWA/Minimap2/BLASTN.
        """
        index_key = self._compute_index_key(algorithm, library_paths)
        with self._lock:
            self._pinned[index_key] = self._pinned.get(index_key, 0) + 1
        try:
            yield
        finally:
            with self._lock:
                remaining = self._pinned.get(index_key, 1) - 1
                if remaining > 0:
                    self._pinned[index_key] = remaining
                else:
                    self._pinned.pop(index_key, None)

    def get_cache_stats(self) -> dict:
        """Get statistics about the index cache."""
        with self._lock:
            return {
                "total_indexes": len(self._metadata.indexes),
                "max_indexes": self.max_indexes,
                "cache_dir": str(self.cache_dir),
                "indexes": [
                    {
                        "key": key,
                        "algorithm": info.algorithm,
                        "libraries": len(info.library_files),
                        "created": info.created_at,
                        "last_accessed": info.last_accessed
                    }
                    for key, info in self._metadata.indexes.items()
                ]
            }

    def clear_cache(self):
        """Clear all indexes from cache."""
        with self._lock:
            # remove all index directories
            if self.cache_dir.exists():
                for item in self.cache_dir.iterdir():
                    if item.is_dir():
                        try:
                            shutil.rmtree(item)
                        except OSError:
                            pass

            self._metadata.indexes.clear()
            self._access_order.clear()
            self.library_cache._save_metadata()
            print("Cleared all indexes from cache")


# global instances (initialized in app.py)
_library_cache: Optional[LibraryCache] = None
_index_manager: Optional[IndexManager] = None


def start_cache_janitor(library_cache: "LibraryCache", index_manager: "IndexManager",
                        interval_seconds: int = None) -> threading.Thread:
    """Run prune_expired on a timer, in a daemon thread.

    Daemon so it never holds up shutdown; exceptions are swallowed and retried
    next tick, because a failed cleanup must not take the server down with it.
    """
    interval = JANITOR_INTERVAL_SECONDS if interval_seconds is None else interval_seconds

    def loop():
        while True:
            time.sleep(interval)
            try:
                library_cache.prune_expired(index_manager)
            except Exception as e:
                print(f"Cache janitor pass failed (will retry): {e}")

    thread = threading.Thread(target=loop, name="cache-janitor", daemon=True)
    thread.start()
    print(f"Cache janitor started: every {interval // 60} min, "
          f"TTL {CACHE_TTL_SECONDS // 3600}h")
    return thread


def init_cache(cache_dir: str = DEFAULT_CACHE_DIR, max_indexes: int = DEFAULT_MAX_INDEXES):
    """Initialize global cache instances."""
    global _library_cache, _index_manager

    _library_cache = LibraryCache(cache_dir)
    _index_manager = IndexManager(_library_cache, cache_dir, max_indexes)

    _library_cache._index_manager = _index_manager
    return _library_cache, _index_manager


def get_library_cache() -> LibraryCache:
    """Get the global LibraryCache instance."""
    if _library_cache is None:
        raise RuntimeError("Cache not initialized. Call init_cache() first.")
    return _library_cache


def get_index_manager() -> IndexManager:
    """Get the global IndexManager instance."""
    if _index_manager is None:
        raise RuntimeError("Cache not initialized. Call init_cache() first.")
    return _index_manager
