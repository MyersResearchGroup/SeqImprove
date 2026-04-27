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
import shutil
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Set
import sbol2

from sequences_to_features import FeatureLibrary
from sequences_to_features.FeatureExtractor import FeatureExtractor


# configuration
DEFAULT_CACHE_DIR = "./.cache/seqimprove"
DEFAULT_MAX_INDEXES = 10
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
        self._subset_feature_libraries: Dict[frozenset, FeatureLibrary] = {}  # frozenset(paths) -> merged FeatureLibrary
        self._hashes: Dict[str, str] = {}  # abs_path -> content_hash
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
        """Save cache metadata to disk."""
        metadata_path = self.cache_dir / METADATA_FILE
        try:
            with open(metadata_path, 'w') as f:
                json.dump(self._metadata.to_dict(), f, indent=2)
        except IOError as e:
            print(f"Warning: Could not save cache metadata: {e}")

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

    def get_library_hash(self, file_path: str) -> str:
        """Get content hash for a library file, computing if needed."""
        with self._lock:
            abs_path = os.path.abspath(file_path)

            # check if we have a cached hash
            if abs_path in self._hashes:
                # verify file hasn't changed (check mtime as quick check)
                cached_info = self._metadata.libraries.get(abs_path)
                if cached_info:
                    try:
                        current_size = os.path.getsize(abs_path)
                        if current_size == cached_info.file_size:
                            return self._hashes[abs_path]
                    except OSError:
                        pass

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
                cached_info = self._metadata.libraries.get(abs_path)
                if cached_info and cached_info.content_hash == current_hash:
                    # update access time
                    cached_info.last_accessed = time.time()
                    return self._documents[abs_path]

            # load from disk (one-time cost per library)
            doc = sbol2.Document()
            doc.read(abs_path)
            self._documents[abs_path] = doc

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
                cached_info = self._metadata.libraries.get(abs_path)
                if cached_info and cached_info.content_hash == current_hash:
                    cached_info.last_accessed = time.time()
                    return self._feature_libraries[abs_path]

            # load fresh
            doc = self.get_document(abs_path, force_reload)
            feature_lib = FeatureLibrary([doc])
            self._feature_libraries[abs_path] = feature_lib

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
            key = frozenset(os.path.abspath(p) for p in file_paths)

            if key in self._subset_feature_libraries:
                return self._subset_feature_libraries[key]

            docs = self.get_documents_for_libraries(list(key))
            feature_lib = FeatureLibrary(docs)
            self._subset_feature_libraries[key] = feature_lib
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

    def resolve_library_paths(self, names: List[str], library_dir: str = None) -> Tuple[List[str], List[str]]:
        """
        Resolve library display names to absolute file paths.

        Handles:
        - Plain filenames ("iGEM.xml") -> looked up in name map
        - Absolute paths -> returned as-is if they exist
        - SynBioHub URLs -> skipped (returned in second list)

        Returns:
            Tuple of (resolved_paths, skipped_names)
        """
        resolved = []
        skipped = []

        for name in names:
            # skip SynBioHub URLs
            if 'synbiohub.org' in name or name.startswith('http'):
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
                self.get_document(abs_path)
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

        self._lock = threading.RLock()
        self._access_order: OrderedDict[str, float] = OrderedDict()
        self._metadata = library_cache._metadata

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
            lib_hash = self.library_cache.get_library_hash(path)
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

                # get oldest key
                oldest_key = next(iter(self._access_order))

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
                current_hashes.append(self.library_cache.get_library_hash(path))

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

        Returns:
            Tuple of (index_prefix, fasta_path)
        """
        # check if valid index already exists
        if self.has_index(algorithm, library_paths):
            return self.get_index_paths(algorithm, library_paths)

        with self._lock:
            index_key = self._compute_index_key(algorithm, library_paths)

            # evict oldest if at capacity
            self._evict_oldest()

            # create index directory
            index_dir = self._get_index_dir(index_key)
            index_dir.mkdir(parents=True, exist_ok=True)

            fasta_path = str(index_dir / "library.fasta")
            index_prefix = str(index_dir / "index")

            # load library documents
            library_docs = self.library_cache.get_documents_for_libraries(library_paths)

            # extract features and write FASTA
            extractor = FeatureExtractor(library_docs)
            extractor.write_fasta(fasta_path)

            # build index
            algo_map = {
                'bwa': 'bwa',
                'minimap2': 'minimap2',
                'blastn': 'blast',
                'blast': 'blast'
            }
            tool_name = algo_map.get(algorithm.lower(), algorithm.lower())
            extractor.build_index(fasta_path, index_prefix, tool_name)

            # get library hashes
            library_hashes = [
                self.library_cache.get_library_hash(p)
                for p in sorted(library_paths)
            ]

            # update metadata
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

    def get_or_create_index(self, algorithm: str, library_paths: List[str]) -> Tuple[str, str]:
        """
        Get existing index or create new one.

        This is the main entry point for getting index paths.
        """
        if self.has_index(algorithm, library_paths):
            return self.get_index_paths(algorithm, library_paths)
        return self.create_index(algorithm, library_paths)

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


def init_cache(cache_dir: str = DEFAULT_CACHE_DIR, max_indexes: int = DEFAULT_MAX_INDEXES):
    """Initialize global cache instances."""
    global _library_cache, _index_manager

    _library_cache = LibraryCache(cache_dir)
    _index_manager = IndexManager(_library_cache, cache_dir, max_indexes)

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
