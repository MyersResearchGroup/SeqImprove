from typing import Optional, List
from flask import Flask, request
from flask_cors import CORS
from flask_api import status
# from quart import Quart
import sbol2
import logging
import inspect
import os
import asyncio
import shutil
import threading
from collections import OrderedDict
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)
import json
import subprocess
import tempfile
import requests
import re, sys
from sequences_to_features import FeatureAnnotater, load_sbol, FeatureLibrary, download_sequences
from sequences_to_features.Annotator import SAMFeatureMapper, TableFeatureMapper, ProkkaTableFeatureMapper
from sequences_to_features.FeatureAnnotatorBase import FeatureAnnotatorSimple
from sequences_to_features.FeatureExtractor import FeatureExtractor
from sequences_to_features import BwaAligner, Minimap2Aligner, BlastAligner, ProkkaAligner, ProkkaParser
from sequences_to_features.ShortFeatureMatcher import ShortFeatureMatcher
from waitress import serve

conda_bin = os.path.expanduser("~/miniconda3/envs/synbict_conda/bin")
prokka_bin = os.environ.get("PROKKA_BIN") or os.path.expanduser("~/miniconda3/envs/synbict_conda/prokka/bin")


# Put conda env bins FIRST so `perl` and `prokka` resolve correctly
os.environ["PATH"] = f"{prokka_bin}:{conda_bin}:" + os.environ["PATH"]

print("Python:", sys.executable)
print("CONDA_PREFIX:", os.environ.get("CONDA_PREFIX"))
print("PATH head:", os.environ.get("PATH","").split(":")[:5])

print("\nwhich prokka:")
subprocess.run(["bash", "-lc", "which prokka && prokka --version"], check=False)

print("\nwhich perl:")
subprocess.run(["bash", "-lc", "which perl && perl -v | head -n 2"], check=False)

print("\nBioPerl hmmer3 module check:")
subprocess.run(["bash", "-lc", "perl -MBio::SearchIO::hmmer3 -e 'print \"OK\\n\"'"], check=False)

# Only for a SYNBICT whose ProkkaAligner predates output_dir: that one always
# uses ./database_protein.fasta and ./PROKKA_SYNBICT/, so concurrent runs would
# clobber each other and must be serialized. See _run_prokka.
_prokka_lock = threading.Lock()
# True when the installed SYNBICT lets each Prokka run use its own directory.
_PROKKA_HAS_OUTPUT_DIR = "output_dir" in inspect.signature(ProkkaAligner.__init__).parameters

# import caching system
import identity
from library_cache import (
    init_cache, get_library_cache, get_index_manager,
    start_cache_janitor, LibraryCache, IndexManager
)

# cache instances — initialized in setup(), used throughout the app
library_cache: LibraryCache = None
index_manager: IndexManager = None

# FlashText FeatureLibrary dict (keyed by path or SynBioHub URL)
# For alignment algorithms, use library_cache.get_feature_library_for_subset() instead
FEATURE_LIBRARIES = {}
# FEATURE_LIBRARIES is mutated by /api/importUserLibrary and /api/deleteUserLibrary
# while annotation requests read it, on a multi-threaded waitress server. Without
# this a check-then-read ("is it cached?" -> FEATURE_LIBRARIES[url]) can KeyError
# when another request deletes the entry in between.
_feature_libraries_lock = threading.RLock()


# Remote libraries held in memory for the FlashText path. Local libraries are
# preloaded at startup and are a fixed set, but imported SynBioHub collections
# accumulate one entry per (user, collection) with nothing to evict them -- a
# slow leak that grows with every user. Bound just the remote ones.
# Entries here are now references into LibraryCache, not private copies, and a
# FeatureLibrary is a thin index over its Documents -- measured at +0.1 MB for
# four libraries. The memory lives in the sbol2.Document (~15-20x the XML), which
# LibraryCache owns and bounds via SEQIMPROVE_MAX_CACHED_LIBRARIES. So this cap
# is really about keeping the dict itself tidy, not about RAM.
# Override with SEQIMPROVE_MAX_REMOTE_LIBRARIES.
MAX_REMOTE_FEATURE_LIBRARIES = int(os.environ.get("SEQIMPROVE_MAX_REMOTE_LIBRARIES", "32"))
_remote_library_order: "OrderedDict[str, None]" = OrderedDict()


def _remember_remote_library(key: str) -> None:
    """Record a remote library as most-recently-used, evicting past the cap.

    Caller must hold _feature_libraries_lock.
    """
    _remote_library_order.pop(key, None)
    _remote_library_order[key] = None
    while len(_remote_library_order) > MAX_REMOTE_FEATURE_LIBRARIES:
        oldest, _ = _remote_library_order.popitem(last=False)
        FEATURE_LIBRARIES.pop(oldest, None)
        logger.info("Evicted least-recently-used remote library from memory")


def _library_key(url: str, principal: str = None) -> str:
    """Cache key for a remote library, partitioned the same way as disk.

    Public collections keep a bare-URL key so all users share one entry. A
    private one is namespaced by its owner: keying it by URL alone meant the
    parts one user fetched with their token were returned to anyone else who
    named the same URL.
    """
    canonical = identity.canonical_url(url)
    partition, shared = identity.partition_for(canonical, principal)
    return canonical if shared else f"{partition}\x00{canonical}"


def _principal_from_request(request_data: dict) -> str:
    """Resolve the caller from the SynBioHub session they already hold.

    Returns None for an anonymous caller, who may only touch public libraries.
    """
    return identity.resolve_principal(
        request_data.get('sessionToken') or None,
        request_data.get('synBioHubUrlPrefix') or None,
    )

# Homespace SeqImprove mints its URIs under. Single source of truth -- it is the
# pySBOL2 homespace, the SynBio2Easy cleaning namespace, and the URI prefix given
# to the SBOL validator when converting GenBank.
# Shortest library feature that may be annotated (#208). 9 bp is SYNBICT's own
# ShortFeatureMatcher floor -- below that a motif is too short to be specific --
# so defaulting here keeps the web app and the annotator in agreement. Note this
# means the short-feature pass runs by default. SYNBICT's CLI default is 40.
DEFAULT_MIN_FEATURE_LENGTH = 9
# Longest feature handled by the exhaustive short-feature search; the aligners
# take over from SHORT_FEATURE_MAX_LENGTH + 1 upward. Matches SYNBICT's split.
SHORT_FEATURE_MAX_LENGTH = 13
# Shortest *target* sequence worth annotating -- a different thing from
# min_feature_length, which bounds the library feature. SYNBICT's
# annotate() calls this parameter min_target_length. Any real plasmid clears it;
# it exists to skip degenerate targets.
MIN_TARGET_LENGTH = 10

HOMESPACE = 'https://seqimprove.org'
HOMESPACE_PREFIX = HOMESPACE + '/'

