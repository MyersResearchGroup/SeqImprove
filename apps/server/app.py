from typing import Optional, List
from flask import Flask, request
from flask_cors import CORS
from flask_api import status
# from quart import Quart
import sbol2
import logging
import os
import json
import subprocess
import tempfile
import requests
import re
from sequences_to_features import FeatureAnnotater, load_sbol, FeatureLibrary, download_sequences
from sequences_to_features.Annotator import SAMFeatureMapper, TableFeatureMapper
from sequences_to_features.FeatureAnnotatorBase import FeatureAnnotatorSimple
from sequences_to_features.FeatureExtractor import FeatureExtractor
from sequences_to_features import BwaAligner, Minimap2Aligner, BlastAligner
from waitress import serve

# import caching system
from library_cache import (
    init_cache, get_library_cache, get_index_manager,
    LibraryCache, IndexManager
)

uris = []
sbh_file_prefixes = []

# cache instances — initialized in setup(), used throughout the app
library_cache: LibraryCache = None
index_manager: IndexManager = None

# FlashText FeatureLibrary dict (keyed by path or SynBioHub URL)
# For alignment algorithms, use library_cache.get_feature_library_for_subset() instead
FEATURE_LIBRARIES = {}

def setup():
    print("Initializing the app...")
    # set pySBOL configuration parameters
    sbol2.setHomespace('http://seqimprove.synbiohub.org')
    sbol2.Config.setOption('validate', True)
    sbol2.Config.setOption('sbol_typed_uris', False)

    # steps 1-2 — initialize caching system, read XML → SBOL docs + FeatureLibraries (kept forever)
    global library_cache, index_manager
    library_cache, index_manager = init_cache(
        cache_dir="./.cache/seqimprove",
        max_indexes=10
    )

    # preload all feature libraries: XML → SBOL Documents → FeatureLibraries (permanent)
    feature_libraries_dir = "./assets/synbict/feature-libraries"
    print(f"Preloading libraries from {feature_libraries_dir}...")
    library_cache.preload_libraries(feature_libraries_dir)

    # populate FlashText FEATURE_LIBRARIES dict from the permanent cache
    for name, abs_path in library_cache._library_name_map.items():
        FEATURE_LIBRARIES[abs_path] = library_cache.get_feature_library(abs_path)

    print(f"Loaded {len(FEATURE_LIBRARIES)} libraries into cache")
    print(f"Available libraries: {library_cache.get_available_library_names()}")

    # read in collections from synbiohub
    sbh_collections = "https://synbiohub.org/rootcollections"
    try:
        sbhresponse = requests.get(sbh_collections, timeout=10)
    except requests.exceptions.RequestException as e:
        print(f"Warning: Could not connect to SynBioHub: {e}")
        return

    # extract uris from json
    if sbhresponse.status_code == 200:
        sbh_str = json.dumps(sbhresponse.json())
        sbh_data = json.loads(sbh_str)

        global uris
        global sbh_file_prefixes

        uris = [item['uri'] for item in sbh_data]
        sbh_file_prefixes = [item['displayId'] for item in sbh_data]

        # remove large part libraries that break the http requests
        for uri in ['https://synbiohub.org/public/bsu/bsu_collection/1',
              'https://synbiohub.org/public/igem/igem_collection/1',
              'https://synbiohub.org/public/iGEMDistributions/iGEMDistributions_collection/1',
              'https://synbiohub.org/public/igem_feature_libraries/igem_feature_libraries_collection/1']:
            if uri in uris:
                uris.remove(uri)

        for sbh_file_prefix in ['bsu_collection',
                                'igem_collection',
                                'iGEMDistributions_collection',
                                'igem_feature_libraries_collection']:
            if sbh_file_prefix in sbh_file_prefixes:
                sbh_file_prefixes.remove(sbh_file_prefix)
    else:
        print(f"Failed to retrieve data from SynBioHub: {sbhresponse.status_code}")

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

