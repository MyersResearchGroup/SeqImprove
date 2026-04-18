from typing import Optional, List
from flask import Flask, request
from flask_cors import CORS
from flask_api import status
# from quart import Quart
import sbol2
import logging
import os
import asyncio

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)
import json
import subprocess
import tempfile
import requests
import re
from sequences_to_features import download_sequences
from sequences_to_features import FeatureLibrary
from sequences_to_features import FeatureAnnotater
from waitress import serve

FEATURE_FILES = 0
FEATURE_LIBRARY = 1

uris = []
sbh_file_prefixes = []

FEATURE_LIBRARIES = {}
# OLD:
# FEATURE_LIBRARIES = [
#     [[file, file2, file3], featury_library],
#     [[file, file2, file3], featury_library],
# ]
# NEW:
# FEATURE_LIBRARIES = {
#     "file1": featury_library1,
#     "file2": featury_library2,
# }

def setup():
    print("Initializing the app...")
    # Set pySBOL configuration parameters
    sbol2.setHomespace('http://seqimprove.synbiohub.org')
    sbol2.Config.setOption('validate', True)
    sbol2.Config.setOption('sbol_typed_uris', False)

    # read in all feature libraries -- SYNBICT says they support
    # directories, but they actually don't; only lists of files
    feature_libraries_dir = "./assets/synbict/feature-libraries" 
    feature_libraries_paths = asyncio.run(get_feature_libraries_paths(feature_libraries_dir))
    
    # read in collections from synbiohub
    sbh_collections = "https://api.synbiohub.org/rootcollections"
    sbhresponse = requests.get(sbh_collections)

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

    for feature_library_path in feature_libraries_paths:
        print(feature_library_path)
        feature_doc = sbol2.Document()
        feature_doc.read(feature_library_path)
        # FEATURE_LIBRARIES.append([feature_library_path, FeatureLibrary([feature_doc])])
        abs_path = os.path.abspath(feature_library_path)
        FEATURE_LIBRARIES[abs_path] = FeatureLibrary([feature_doc])

    # check for new libraries in synbiohub.org/rootcollections, pull if any exist
    #
    # for index, file_name in enumerate(sbh_file_prefixes):
    #     if("./assets/synbict/feature-libraries/"+file_name+".xml" not in feature_libraries_paths): 
    #         print(f"library {file_name} missing...")
            # print(f"fetching from: {uris[index]}")
            # FEATURE_LIBRARIES[file_name] = sbh_pull_library(uris[index])

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

def create_feature_library(part_library_file_name):
    if ('synbiohub.org' in part_library_file_name):
        # Normalize to canonical URI as the consistent dictionary key (strip api. if present)
        canonical = re.sub(r'^(https?://)api\.', r'\1', part_library_file_name)
        logger.info(f"Creating feature library for: {canonical}")

        # Check if already in cache (user-imported or previous on-demand fetch)
        if canonical in FEATURE_LIBRARIES:
            logger.info(f"Library '{canonical}' found in cache.")
            return FEATURE_LIBRARIES[canonical]

        # Check if there's a locally-bundled file for this URI
        # uris always contains canonical synbiohub.org URLs
        # uris is fetched from api.synbiohub.org/rootcollections, 
        # which lists all root collections in synbiohub.org, 
        # including the feature libraries. So if the URI is in uris, 
        # we know it's a synbiohub collection and we can check for a local file. If it's not in uris, then it's either not a synbiohub collection or it's a new one that was added after the server started, and in either case we should try to fetch it on demand.
        if canonical in uris:
            uri_index = uris.index(canonical)
            local_name = sbh_file_prefixes[uri_index] + '.xml'
            feature_libraries_dir = "./assets/synbict/feature-libraries"
            feature_library_path = os.path.abspath(os.path.join(feature_libraries_dir, local_name))
            if os.path.exists(feature_library_path):
                feature_doc = sbol2.Document()
                feature_doc.read(feature_library_path)
                FEATURE_LIBRARIES[canonical] = FeatureLibrary([feature_doc])
                logger.info(f"Loaded local library '{local_name}' for '{canonical}'")
                return FEATURE_LIBRARIES[canonical]

        # Library not in cache — fetch on demand using api.synbiohub.org to bypass Cloudflare
        fetch_url = re.sub(r'^(https?://)(?!api\.)(synbiohub\.org)', r'\1api.\2', canonical)
        logger.info(f"Library '{canonical}' not in cache, fetching on-demand from {fetch_url}")
        try:
            response = requests.get(fetch_url, headers={"Accept": "text/plain"}, timeout=300)
        except requests.exceptions.RequestException as e:
            raise KeyError(f"Library '{canonical}' not in cache and on-demand fetch failed: {e}")
        if response.status_code != 200:
            raise KeyError(f"Library '{canonical}' not in cache and SynBioHub returned HTTP {response.status_code}")
        try:
            feature_doc = sbol2.Document()
            feature_doc.readString(response.text)
            FEATURE_LIBRARIES[canonical] = FeatureLibrary([feature_doc])  # store under canonical key
            logger.info(f"On-demand cached library '{canonical}'")
            return FEATURE_LIBRARIES[canonical]
        except Exception as e:
            raise KeyError(f"Failed to parse on-demand library '{canonical}': {e}")

    feature_libraries_dir = "./assets/synbict/feature-libraries"
    feature_library_path = os.path.abspath(os.path.join(feature_libraries_dir, part_library_file_name))
    if feature_library_path not in FEATURE_LIBRARIES:
        raise KeyError(f"Library not found in cache: '{part_library_file_name}'. "
                       f"Available libraries: {list(FEATURE_LIBRARIES.keys())}")
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