def setup():
    print("Initializing the app...")

    # There are several SYNBICT checkouts on a typical dev box (the standalone
    # clone, a nested copy under the SeqImprove repo, old pip/egg installs) and
    # they carry different function signatures. Log which one actually got
    # imported -- a mismatch here shows up much later as a confusing
    # "unexpected keyword argument" from deep inside the annotator.
    import sequences_to_features as _stf
    from sequences_to_features.Annotator import TableFeatureMapper as _TFM
    logger.info("SYNBICT loaded from: %s", getattr(_stf, "__file__", "?"))
    logger.info("TableFeatureMapper.extract_matches%s",
                inspect.signature(_TFM.extract_matches))
    # set pySBOL configuration parameters
    sbol2.setHomespace(HOMESPACE)
    sbol2.Config.setOption('validate', True)
    sbol2.Config.setOption('sbol_typed_uris', False)

    # steps 1-2 — initialize caching system, read XML → SBOL docs + FeatureLibraries (kept forever)
    global library_cache, index_manager
    library_cache, index_manager = init_cache(
        cache_dir="./.cache/seqimprove",
    )
    # One-time cleanup of caches written before downloads were partitioned by
    # owner: private collections then landed in the shared area, where nothing
    # reads them any more and the janitor does not look.
    library_cache.migrate_shared_private_downloads()

    # Age out private downloads and indexes on a timer. The count caps only fire
    # when exceeded, so without this a quiet server keeps one user's private
    # library and its index forever.
    start_cache_janitor(library_cache, index_manager)

    # preload all feature libraries: XML → SBOL Documents → FeatureLibraries (permanent)
    feature_libraries_dir = "./assets/synbict/feature-libraries"
    print(f"Preloading libraries from {feature_libraries_dir}...")
    library_cache.preload_libraries(feature_libraries_dir)

    # The shipped libraries above are now fully parsed and marked protected in
    # LibraryCache, so they are resident and exempt from the LRU -- that set has
    # to be servable at any moment.
    #
    # FEATURE_LIBRARIES is a separate dict consulted ONLY by the FlashText path;
    # the aligner paths go through library_cache.get_feature_library_for_subset().
    # It is filled lazily by create_feature_library(), which for a local library
    # is just a handoff of the already-parsed object. What stays lazy is the
    # per-user imported libraries, which are unbounded in number.
    print(f"Available libraries: {library_cache.get_available_library_names()}")

app = Flask(__name__) # app = Quart(__name__)
CORS(app)
app.before_first_request(setup)

def create_app():
    return app

#           _______  _        _______  _______  _______        _______  _______ _________          _______  ______   _______ 
# |\     /|(  ____ \( \      (  ____ )(  ____ \(  ____ )      (       )(  ____ \\__   __/|\     /|(  ___  )(  __  \ (  ____ \
# | )   ( || (    \/| (      | (    )|| (    \/| (    )|      | () () || (    \/   ) (   | )   ( || (   ) || (  \  )| (    \/
# | (___) || (__    | |      | (____)|| (__    | (____)|      | || || || (__       | |   | (___) || |   | || |   ) || (_____ 
# |  ___  ||  __)   | |      |  _____)|  __)   |     __)      | |(_)| ||  __)      | |   |  ___  || |   | || |   | |(_____  )
# | (   ) || (      | |      | (      | (      | (\ (         | |   | || (         | |   | (   ) || |   | || |   ) |      ) |
# | )   ( || (____/\| (____/\| )      | (____/\| ) \ \__      | )   ( || (____/\   | |   | )   ( || (___) || (__/  )/\____) |
# |/     \|(_______/(_______/|/       (_______/|/   \__/      |/     \|(_______/   )_(   |/     \|(_______)(______/ \_______)
#
# ===========================================================================================================================
# ===========================================================================================================================

def create_feature_library(part_library_file_name, principal: str = None,
                           session_token: str = None):
    if ('synbiohub.org' in part_library_file_name):
        # The URL identifies the collection; the key identifies the cache slot.
        # They differ for a private library, whose slot is namespaced by owner --
        # keep them apart or the partition prefix ends up in the fetch URL.
        canonical = identity.canonical_url(part_library_file_name)
        key = _library_key(canonical, principal)
        logger.info(f"Creating feature library for: {canonical}")

        # Check if already in cache (user-imported or previous on-demand fetch)
        with _feature_libraries_lock:
            cached = FEATURE_LIBRARIES.get(key)
            if cached is not None:
                _remember_remote_library(key)   # refresh LRU position
        if cached is not None:
            logger.info(f"Library '{canonical}' found in cache.")
            return cached

        # Go through LibraryCache rather than parsing a second private copy.
        # Measured: a FeatureLibrary is a thin index over its Documents and costs
        # almost nothing (+0.1 MB for four libraries), while the Document itself
        # is ~15-20x the XML. Parsing our own here meant the same remote library
        # was held twice whenever both FlashText and an aligner used it -- ~20 MB
        # of duplicate for a 1.3 MB collection. Sharing also brings remote
        # libraries under the same LRU, TTL and update-detection as everything
        # else, instead of pinning a private copy outside all of it.
        path = library_cache.materialize_remote_library(
            canonical, session_token=session_token, principal=principal)
        if not path:
            raise KeyError(f"Library '{canonical}' could not be fetched from SynBioHub "
                           f"(it may be private, or you may not have access)")
        try:
            library = library_cache.get_feature_library(path)
        except Exception as e:
            raise KeyError(f"Failed to parse library '{canonical}': {e}")
        with _feature_libraries_lock:
            FEATURE_LIBRARIES[key] = library
            _remember_remote_library(key)
        logger.info(f"Loaded remote library '{canonical}' via shared cache")
        return library

    feature_libraries_dir = "./assets/synbict/feature-libraries"
    feature_library_path = os.path.abspath(os.path.join(feature_libraries_dir, part_library_file_name))
    with _feature_libraries_lock:
        cached = FEATURE_LIBRARIES.get(feature_library_path)
    if cached is not None:
        return cached

    if not os.path.exists(feature_library_path):
        raise KeyError(f"Library not found: '{part_library_file_name}'. "
                       f"Available libraries: {library_cache.get_available_library_names()}")
    # Parsed on first FlashText use rather than at startup. LibraryCache keeps
    # its own bounded copy, so this is a dict lookup after the first time.
    library = library_cache.get_feature_library(feature_library_path)
    with _feature_libraries_lock:
        # Not LRU-tracked: the shipped libraries are a fixed set of about ten,
        # LibraryCache holds them permanently anyway, and letting them compete
        # with imports for the same slots would evict an import for no gain.
        FEATURE_LIBRARIES[feature_library_path] = library
    return library

def sbh_pull_library(uri):
    feature_doc = sbol2.Document() #reinit
    synbiohub = sbol2.PartShop(uri) #define url with each uri
    
    synbiohub.pull(uri, feature_doc)
    download_sequences(feature_doc, synbiohub)
    print(f"Feature Doc Summary: {feature_doc}")
    
    return feature_doc

def create_temp_file(content):
    try:
        # Create a temporary file
        with tempfile.NamedTemporaryFile(prefix="temp_", suffix=".txt", delete=False) as temp_file:
            # Write data to the temporary file (optional)
            temp_file.write(content)

            # Get the file name of the temporary file
            temp_file_name = temp_file.name
            # Once the 'with' block ends, the temporary file will be automatically deleted.
            return temp_file_name

    except Exception as e:
        print("Error occurred while creating the temporary file:", e)
        return None


# def run_node_script(script_path, arguments):
#     try:
#         # Run the Node.js script and capture the output
#         result = subprocess.check_output(["node", script_path, *arguments], text=True)

