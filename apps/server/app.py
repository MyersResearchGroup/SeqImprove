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
from sequences_to_features import FeatureLibrary
from sequences_to_features import FeatureAnnotater

FEATURE_FILES = 0
FEATURE_LIBRARY = 1

FEATURE_LIBRARIES = []
# FEATURE_LIBRARIES = [
#     [[file, file2, file3], featury_library],
#     [[file, file2, file3], featury_library],
# ]

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

    feature_docs = []
            
    for feature_library_path in feature_libraries_paths:
        print(feature_library_path)
        feature_doc = sbol2.Document()
        feature_doc.read(feature_library_path)
        feature_docs.append(feature_doc)

    feature_library = FeatureLibrary(feature_docs)
    FEATURE_LIBRARIES.append([
        ["Anderson_Promoters_Anderson_Lab_collection.xml",
         "CIDAR_MoClo_Extension_Kit_Volume_I_Murray_Lab_collection.xml",
         "CIDAR_MoClo_Toolkit_Densmore_Lab_collection.xml",
         "EcoFlex_MoClo_Toolkit_Freemont_Lab_collection.xml",
         "Itaconic_Acid_Pathway_Voigt_Lab_collection.xml",
         "MoClo_Yeast_Toolkit_Dueber_Lab_collection.xml",
         "Natural_and_Synthetic_Terminators_Voigt_Lab_collection.xml",
         "Pichia_MoClo_Toolkit_Lu_Lab_collection.xml",
         "cello_library.xml"],
        feature_library
    ])

app = Flask(__name__) # app = Quart(__name__)
CORS(app)
app.before_first_request(setup)

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

def create_feature_library(part_library_file_names):
    # check if feature_library has been cached
    # if so, return feature_library
    for xs in FEATURE_LIBRARIES:
        f_names = [*xs[FEATURE_FILES]]
        feature_lib = xs[FEATURE_LIBRARY]
        part_lib_f_names_cpy = [*part_library_file_names]
        f_names.sort()
        part_lib_f_names_cpy.sort()
        if f_names == part_lib_f_names_cpy:
            return feature_lib                    
    
    # read in all feature libraries -- SYNBICT says they support
    # directories, but they actually don't; only lists of files
    feature_libraries_dir = "./assets/synbict/feature-libraries"
    feature_libraries_paths = [os.path.join(feature_libraries_dir, file_name) for file_name in part_library_file_names]

    feature_docs = []

    for feature_library_path in feature_libraries_paths:
        print(feature_library_path)
        feature_doc = sbol2.Document()
        feature_doc.read(feature_library_path)
        feature_docs.append(feature_doc)

    feature_library = FeatureLibrary(feature_docs)
    
    # memoize:
    FEATURE_LIBRARIES.append([part_library_file_names, feature_library])
    
    return feature_library

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
    anno_libs_assoc = []

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
                feature_library = create_feature_library([part_lib_f_name])
                min_feature_length = 10
                annotater = FeatureAnnotater(feature_library, min_feature_length)
                min_target_length = 10                
                annotated_identities = annotater.annotate(target_library, min_target_length, in_place=True)

                # The pySBOL2 library hasn't implemented the necessary functionality to retrieve sequence annotations,
                # so instead I'm serializing the document and grabbing the sequence annotations using the sbolgraph
                # library in javascript in the front end
                anno_libs_assoc.append([target_doc.writeString(), part_lib_f_name])
    return None, None, anno_libs_assoc

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

@app.post("/api/annotateSequence")
def annotate_sequence():
    request_data = request.get_json()
    sbol_content = request_data['completeSbolContent']
    part_library_file_names = request_data['partLibraries']

    print("Running SYNBICT...")
    # Run SYNBICT
    try:
        # anno_libs_assoc = [
        #     [sbol_xml_annotated, part_lib_file_name],
        #     [sbol_xml_annotated, part_lib_file_name],
        #     ...
        # ]
        error_code, error_message, anno_libs_assoc,  = run_synbict(sbol_content, part_library_file_names)
        
        if (error_code):
            return {"sbol": sbol_content, "error_message": error_message}, error_code
        
    except Exception as e:
        print("Caught exception")
        print(str(e))
        return {"sbol": sbol_content}, status.HTTP_500_INTERNAL_SERVER_ERROR
    else:
        # return {"annotations": annotations}
        return {"annotations": anno_libs_assoc}

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

if __name__ == '__main__':
    app.run(debug=True,host='0.0.0.0',port=5000)