# only retrieves feature library that already exists after setup
# might create a libarary in the future
def create_feature_library(part_library_file_name):
    if ('synbiohub.org' in part_library_file_name): #if url, return the obj if indexed with url(sbh downloads only)
        if part_library_file_name in FEATURE_LIBRARIES:
            return FEATURE_LIBRARIES[part_library_file_name]
        else: #for locally stored sbh collections(indexed with file name for annotation)
            if part_library_file_name in uris:
                uri_index = uris.index(part_library_file_name)
                part_library_file_name = sbh_file_prefixes[uri_index] + '.xml'

    feature_libraries_dir = "./assets/synbict/feature-libraries"
    feature_library_path = os.path.join(feature_libraries_dir, part_library_file_name)
    return FEATURE_LIBRARIES[feature_library_path]

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
    # find the primary component definition (the one we want to annotate)
    # it should be the one with a sequence that's NOT a variant (_v\d+)
    primary_comp = None
    for comp_def in target_doc.componentDefinitions:
        # skip variants created by previous annotation runs
        if re.search(r'_v\d+', comp_def.displayId):
            continue
        # check if this component has a sequence
        if comp_def.sequences and len(comp_def.sequences) > 0:
            primary_comp = comp_def
            break

    if primary_comp is None:
        # fallback: just take the first non-variant component
        for comp_def in target_doc.componentDefinitions:
            if not re.search(r'_v\d+', comp_def.displayId):
                primary_comp = comp_def
                break

    if primary_comp is None and len(target_doc.componentDefinitions) > 0:
        primary_comp = target_doc.componentDefinitions[0]

    if primary_comp is None:
        return target_doc

    # clear existing sequence annotations and sub-components from the primary component
    # this gives SYNBICT a clean slate to work with
    annotations_to_remove = list(primary_comp.sequenceAnnotations)
    for anno in annotations_to_remove:
        try:
            primary_comp.sequenceAnnotations.remove(anno.identity)
        except Exception:
            pass

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

def run_synbict_all(sbol_content: str, library_paths: list[str], exact_match: bool, algorithm: str, index_prefix: str) -> tuple[Optional[int], Optional[str], Optional[List]]:
    """
    Run annotation with alignment-based algorithms (BWA, Minimap2, BLASTN).

    Pipeline:
      step 3: Index (cached by algorithm + library subset -> handled by IndexManager)
      step 4: Align query against index -> temp files (cleaned up after)
      step 5: Parse alignment -> SBOL annotations (uses FeatureLibrary from step 2)

    Args:
        sbol_content: Target SBOL XML string (from user)
        library_paths: Absolute paths to selected library files
        exact_match: If True, require exact matches; if False, allow ≥95% identity
        algorithm: One of 'BWA', 'Minimap2', 'BLASTN'
        index_prefix: Path prefix for the cached index files
    """
    algo_normalized = algorithm.lower()

    # step 2 — get FeatureLibrary from permanent cache
    # exact matches are read-only on library docs -> use permanent cache
    # similar matches mutate library docs (variant creation) -> use fresh copies from XML cache
    if exact_match:
        feature_library = library_cache.get_feature_library_for_subset(library_paths)
    else:
        feature_library = library_cache.get_fresh_feature_library_for_subset(library_paths)

    # parse target SBOL content (from user, temporary)
    target_doc = sbol2.Document()
    try:
        target_doc.readString(sbol_content)
    except Exception as e:
        return status.HTTP_400_BAD_REQUEST, f'Could not parse sbol_content: {e}', None

    # clean the target document to remove existing annotations from previous runs
    target_doc = clean_target_document(target_doc)

    min_feature_length = 10

    try:
        # step 4 — align query to temp directory (not index cache dir)
        with tempfile.TemporaryDirectory(prefix="seqimprove_align_") as tmp_dir:
            if algo_normalized == 'bwa':
                output_path = os.path.join(tmp_dir, 'aligned.sam')
                aligner = BwaAligner(index_prefix)
                aligner.align(target_doc, output_path, exact_match)
                mapper = SAMFeatureMapper(output_path)
            elif algo_normalized == 'minimap2':
                output_path = os.path.join(tmp_dir, 'aligned.sam')
                aligner = Minimap2Aligner(index_prefix)
                aligner.align(target_doc, output_path, exact_match)
                mapper = SAMFeatureMapper(output_path)
            elif algo_normalized == 'blastn':
                output_path = os.path.join(tmp_dir, 'aligned.txt')
                aligner = BlastAligner(index_prefix)
                aligner.align(target_doc, output_path, exact_match)
                mapper = TableFeatureMapper(output_path)
            else:
                return status.HTTP_400_BAD_REQUEST, f'Algorithm {algorithm} not supported', None

            inline_matches, rc_matches = mapper.extract_matches(min_feature_length, exact_match)
            # temp files cleaned up automatically when TemporaryDirectory exits

        # step 5 — parse alignment into SBOL annotations
        annotator = FeatureAnnotatorSimple(feature_library, inline_matches, rc_matches)
        target_library = FeatureLibrary([target_doc])
        output_library = FeatureLibrary([])

        annotator.annotate(inline_matches, rc_matches, target_library, min_feature_length,
                         in_place=True, output_library=output_library, output_matches=False)

        return None, None, [[target_doc.writeString(), "All_Libraries"]]

    except Exception as e:
        return status.HTTP_500_INTERNAL_SERVER_ERROR, f'Error during annotation: {str(e)}', None