#         # Parse the JSON data from the captured output
#         json_data = json.loads(result)

#         return json_data

#     except subprocess.CalledProcessError as e:
#         print("Error occurred while running the Node.js script:", e)
#         return None

def clean_target_document(target_doc: sbol2.Document) -> sbol2.Document:
    """
    Clean a target document by removing existing annotations and extra components.
    This prevents infinite loops in SYNBICT when re-annotating already annotated content.

    The function keeps only the primary component definition (the one we want to annotate)
    and removes everything else that was added by previous annotation runs.
    """
    # Find the target: the ComponentDefinition nothing else points at.
    #
    # SYNBICT now copies the matched library parts into the annotated document so
    # the file is self-contained (SD2E/SYNBICT e91d333), which means the document
    # holds many CDs that all have sequences. Picking "the first CD with a
    # sequence" would then latch onto whichever part happens to come first in
    # iteration order -- and everything not picked is deleted below, so choosing
    # wrong silently destroys the user's plasmid. A library part is always
    # referenced by one of the target's Components; the target is referenced by
    # nobody, and that holds whatever order the CDs are serialized in.
    referenced = {comp.definition
                  for comp_def in target_doc.componentDefinitions
                  for comp in comp_def.components}
    roots = [comp_def for comp_def in target_doc.componentDefinitions
             if comp_def.identity not in referenced
             and not re.search(r'_v\d+', comp_def.displayId)]

    primary_comp = None
    # Prefer a root that carries a sequence -- that is the annotated plasmid.
    for comp_def in roots:
        if comp_def.sequences and len(comp_def.sequences) > 0:
            primary_comp = comp_def
            break

    if primary_comp is None and roots:
        primary_comp = roots[0]

    if primary_comp is None:
        # No unreferenced CD (a malformed or fully circularly-referenced doc):
        # fall back to the old heuristic rather than giving up.
        for comp_def in target_doc.componentDefinitions:
            if re.search(r'_v\d+', comp_def.displayId):
                continue
            if comp_def.sequences and len(comp_def.sequences) > 0:
                primary_comp = comp_def
                break

    if primary_comp is None and len(target_doc.componentDefinitions) > 0:
        primary_comp = target_doc.componentDefinitions[0]

    if primary_comp is None:
        return target_doc

    # Clear the annotations a previous SYNBICT run produced, so re-annotating
    # doesn't compound on itself. A SYNBICT annotation always references a
    # Component (the library part it matched); a bare SequenceAnnotation with no
    # Component came with the uploaded file -- a GenBank import produces exactly
    # those, since GenBank features carry no component identity. Those are the
    # user's own data and must survive re-analysis.
    annotations_to_remove = [anno for anno in primary_comp.sequenceAnnotations
                             if anno.component]
    kept = len(primary_comp.sequenceAnnotations) - len(annotations_to_remove)
    for anno in annotations_to_remove:
        try:
            primary_comp.sequenceAnnotations.remove(anno.identity)
        except Exception:
            pass
    if kept:
        logger.info("clean_target_document: kept %s pre-existing annotation(s) with no Component", kept)

    components_to_remove = list(primary_comp.components)
    for comp in components_to_remove:
        try:
            primary_comp.components.remove(comp.identity)
        except Exception:
            pass

    # remove ALL component definitions except the primary one
    # this includes variants and any other components added by annotation
    comp_defs_to_remove = []
    for comp_def in target_doc.componentDefinitions:
        if comp_def.identity != primary_comp.identity:
            comp_defs_to_remove.append(comp_def.identity)

    for identity in comp_defs_to_remove:
        try:
            target_doc.componentDefinitions.remove(identity)
        except Exception:
            pass

    # also remove any extra sequences that aren't referenced by the primary component
    primary_seq_ids = set(primary_comp.sequences) if primary_comp.sequences else set()
    seqs_to_remove = []
    for seq in target_doc.sequences:
        if seq.identity not in primary_seq_ids:
            seqs_to_remove.append(seq.identity)

    for identity in seqs_to_remove:
        try:
            target_doc.sequences.remove(identity)
        except Exception:
            pass

    return target_doc