async def get_feature_libraries_paths(feature_libraries_dir) -> str:
    loop = asyncio.get_event_loop()
    feature_files = await loop.run_in_executor(None, os.listdir, feature_libraries_dir)
    feature_library_paths = [os.path.join(feature_libraries_dir, library_file) for library_file in feature_files]
    return feature_library_paths

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

# feature_libraries: list[str]
# def run_synbict(sbol_content: str) -> tuple[Optional[int], Optional[str], Optional[List]]:
def run_synbict(sbol_content: str, part_library_file_names: list[str]) -> tuple[Optional[int], Optional[str], Optional[str]]:
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
                feature_library = create_feature_library(part_lib_f_name)
                print(f"The key of feature library is {part_lib_f_name}")
                min_feature_length = 10
                annotater = FeatureAnnotater(feature_library, min_feature_length)
                min_target_length = 10                
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
    sbol_content = request_data['completeSbolContent']
    part_library_file_names = request_data['partLibraries'] 
    clean_document = request_data['cleanDocument']
    logger.info(f"Annotation request: libraries={part_library_file_names}, clean={clean_document}")
    logger.info(f"Available FEATURE_LIBRARIES keys: {list(FEATURE_LIBRARIES.keys())}")

    if clean_document: 
        sbol_content = run_synbio2easy(sbol_content)

    print("Running SYNBICT...")
    # Run SYNBICT
    try:
        # anno_lib_assoc = [
        #     [sbol_xml_annotated, part_lib_file_name],
        #     [sbol_xml_annotated, part_lib_file_name],
        #     ...
        # ]
        error_code, error_message, anno_lib_assoc,  = run_synbict(sbol_content, part_library_file_names)
        
        if (error_code):
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
    similar_parts = find_similar_parts(top_level_uri);
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

    # Use api.synbiohub.org for the HTTP fetch to bypass Cloudflare,
    # which blocks server-to-server requests to synbiohub.org with 403.
    fetch_url = re.sub(r'^(https?://)(?!api\.)(synbiohub\.org)', r'\1api.\2', collectionURL)
    logger.info(f"Importing library from: {fetch_url}")
    try:
        response = requests.get(fetch_url, headers=headers, timeout=300)
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to connect to SynBioHub for '{fetch_url}': {e}")
        return {"error": f"Could not connect to SynBioHub: {e}"}, status.HTTP_502_BAD_GATEWAY

    # Check if the request was successful
    if response.status_code == 200:
        try:
            feature_doc = sbol2.Document()
            feature_doc.readString(response.text)
            FEATURE_LIBRARIES[collectionURL] = FeatureLibrary([feature_doc])
            logger.info(f"Imported library URI '{collectionURL}'. All libraries: {list(FEATURE_LIBRARIES.keys())}")
            return {"success": True, "cachedUrl": collectionURL, "librariesInCache": list(FEATURE_LIBRARIES.keys())}
        except Exception as e:
            logger.error(f"Failed to parse SBOL from '{collectionURL}': {e}", exc_info=True)
            return {"error": f"Failed to parse library SBOL: {e}"}, status.HTTP_500_INTERNAL_SERVER_ERROR
    else:
        logger.error(f"Failed to import library '{collectionURL}': HTTP {response.status_code}")
        return {"error": f"SynBioHub returned HTTP {response.status_code}"}, response.status_code

@app.post("/api/deleteUserLibrary")
def remove_library():
    request_data = request.get_json()
    collectionURL = request_data['url']

    if collectionURL in FEATURE_LIBRARIES:
        del FEATURE_LIBRARIES[collectionURL]
        logger.info(f"Deleted library '{collectionURL}'. Remaining: {list(FEATURE_LIBRARIES.keys())}")
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
    serve(app, host="0.0.0.0", port=8080)