def run_synbict(sbol_content: str, part_library_file_names: list[str]) -> tuple[Optional[int], Optional[str], Optional[str]]:
    anno_lib_assoc = []

    for part_lib_f_name in part_library_file_names:            
        target_doc = sbol2.Document()
        try:
            target_doc.readString(sbol_content)
        except Exception:
            print('Could not parse sbol_content')    
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
                feature_library = create_feature_library(part_lib_f_name)
                print(f"feature library for {part_lib_f_name}: {feature_library}")
                min_feature_length = 10
                annotater = FeatureAnnotater(feature_library, min_feature_length)
                # replace
                min_target_length = 10  
                # replace 
                annotated_identities = annotater.annotate(target_library, min_target_length, in_place=True)

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
    uri_prefix = 'https://seqimprove.synbiohub.org/'
    
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
    namespace = 'https://seqimprove.synbiohub.org'

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

@app.post("/api/cache/clear")
def clear_cache():
    """clear all cached indexes (libraries remain in memory)"""
    if index_manager is None:
        return {"error": "Cache not initialized"}, 500

    index_manager.clear_cache()
    return {"message": "Index cache cleared successfully"}

@app.post("/api/convert/genbanktosbol2")
def genbank_to_sbol2():    
    request_data = request.get_json()
    # need to make sure 'GenBankContent' field exists before doing this:
    print("BEGINNING CONVERSION")
    if ('GenBankContent' in request_data):
        genbank_content = request_data['GenBankContent']
        uri_prefix = 'https://seqimprove.synbiohub.org/'  
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

    # get algorithm and match parameters
    algorithm = request_data.get('algorithm', 'FlashText')
    allow_similar_matches = request_data.get('allowSimilarMatches', False)
    codon_matches = request_data.get('codonMatches', False)
    include_hypothetical = request_data.get('includeHypothetical', False)

    if clean_document:
        sbol_content = run_synbio2easy(sbol_content)

    print(f"Running SYNBICT with algorithm={algorithm}, allow_similar_matches={allow_similar_matches}, codon_matches={codon_matches}, include_hypothetical={include_hypothetical}...")

    try:
        if algorithm == 'FlashText':
            # use original flashtext-based method
            error_code, error_message, anno_lib_assoc = run_synbict(sbol_content, part_library_file_names)
        else:
            # resolve library names to absolute paths via LibraryCache
            feature_libraries_dir = "./assets/synbict/feature-libraries"
            library_paths, skipped = library_cache.resolve_library_paths(
                part_library_file_names, library_dir=feature_libraries_dir
            )

            if not library_paths:
                return {"sbol": sbol_content, "error_message": "No valid local libraries selected. Alignment algorithms (BWA, Minimap2, BLASTN) require local library files."}, status.HTTP_400_BAD_REQUEST

            if skipped:
                print(f"Skipped non-local libraries: {skipped}")

            # step 3 — get or create cached index (keyed by algorithm + library subset hash)
            index_prefix, fasta_path = index_manager.get_or_create_index(algorithm, library_paths)

            # steps 4-5 — align + annotate
            exact_match = not allow_similar_matches
            error_code, error_message, anno_lib_assoc = run_synbict_all(
                sbol_content, library_paths, exact_match, algorithm, index_prefix
            )

        if error_code:
            return {"sbol": sbol_content, "error_message": error_message}, error_code

    except Exception as e:
        print("Caught exception")
        print(str(e))
        import traceback
        traceback.print_exc()
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
    
    headers = {
        "Accept": "text/plain",
        "X-authorization": SBHSessionToken
    }

    response = requests.get(collectionURL, headers=headers)

    # Check if the request was successful
    if response.status_code == 200:
        feature_doc = sbol2.Document()
        feature_doc.readString(response.text)
        FEATURE_LIBRARIES[collectionURL] = FeatureLibrary([feature_doc])
        print(f"all libraries: {FEATURE_LIBRARIES.keys()}")
        
        return {"response": response.text}
    else:
        print(f"Request failed with status code: {response.status_code}")
        return {"response": response.text}

@app.post("/api/deleteUserLibrary")
def remove_library():
    request_data = request.get_json()
    collectionURL = request_data['url']

    if FEATURE_LIBRARIES[collectionURL]: del FEATURE_LIBRARIES[collectionURL]
    else: return {"response": "Library does not exist"}

    print(f"\nupdated libraries: {FEATURE_LIBRARIES.keys()}")

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
    serve(app, host="0.0.0.0", port=8080)