def run_synbict_all(sbol_content: str, library_paths: list[str], exact_match: bool, algorithm: str,
                    index_prefix: str, codon_matches: bool = False,
                    include_hypothetical: bool = False,
                    protein_exact_match: bool = True,
                    is_circular: bool = False,
                    dna_identity_threshold: float = 95.0,
                    apply_nms: bool = False,
                    min_feature_length: int = DEFAULT_MIN_FEATURE_LENGTH) -> tuple[Optional[int], Optional[str], Optional[List]]:
    """
    Run annotation with alignment-based algorithms (BWA, Minimap2, BLASTN), with
    optional Prokka augmentation for protein-level matching.

    Pipeline:
      step 3: Index (cached by algorithm + library subset -> handled by IndexManager)
      step 4: Align query against index -> temp files (cleaned up after)
      step 4b (optional): Run Prokka, merge protein-level matches into the result set
      step 5: Parse alignment -> SBOL annotations

    Args:
        sbol_content: Target SBOL XML string (from user)
        library_paths: Absolute paths to selected library files
        exact_match: DNA-level — if True, require exact DNA matches; if False, allow ≥95% identity
        algorithm: One of 'BWA', 'Minimap2', 'BLASTN'
        index_prefix: Path prefix for the cached index files
        codon_matches: If True, also run Prokka and merge its matches (codon-aware annotation)
        include_hypothetical: When codon_matches=True with similar protein matching,
            include hits annotated as "hypothetical protein"
        protein_exact_match: Prokka-level — if True, require 100% protein identity;
            if False, allow ≥95% protein identity
        dna_identity_threshold: Minimum coverage-weighted DNA identity (percent) for a
            hit to be kept. Only consulted when exact_match is False.
        apply_nms: Non-maximum suppression — drop a hit that substantially overlaps a
            higher-scoring one, collapsing each locus to its best part.
        min_feature_length: Shortest library feature that may be annotated. Filters the
            aligner hits, the Prokka pass and the annotator alike.
    """
    algo_normalized = algorithm.lower()

    # step 2 — get FeatureLibrary
    # Variants get created if (a) similar DNA match (DNA mismatch allowed),
    # (b) similar protein match within Prokka, or (c) Prokka augmentation
    # (synonymous codons can yield DNA-different matches).
    # Variant creation needs a mutable doc, so use fresh copies in those cases.
    if codon_matches or not exact_match or not protein_exact_match:
        feature_library = library_cache.get_fresh_feature_library_for_subset(library_paths)
    else:
        feature_library = library_cache.get_feature_library_for_subset(library_paths)

    target_doc = sbol2.Document()
    try:
        target_doc.readString(sbol_content)
    except Exception as e:
        return status.HTTP_400_BAD_REQUEST, f'Could not parse sbol_content: {e}', None

    # clean the target document to remove existing annotations from previous runs
    target_doc = clean_target_document(target_doc)

    # Circular-target support (SYNBICT2 API): if the user marked the sequence
    # circular OR the SBOL ComponentDefinition is typed SO_CIRCULAR, append a
    # prefix the length of the longest feature so origin-spanning hits align
    # as one contiguous block. After mapping, normalize_circular_matches drops
    # duplicate hits in the overlap and rewrites end coords > target_length so
    # the annotator emits a two-Range (wrap-around) SequenceAnnotation.
    from sequences_to_features.sbol_utils import sbol_sequence

    query_seq = None
    target_length = None
    target_cd = target_doc.componentDefinitions[0] if len(target_doc.componentDefinitions) else None
    target_seq = sbol_sequence(target_doc) if target_cd is not None else None
    effective_is_circular = bool(target_cd is not None and (is_circular or sbol2.SO_CIRCULAR in target_cd.types))
    if effective_is_circular and target_cd is not None:
        target_length = len(target_seq)
        max_feature_length = max(
            (len(f.nucleotides) for f in feature_library.features), default=0)
        overlap = max(0, min(max_feature_length - 1, target_length))
        if overlap > 0:
            query_seq = target_seq + target_seq[:overlap]
        # Persist the topology on the doc so downstream annotators preserve it.
        if sbol2.SO_CIRCULAR not in target_cd.types:
            target_cd.types = target_cd.types + [sbol2.SO_CIRCULAR]
        logger.info(f"Annotating {target_cd.displayId} as circular (origin overlap {overlap} bp)")

    # Seed-based aligners cannot report a match shorter than ~14 bp against a
    # plasmid-length query, so SYNBICT's curate() splits the search: the aligner
    # takes [14, inf) and an exhaustive substring search takes
    # [min_feature_length, 13]. app.py previously did neither -- it passed
    # min_feature_length straight to the aligner and ran no short-feature pass,
    # so anything under 14 bp was silently unfindable however low the floor was
    # set. Mirrored here so the minimum-length control means something below 14.
    aligner_min_length = max(min_feature_length, SHORT_FEATURE_MAX_LENGTH + 1)

    try:
        # step 4 — align query to temp directory (not index cache dir)
        with tempfile.TemporaryDirectory(prefix="seqimprove_align_") as tmp_dir:
            # Both mappers accept these -- SAMFeatureMapper gained them so the
            # identity threshold and NMS behave the same on every aligner.
            mapper_kwargs = {'pid_threshold': dna_identity_threshold,
                             'apply_nms': apply_nms}
            if algo_normalized == 'bwa':
                output_path = os.path.join(tmp_dir, 'aligned.sam')
                aligner = BwaAligner(index_prefix)
                aligner.align(target_doc, output_path, exact_match, query_seq=query_seq)
                mapper = SAMFeatureMapper(output_path)
            elif algo_normalized == 'minimap2':
                output_path = os.path.join(tmp_dir, 'aligned.sam')
                aligner = Minimap2Aligner(index_prefix)
                aligner.align(target_doc, output_path, exact_match, query_seq=query_seq)
                mapper = SAMFeatureMapper(output_path)
            elif algo_normalized == 'blastn':
                output_path = os.path.join(tmp_dir, 'aligned.txt')
                aligner = BlastAligner(index_prefix)
                aligner.align(target_doc, output_path, exact_match, query_seq=query_seq)
                mapper = TableFeatureMapper(output_path)
            else:
                return status.HTTP_400_BAD_REQUEST, f'Algorithm {algorithm} not supported', None

            inline_matches, rc_matches = mapper.extract_matches(aligner_min_length, exact_match, **mapper_kwargs)
            # temp files cleaned up automatically when TemporaryDirectory exits

        # Exhaustive exact search for the short features the aligner cannot see.
        # Always exact, in both orientations -- approximate matching of a <14 bp
        # motif is not specific enough to be useful.
        if min_feature_length <= SHORT_FEATURE_MAX_LENGTH and target_seq is not None:
            short_matcher = ShortFeatureMatcher(feature_library,
                                                min_length=min_feature_length,
                                                max_length=SHORT_FEATURE_MAX_LENGTH)
            short_query = query_seq if query_seq is not None else target_seq
            short_inline, short_rc = short_matcher.extract_matches(short_query)
            inline_matches = inline_matches + short_inline
            rc_matches = rc_matches + short_rc
            logger.info("Short-feature pass (%s-%s bp) added %s inline / %s rc matches",
                        min_feature_length, SHORT_FEATURE_MAX_LENGTH,
                        len(short_inline), len(short_rc))

        # Normalize origin-spanning hits back into the circular reference frame.
        if effective_is_circular and query_seq is not None:
            from sequences_to_features.sequences_to_features import normalize_circular_matches
            inline_matches = normalize_circular_matches(inline_matches, target_length)
            rc_matches = normalize_circular_matches(rc_matches, target_length)

        # step 4b — optional Prokka augmentation (codon-aware protein matching).
        # Prokka uses the protein-level exact-match flag, not the DNA-level one.
        if codon_matches:
            prokka_mode = _prokka_mode_for(protein_exact_match, include_hypothetical)
            prokka_inline, prokka_rc = _run_prokka(target_doc, library_paths, prokka_mode, min_feature_length)
            prokka_mapper = ProkkaTableFeatureMapper()
            inline_matches = prokka_mapper.extend_list(inline_matches, prokka_inline)
            rc_matches = prokka_mapper.extend_list(rc_matches, prokka_rc)

        # step 5 — parse alignment into SBOL annotations
        annotator = FeatureAnnotatorSimple(feature_library, inline_matches, rc_matches)
        target_library = FeatureLibrary([target_doc])
        output_library = FeatureLibrary([])

        # 4th positional arg is min_target_length, not min_feature_length -- it
        # gates the target sequence, not the library features. Passing
        # min_feature_length here worked only because plasmids always clear it.
        # in_place=False is what makes FeatureAnnotatorBase.annotate() set
        # copy_definitions, so the matched library ComponentDefinitions (and their
        # Sequences) are copied into the document instead of being left as
        # references to SynBioHub URIs that aren't in the file. Without it the
        # exported SBOL has dangling component->definition references and readers
        # that resolve them -- SBOLCanvas -- fail on it. `in_place` has no other
        # effect in annotate(); annotations still go into this same target_doc.
        annotator.annotate(inline_matches, rc_matches, target_library, MIN_TARGET_LENGTH,
                         in_place=False, output_library=output_library, output_matches=False)

        return None, None, [[target_doc.writeString(), "All_Libraries"]]

    except Exception as e:
        return status.HTTP_500_INTERNAL_SERVER_ERROR, f'Error during annotation: {str(e)}', None

def _prokka_mode_for(exact_match: bool, include_hypothetical: bool) -> str:
    """
    Map UI flags to Prokka's 3 modes.

      exact_match=True             -> 'exact'   (only 100% protein identity; synonymous codons)
      exact_match=False, hyp=False -> 'similar' (keep any identity_pct (including 100%), exclude hypothetical proteins)
      exact_match=False, hyp=True  -> 'all'     (keep every row regardless of identity or product name)
    """
    if exact_match:
        return 'exact'
    elif not include_hypothetical:
        return 'similar'
    else:
        return 'all'

