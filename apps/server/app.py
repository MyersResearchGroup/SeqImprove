from typing import Optional, List
from flask import Flask, request
from flask_cors import CORS
from flask_api import status
# from quart import Quart
import sbol2
import logging
import os
import asyncio
import json
import subprocess
import tempfile
import requests
import re
from sequences_to_features import download_sequences
from sequences_to_features import FeatureLibrary
from sequences_to_features import FeatureAnnotater
import subprocess
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
    sbh_collections = "https://synbiohub.org/rootcollections"
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
        FEATURE_LIBRARIES[feature_library_path] = FeatureLibrary([feature_doc])

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
    result_sbol_content = ""
    
    # create a temporary file using a context manager    
    with tempfile.NamedTemporaryFile() as file_genbank:
        file_genbank.write(bytes(genbank_content, 'utf-8'))
        file_genbank.seek(0)
        with tempfile.NamedTemporaryFile() as file_sbol:
            command = ["java", "-jar", "libSBOLj-2.4.0-withDependencies.jar", file_genbank.name, "-l", "SBOL2", "-o", file_sbol.name, "-p", uri_prefix]
            output = subprocess.check_output(command, universal_newlines=True, stderr=subprocess.STDOUT)
            print(output)
            result_sbol_content = file_sbol.read().decode('utf-8')
    # files are now closed and removed        
    
    return result_sbol_content

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
    if ('GenBankContent' in request_data and 'uriPrefix' in request_data):
        genbank_content = request_data['GenBankContent']
        uri_prefix = request_data['uriPrefix']
        try:
            sbol2_content = convert_genbank_to_sbol2(genbank_content, uri_prefix)
        except Exception as e:
            print(str(e))
            return {"sbol2_content": "", "err": e}
        else:
            print("CONVERSION SUCCESSFUL")
            return {"sbol2_content": sbol2_content, "err": ""}
        
    else:
        error_message = ""
        if 'GenBankContent' in request_data:
            error_message = "Missing uriPrefix field in request data"
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
        print("Caught exception")
        print(str(e))
        return {"sbol": sbol_content}, status.HTTP_500_INTERNAL_SERVER_ERROR
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

# if __name__ == '__main__':
#     app.run(debug=True,host='0.0.0.0',port=5000)
if __name__ == "__main__":    
    serve(app, host="0.0.0.0", port=8080)