def _run_prokka(target_doc, library_paths, prokka_mode, min_feature_length):
    """
    Run Prokka against the target SBOL doc and extract matches.

    Each call stages its protein database and writes Prokka's output in its own
    temporary directory, so concurrent users run in parallel. A SYNBICT that
    predates ProkkaAligner's output_dir parameter only knows the fixed paths
    ./database_protein.fasta and ./PROKKA_SYNBICT/, so there calls fall back to
    being serialized via _prokka_lock.

    Returns (inline_matches, rc_matches) for merging with the main aligner's results.
    """
    protein_fasta_src = library_cache.get_protein_fasta_path(library_paths)
    if _PROKKA_HAS_OUTPUT_DIR:
        with tempfile.TemporaryDirectory(prefix="prokka_") as workdir:
            database_path = os.path.join(workdir, "database_protein.fasta")
            shutil.copyfile(protein_fasta_src, database_path)
            outdir = Path(workdir) / "out"
            ProkkaAligner(target_doc, output_dir=str(outdir),
                          database_path=database_path).align()
            return _parse_prokka_output(outdir, library_paths, prokka_mode, min_feature_length)

    with _prokka_lock:
        shutil.copyfile(protein_fasta_src, os.path.abspath("./database_protein.fasta"))
        ProkkaAligner(target_doc).align()
        return _parse_prokka_output(Path("PROKKA_SYNBICT"), library_paths, prokka_mode, min_feature_length)

def _gff_has_cds(gff_path):
    with open(gff_path) as gff:
        for line in gff:
            if line.startswith("##FASTA"):
                break
            fields = line.split("\t")
            if len(fields) > 2 and fields[2] == "CDS":
                return True
    return False

def _parse_prokka_output(outdir, library_paths, prokka_mode, min_feature_length):
    gff_path = outdir / "PROKKA_SYNBICT.gff"
    if not gff_path.exists():
        raise RuntimeError("Prokka produced no output (is prokka installed?)")

    blast_files = sorted(outdir.glob("PROKKA_SYNBICT.proteins.tmp.*.blast"))
    if not blast_files:
        # Prokka BLASTs only the proteins it predicts. A sequence with no CDS
        # (a short part, a promoter or terminator) has nothing to search, which
        # means no protein matches -- not a failure. Raising here used to fail
        # the whole annotation and throw away the DNA aligner's hits with it.
        if not _gff_has_cds(gff_path):
            logger.info("Prokka predicted no CDS; no protein matches to add")
            return [], []
        raise RuntimeError("Prokka predicted CDS but produced no BLAST output")

    gff_path = str(gff_path)
    blast_path = str(blast_files[-1])

    final_df = ProkkaParser(gff_path, blast_path).parse_gff_and_blast()

    # Map BLASTP protein IDs (CDS_000001 etc.) back to library component identities
    extractor = library_cache.get_feature_extractor_for_subset(library_paths)
    final_df["ids_sequence"] = [
        extractor.cds_id_map.get(pid) for pid in final_df['protein_id']
    ]

    return ProkkaTableFeatureMapper().extract_matches(
        final_df, min_feature_length=min_feature_length, mode=prokka_mode
    )

def run_synbict(sbol_content: str, part_library_file_names: list[str],
                min_feature_length: int = DEFAULT_MIN_FEATURE_LENGTH,
                principal: str = None, session_token: str = None) -> tuple[Optional[int], Optional[str], Optional[str]]:
    anno_lib_assoc = []

    for part_lib_f_name in part_library_file_names:            
        target_doc = sbol2.Document()
        try:
            target_doc.readString(sbol_content)
        except Exception as e:
            logger.error(f"Could not parse sbol_content: {e}", exc_info=True)
            return status.HTTP_400_BAD_REQUEST, 'Could not parse sbol_content', None
        else:
            # Create a temporary file
            with tempfile.NamedTemporaryFile(prefix="temp_", suffix=".txt", delete=False) as sbol_file_original:
                # Write data to the temporary file (optional)
                sbol_file_original.write(bytes(target_doc.writeString(), "utf-8"))

                # Get the file name of the temporary file
                sbol_file_name_original = sbol_file_original.name

                # Once the 'with' block ends, the temporary file will be automatically deleted.

                target_library = FeatureLibrary([target_doc])
                # feature_library = FEATURE_LIBRARIES[0]
                feature_library = create_feature_library(part_lib_f_name, principal=principal,
                                                        session_token=session_token)
                print(f"The key of feature library is {part_lib_f_name}")
                annotater = FeatureAnnotater(feature_library, min_feature_length)
                annotated_identities = annotater.annotate(target_library, MIN_TARGET_LENGTH, in_place=True)

                # The pySBOL2 library hasn't implemented the necessary functionality to retrieve sequence annotations,
                # so instead I'm serializing the document and grabbing the sequence annotations using the sbolgraph
                # library in javascript in the front end
                anno_lib_assoc.append([target_doc.writeString(), part_lib_f_name])
    return None, None, anno_lib_assoc

def find_similar_parts(top_level_uri):
    try:
        response = requests.get(top_level_uri + "/similar", headers={"Accept": "application/json"}); # synchronous!?
        json_data = response.json()
        return [{'name': similar_part['name'], 'uri': similar_part['uri']} for similar_part in json_data]
                                  
    except requests.exceptions.RequestException as e:
        print("Error occured while making the GET request for similar parts:", e)
        return []
    except Exception as e:
        print("Error occured in find_similar_parts", e)

def flatten(S):
    if S == []:
        return S
    if isinstance(S[0], list):
        return flatten(S[0]) + flatten(S[1:])
    return S[:1] + flatten(S[1:])

def split_into_words(text):
    words = re.split(r'\s+', text)
    return words

def find_ontology_link(id):
    return "https://identifiers.org/" + id
    
def add_terms(anno):
    terms = {}
    for mention in anno['mentions']:
        terms[mention['text']] = True
    terms = list(terms.keys())
    label = terms[0]
    return {**anno, "terms": terms, "label": label}

def run_biobert(text):
    BIOBERT_URL = "http://bern2.korea.ac.kr/plain"
    SEARCH_THRESHOLD = 0.75

    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    data = {"text": text}
    res = requests.post(BIOBERT_URL, headers=headers, data=json.dumps(data)); # synchronous!?
    # make sure response doesn't contani NaN
    res_text = re.sub('NaN', '0', res.text)
    res_json = json.loads(res_text)

    # group grounded terms together
    annotations = res_json['annotations']

    accum = {}
    for anno in annotations:
        for id in anno['id']:            
            mentions = accum[id].get('mentions', []) if id in accum else []
            
            accum[id] = {
                'id': find_ontology_link(id),
                'displayId': id,
                'title': anno.get('title', 'Unknown'),
                'mentions': mentions + [{
                    'text': anno['mention'],
                    'confidence': anno['prob'],
                    'start': anno['span']['begin'],
                    'end': anno['span']['end']
                }]
            }
    annotations = list(accum.values())
    
    # filter out annotations that are "CUI-less" (ungrounded)
    cuiless_terms = flatten(list(map(lambda anno: anno['mentions'], filter(lambda anno: anno['displayId'] == "CUI-less", annotations)))) 
    annotations = list(filter(lambda anno: anno['displayId'] != "CUI-less", annotations))

    # for every annotation, append two keys: terms and label. label is jsut terms[0]
    # terms is just the unique mentions as text. The text property of the mention, for each annotation
    annotations = list(map(add_terms, annotations))

    return annotations

def convert_genbank_to_sbol2(genbank_content, uri_prefix):    
    """
    Convert GenBank content to SBOL2 using the online SBOL Validator API.
    """
    SBOL_VALIDATOR_URL = "https://validator.sbolstandard.org/validate/"
    
    # prepare the request payload 
    request_payload = {
        'options': {
            'language': 'SBOL2',  # output format
            'test_equality': False,
            'check_uri_compliance': False,
            'check_completeness': False,
            'check_best_practices': False,
            'fail_on_first_error': False,
            'provide_detailed_stack_trace': False,
            'subset_uri': '',
            'uri_prefix': uri_prefix,  
            'version': '',
            'insert_type': False,
            'main_file_name': 'genbank_input',
            'diff_file_name': 'comparison file',
        },
        'return_file': True,  # we want the converted content returned
        'main_file': genbank_content
    }
    
    try:
        # make the POST request to the SBOL Validator API
        response = requests.post(
            SBOL_VALIDATOR_URL, 
            json=request_payload,
            headers={'Content-Type': 'application/json'},
            timeout=30  # 30 second timeout
        )
        
        # check if the request was successful
        response.raise_for_status()
        
        # parse the JSON response
        result = response.json()
        
        # check if the conversion was valid
        if not result.get('valid', False):
            error_messages = result.get('errors', ['Unknown validation error'])
            error_text = '\n'.join(error_messages)
            raise Exception(f"SBOL validation failed: {error_text}")
        
        # return the converted SBOL2 content
        if 'result' in result:
            return result['result']
        elif 'output_file' in result:
            # if only output_file URL is provided, fetch the content
            file_response = requests.get(result['output_file'], timeout=30)
            file_response.raise_for_status()
            return file_response.text
        else:
            raise Exception("No converted content found in API response")
            
    except requests.exceptions.Timeout:
        raise Exception("Timeout while contacting SBOL Validator API")
    except requests.exceptions.RequestException as e:
        # log the actual response content for debugging
        if hasattr(e, 'response') and e.response is not None:
            print(f"API request failed - Status: {e.response.status_code}, Content: {e.response.text}")
        raise Exception(f"Network error while contacting SBOL Validator API: {str(e)}")
    except Exception as e:
        raise Exception(f"Error during GenBank to SBOL2 conversion: {str(e)}")

def run_synbio2easy(sbol_content):
    namespace = HOMESPACE

    try:
        with tempfile.NamedTemporaryFile() as input_file:
            input_file.write(bytes(sbol_content, 'utf-8'))
            input_file.flush()
            with tempfile.NamedTemporaryFile() as output_file:

                command = [
                    'java', '-jar', 'SynBio2Easy.jar', 'clean',
                    f'--input-file={input_file.name}',
                    f'--output-file={output_file.name}',
                    f'--namespace={namespace}',
                    f'--remove-collections=Y'
                ]
                print(command)
                output = subprocess.check_output(command, universal_newlines=True, stderr=subprocess.STDOUT)
                print(output)
                cleaned_data = output_file.read().decode('utf-8')
                return cleaned_data
    
    except Exception as e:
        print(e)
        return sbol_content

#  _______  _______ _________     _______  _______          _________ _______  _______ 
# (  ___  )(  ____ )\__   __/    (  ____ )(  ___  )|\     /|\__   __/(  ____ \(  ____ \
# | (   ) || (    )|   ) (       | (    )|| (   ) || )   ( |   ) (   | (    \/| (    \/
# | (___) || (____)|   | |       | (____)|| |   | || |   | |   | |   | (__    | (_____ 
# |  ___  ||  _____)   | |       |     __)| |   | || |   | |   | |   |  __)   (_____  )
# | (   ) || (         | |       | (\ (   | |   | || |   | |   | |   | (            ) |
# | )   ( || )      ___) (___    | ) \ \__| (___) || (___) |   | |   | (____/\/\____) |
# |/     \||/       \_______/    |/   \__/(_______)(_______)   )_(   (_______/\_______)
#
# =====================================================================================
# =====================================================================================

@app.get("/api/boot")
def boot_app():
    print("hi")
    return "Rise and shine"

@app.get("/api/cache/stats")
def cache_stats():
    """get statistics about the library and index cache"""
    if index_manager is None:
        return {"error": "Cache not initialized"}, 500

    stats = index_manager.get_cache_stats()
    stats["libraries_loaded"] = len(library_cache._documents) if library_cache else 0
    return stats

@app.post("/api/convert/genbanktosbol2")
def genbank_to_sbol2():    
    request_data = request.get_json()
    # need to make sure 'GenBankContent' field exists before doing this:
    print("BEGINNING CONVERSION")
    if ('GenBankContent' in request_data):
        genbank_content = request_data['GenBankContent']
        uri_prefix = HOMESPACE_PREFIX
        try:
            sbol2_content = convert_genbank_to_sbol2(genbank_content, uri_prefix)
        except Exception as e:
            print(str(e))
            return {"sbol2_content": "", "err": str(e)}
        else:
            print("CONVERSION SUCCESSFUL")
            return {"sbol2_content": sbol2_content, "err": ""}
        
    else:
        error_message = "Missing GenBankContent field in request data"
        return {"sbol2_content": "", "err": error_message };
    
@app.post("/api/cleanSBOL")
def clean_SBOL():
    request_data = request.get_json()
    sbol_content = request_data['completeSbolContent']

    return {"sbol": run_synbio2easy(sbol_content)}

    

@app.post("/api/annotateSequence")
def annotate_sequence():
    request_data = request.get_json()
    print("Received annotation request")
    sbol_content = request_data['completeSbolContent']
    part_library_file_names = request_data['partLibraries']
    clean_document = request_data['cleanDocument']
    logger.info(f"Annotation request: libraries={part_library_file_names}, clean={clean_document}")
    logger.info(f"Available FEATURE_LIBRARIES keys: {list(FEATURE_LIBRARIES.keys())}")

    # get algorithm and match parameters
    algorithm = request_data.get('algorithm', 'BLASTN')
    allow_similar_dna_matches = request_data.get('allowSimilarDNAMatches', False)
    allow_similar_matches = request_data.get('allowSimilarMatches', False)
    codon_matches = request_data.get('codonMatches', False)
    include_hypothetical = request_data.get('includeHypothetical', False)
    is_circular = request_data.get('isCircular', False)
    # BLASTN-only knobs (#158). Clamp the threshold so a bad client value can't
    # silently disable filtering or reject every hit.
    try:
        dna_identity_threshold = float(request_data.get('dnaIdentityThreshold', 95.0))
    except (TypeError, ValueError):
        dna_identity_threshold = 95.0
    dna_identity_threshold = min(100.0, max(0.0, dna_identity_threshold))
    apply_nms = bool(request_data.get('applyNms', False))
    # Optional: lets a private SynBioHub library be re-fetched when it isn't
    # already on disk. Never logged, never persisted.
    session_token = request_data.get('sessionToken') or None
    # Who is asking. Anonymous callers get None and may only use public
    # libraries; a private collection is filed under its owner's partition.
    principal = _principal_from_request(request_data)
    try:
        min_feature_length = int(request_data.get('minFeatureLength', DEFAULT_MIN_FEATURE_LENGTH))
    except (TypeError, ValueError):
        min_feature_length = DEFAULT_MIN_FEATURE_LENGTH
    # 0 disables the filter in SYNBICT; anything negative is meaningless.
    min_feature_length = max(0, min_feature_length)

    if clean_document:
        sbol_content = run_synbio2easy(sbol_content)

    print(f"Running SYNBICT with algorithm={algorithm}, allow_similar_dna_matches={allow_similar_dna_matches}, allow_similar_matches={allow_similar_matches}, codon_matches={codon_matches}, include_hypothetical={include_hypothetical}, is_circular={is_circular}, dna_identity_threshold={dna_identity_threshold}, apply_nms={apply_nms}, min_feature_length={min_feature_length}...")

    try:
        if algorithm == 'FlashText':
            # use original flashtext-based method
            error_code, error_message, anno_lib_assoc = run_synbict(sbol_content, part_library_file_names,
                                                                     min_feature_length=min_feature_length,
                                                                     principal=principal,
                                                                     session_token=session_token)
        else:
            # resolve library names to absolute paths via LibraryCache
            feature_libraries_dir = "./assets/synbict/feature-libraries"
            library_paths, skipped = library_cache.resolve_library_paths(
                part_library_file_names, library_dir=feature_libraries_dir,
                session_token=session_token, principal=principal
            )

            if not library_paths:
                return {"sbol": sbol_content, "error_message": f"No libraries could be loaded for {algorithm}. Selected: {part_library_file_names}, unresolved: {skipped}"}, status.HTTP_400_BAD_REQUEST

            if skipped:
                logger.warning(f"Could not resolve libraries (skipping): {skipped}")

            # steps 3-5 — build the index, then align + annotate against it.
            # DNA aligner uses similar-DNA flag; Prokka uses similar-protein flag.
            dna_exact_match = not allow_similar_dna_matches
            protein_exact_match = not allow_similar_matches
            # Pin first, then build. pin_index only needs the index *key*, which
            # is derived from the algorithm and the library paths, so it can be
            # taken before the index exists -- and taking it first leaves no
            # window in which another request's create_index could rmtree this
            # directory between us obtaining the paths and starting to read them.
            with index_manager.pin_index(algorithm, library_paths):
                index_prefix, fasta_path = index_manager.get_or_create_index(algorithm, library_paths)
                error_code, error_message, anno_lib_assoc = run_synbict_all(
                    sbol_content, library_paths, dna_exact_match, algorithm, index_prefix,
                    codon_matches=codon_matches, include_hypothetical=include_hypothetical,
                    protein_exact_match=protein_exact_match, is_circular=is_circular,
                    dna_identity_threshold=dna_identity_threshold, apply_nms=apply_nms,
                    min_feature_length=min_feature_length
                )

        if error_code:
            return {"sbol": sbol_content, "error_message": error_message}, error_code

    except Exception as e:
        logger.error(f"Annotation failed for libraries={part_library_file_names}: {e}", exc_info=True)
        return {"sbol": sbol_content, "error_message": str(e)}, status.HTTP_500_INTERNAL_SERVER_ERROR
    else:
        return {"annotations": anno_lib_assoc}

@app.post("/api/findSimilarParts")
def similar_parts():
    top_level_uri = request.get_json()['topLevelUri']
    # find similar parts
    similar_parts = find_similar_parts(top_level_uri)
    return {"similarParts": similar_parts}

@app.post("/api/annotateText")
def annotate_text():
    free_text = request.get_json()['text']
    biobert_result = run_biobert(free_text)
    return {"text": free_text, "annotations": biobert_result}

@app.post("/api/importUserLibrary")
def import_library():
    request_data = request.get_json()
    SBHSessionToken = request_data['sessionToken']
    collectionURL = request_data['url']
    principal = _principal_from_request(request_data)

    # Shares the fetch path with the annotation side: routes via api.synbiohub.org
    # (synbiohub.org blocks server-to-server requests with 403) and falls back to
    # the recursive /sbol endpoint when the bare URI returns a collection with no
    # parts in it, which is what SynBioHub does for a collection URI.
    logger.info(f"Importing library from: {collectionURL}")
    text, http_status = library_cache._fetch_library_sbol(collectionURL, SBHSessionToken)
    if text is None:
        logger.error(f"Failed to import '{collectionURL}': HTTP {http_status}")
        if http_status is None:
            return {"error": "Could not connect to SynBioHub"}, status.HTTP_502_BAD_GATEWAY
        return {"error": f"SynBioHub returned HTTP {http_status}"}, http_status

    if not library_cache._has_parts(text):
        logger.error(f"Import of '{collectionURL}' contained no parts")
        return {"error": "That collection came back with no parts in it. If it is "
                         "a collection of other people's private objects, you may "
                         "not have access to its members."}, status.HTTP_400_BAD_REQUEST

    try:
        # Parse once to confirm it is valid SBOL, then let it go. Building a
        # FeatureLibrary here would hold the whole Document in RAM for a path only
        # FlashText uses -- create_feature_library() builds it on first use.
        feature_doc = sbol2.Document()
        feature_doc.readString(text)
        del feature_doc
        # Stage the SBOL on disk so BLASTN/BWA/Minimap2 can index it without a
        # second (anonymous, possibly failing) fetch. Filed under this caller's
        # partition when the collection is private.
        library_cache.cache_remote_library_content(collectionURL, text,
                                                   principal=principal)
        logger.info(f"Imported library URI '{collectionURL}'")
        # Deliberately does NOT return the full cache listing. That enumerated
        # every library every user had imported, including the URLs of other
        # people's private SynBioHub collections, to whoever happened to import
        # something. Nothing in the frontend used it.
        return {"success": True, "cachedUrl": collectionURL}
    except Exception as e:
        logger.error(f"Failed to parse SBOL from '{collectionURL}': {e}", exc_info=True)
        return {"error": f"Failed to parse library SBOL: {e}"}, status.HTTP_500_INTERNAL_SERVER_ERROR

@app.post("/api/checkLibraryCache")
def check_library_cache():
    request_data = request.get_json()
    url = request_data['url']
    principal = _principal_from_request(request_data)
    canonical = identity.canonical_url(url)
    # Scoped to the caller's own partition. Answering for the global dict turned
    # this into an existence oracle: anyone could probe any URL and learn which
    # private collections other people had imported.
    # Ask the disk cache, not the FlashText dict: the dict is now populated
    # lazily, so an imported library is legitimately absent from it until a
    # FlashText run needs it.
    _c, cached_path, _shared = library_cache._remote_cache_path(canonical, principal)
    return {"cached": cached_path.exists(), "url": canonical}

@app.post("/api/deleteUserLibrary")
def remove_library():
    request_data = request.get_json()
    collectionURL = request_data['url']
    principal = _principal_from_request(request_data)

    # A public collection is one cached copy and one index shared by every
    # user. Removing it is only about this user's list, which the frontend
    # keeps; evicting it here would make everyone else re-download and
    # re-index it. The caps and the janitor reclaim it once it goes unused.
    if identity.is_public(identity.canonical_url(collectionURL)):
        return {"response": "Removed from your list. Public libraries stay cached on the server for other users."}

    # Only ever removes the caller's own entry. Previously any user could delete
    # any library by naming its URL, evicting other people's imports.
    key = _library_key(collectionURL, principal)
    with _feature_libraries_lock:
        present = key in FEATURE_LIBRARIES
        if present:
            del FEATURE_LIBRARIES[key]
            _remote_library_order.pop(key, None)
    # Drop the on-disk copy too. The FlashText dict is populated lazily now, so
    # it is often empty for a library that is very much still cached on disk --
    # deleting only the dict entry would leave the library usable.
    if library_cache.forget_remote_library(collectionURL, principal=principal,
                                           index_manager=index_manager):
        present = True
    if present:
        logger.info(f"Deleted library '{collectionURL}'.")
    else:
        logger.warning(f"Attempted to delete library not in cache: '{collectionURL}'. Available: {list(FEATURE_LIBRARIES.keys())}")
        return {"response": "Library does not exist"}

    return {"response": "Library successfully deleted"}

@app.post("/api/updateDocumentProperties")
def update_document_properties():
    request_data = request.get_json()
    sbol_content = request_data['sbolContent']
    new_title = request_data.get('title')
    new_display_id = request_data.get('displayId')
    new_source = request_data.get('source')

    try:
        
        # create SBOL document using Python sbol2 library
        doc = sbol2.Document()
        doc.readString(sbol_content)
        
        # get the root component definition
        if len(doc.componentDefinitions) > 0:
            root_component = doc.componentDefinitions[0]
            
            # update displayId if provided - must ensure URI consistency for SynBioHub
            if new_display_id is not None:
                old_display_id = root_component.displayId
                
                try:
                    # update displayId
                    root_component.displayId = new_display_id
                    
                    # update the identity URI using sbol2's built-in methods
                    base_uri = 'https://example.com/'
                    new_uri = base_uri + new_display_id + '/1'
                    new_persistent = base_uri + new_display_id
                    
                    # set the new URIs
                    if hasattr(root_component, 'identity'):
                        root_component.identity = new_uri
                    
                    if hasattr(root_component, 'persistentIdentity'):
                        root_component.persistentIdentity = new_persistent
                    
                    # update sequence URIs if they exist to match new displayId
                    sequences_updated = 0
                    try:
                        for i, seq_item in enumerate(doc.sequences):
                            # check if this is a sequence object or URI string
                            if hasattr(seq_item, 'displayId'):
                                # it's a sequence object
                                seq = seq_item
                                new_seq_id = new_display_id + '_seq'
                                
                                # update both displayId and name to match component's new name
                                seq.displayId = new_seq_id
                                
                                # set sequence name to component's new name + '_seq'
                                if new_title:
                                    new_seq_name = new_title + '_seq'
                                    seq.name = new_seq_name
                                
                                # update sequence URIs
                                new_seq_uri = base_uri + new_seq_id + '/1'
                                new_seq_persistent = base_uri + new_seq_id
                                
                                if hasattr(seq, 'identity'):
                                    seq.identity = new_seq_uri
                                if hasattr(seq, 'persistentIdentity'):
                                    seq.persistentIdentity = new_seq_persistent
                                    
                                sequences_updated += 1
                            elif isinstance(seq_item, str):
                                # it's a URI string - need to find the actual sequence object
                                try:
                                    seq_obj = doc.find(seq_item)
                                    if seq_obj and hasattr(seq_obj, 'displayId'):
                                        new_seq_id = new_display_id + '_seq'
                                        
                                        # update both displayId and name to match component's new name
                                        seq_obj.displayId = new_seq_id
                                        
                                        # set sequence name to component's new name + '_seq'
                                        if new_title:
                                            new_seq_name = new_title + '_seq'
                                            seq_obj.name = new_seq_name
                                        
                                        # update sequence URIs
                                        new_seq_uri = base_uri + new_seq_id + '/1'
                                        new_seq_persistent = base_uri + new_seq_id
                                        
                                        if hasattr(seq_obj, 'identity'):
                                            seq_obj.identity = new_seq_uri
                                        if hasattr(seq_obj, 'persistentIdentity'):
                                            seq_obj.persistentIdentity = new_seq_persistent
                                            
                                        sequences_updated += 1
                                except Exception:
                                    pass
                    except Exception:
                        pass
                    
                    # update ComponentDefinition sequence reference to match updated sequence URI
                    if sequences_updated > 0 and hasattr(root_component, 'sequences') and root_component.sequences:
                        new_seq_id = new_display_id + '_seq' 
                        new_seq_reference_uri = base_uri + new_seq_id + '/1'
                        
                        # get the old sequence references
                        old_seq_refs = list(root_component.sequences) if root_component.sequences else []
                        
                        try:
                            # use string manipulation to update sequence reference in XML
                            doc_string = doc.writeString()
                            
                            if old_seq_refs:
                                old_ref_pattern = f'rdf:resource="{old_seq_refs[0]}"'
                                new_ref_pattern = f'rdf:resource="{new_seq_reference_uri}"'
                            
                                if old_ref_pattern in doc_string:
                                    updated_doc_string = doc_string.replace(old_ref_pattern, new_ref_pattern)
                                    
                                    # create new document from updated string
                                    new_doc = sbol2.Document()
                                    new_doc.readString(updated_doc_string)
                                    
                                    # replace original document content
                                    doc.clear()
                                    
                                    # copy all objects from new document to original
                                    if hasattr(new_doc, 'componentDefinitions'):
                                        for comp_def in new_doc.componentDefinitions:
                                            doc.add(comp_def)
                                    if hasattr(new_doc, 'sequences'):
                                        for seq in new_doc.sequences:
                                            doc.add(seq)
                                    if hasattr(new_doc, 'collections'):
                                        for coll in new_doc.collections:
                                            doc.add(coll)
                                    
                                    # fallback if needed
                                    if not doc.componentDefinitions and not doc.sequences:
                                        doc.readString(updated_doc_string)
                        except Exception:
                            pass
                    
                except Exception as e:
                    # fallback to basic displayId update
                    root_component.displayId = new_display_id
            
            # update title if provided, otherwise set to display ID
            current_root = doc.componentDefinitions[0] if len(doc.componentDefinitions) > 0 else None
            if current_root:
                if new_title is not None:
                    current_root.name = new_title
                elif not current_root.name:
                    # if no title exists, set it to the display ID
                    current_root.name = current_root.displayId
            
            # update source if provided (using prov:wasDerivedFrom)
            if new_source is not None:
                # use the Dublin Core source property or PROV-O wasDerivedFrom
                prov_was_derived_from = "http://www.w3.org/ns/prov#wasDerivedFrom"
                root_component.setPropertyValue(prov_was_derived_from, new_source)
            
            # return the updated SBOL content
            updated_sbol = doc.writeString()
            return {"sbolContent": updated_sbol, "error": ""}
        else:
            return {"sbolContent": "", "error": "No component definitions found in document"}
            
    except Exception as e:
        print(f"Error updating document properties: {str(e)}")
        return {"sbolContent": "", "error": f"Failed to update document: {str(e)}"}

# if __name__ == '__main__':
#     app.run(debug=True,host='0.0.0.0',port=5000)
if __name__ == "__main__":    
    serve(app, host="0.0.0.0", port=8080,
          threads=int(os.environ.get("SEQIMPROVE_THREADS", "8")))
