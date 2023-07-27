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

FEATURE_LIBRARIES = []

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
    FEATURE_LIBRARIES.append(feature_library)

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

def create_temp_file(content):
    try:
        # Create a temporary file
        with tempfile.NamedTemporaryFile(prefix="temp_", suffix=".txt", delete=False) as temp_file:
            # Write data to the temporary file (optional)
            temp_file.write(content)

            # Get the file name of the temporary file
            temp_file_name = temp_file.name

            # You can continue working with the temporary file here as needed.
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

def run_node_script(script_path, arguments):
    try:
        # Run the Node.js script and capture the output
        result = subprocess.check_output(["node", script_path, *arguments], text=True)

        # Parse the JSON data from the captured output
        json_data = json.loads(result)

        return json_data

    except subprocess.CalledProcessError as e:
        print("Error occurred while running the Node.js script:", e)
        return None

# feature_libraries: list[str]
def run_synbict(sbol_content: str) -> tuple[Optional[int], Optional[str], Optional[List]]:
    target_doc = sbol2.Document()
    try:
        target_doc.readString(sbol_content)
    except Exception:
        print('Could not parse sbol_content')    
        return status.HTTP_400_BAD_REQUEST, 'Could not parse sbol_content', None
    else:
        # sbol_file_path_original = "./assets/scripts/get_annotations/original.xml"
        # target_doc.write(sbol_file_path_original)

        # Create a temporary file
        with tempfile.NamedTemporaryFile(prefix="temp_", suffix=".txt", delete=False) as sbol_file_original:
            # Write data to the temporary file (optional)
            sbol_file_original.write(bytes(target_doc.writeString(), "utf-8"))
            # for debugging js script
            # target_doc.write("./assets/scripts/get_annotations/original.xml")
            # print("successfully written")

            # Get the file name of the temporary file
            sbol_file_name_original = sbol_file_original.name

            # Once the 'with' block ends, the temporary file will be automatically deleted.
                    
            target_library = FeatureLibrary([target_doc])
            feature_library = FEATURE_LIBRARIES[0]
            min_feature_length = 10
            annotater = FeatureAnnotater(feature_library, min_feature_length)
            min_target_length = 10
            annotated_identities = annotater.annotate(target_library, min_target_length, in_place=True)

            # The pySBOL2 library hasn't implemented the necessary functionality to retrieve sequence annotations,
            # so instead I'm serializing the document and grabbing the sequence annotations using the sbolgraph
            # library in javascript:
            print ("Annotations found, waiting for Node.js script")
            # Create a temporary file
            with tempfile.NamedTemporaryFile(prefix="temp_", suffix=".txt", delete=False) as sbol_file_annotated:
                # Write data to the temporary file (optional)
                sbol_file_annotated.write(bytes(target_doc.writeString(), "utf-8"))
                # target_doc.write("./assets/scripts/get_annotations/annotated.xml")

                # Get the file name of the temporary file
                sbol_file_name_annotated = sbol_file_annotated.name
                
                # Once the 'with' block ends, the temporary file will be automatically deleted.
                node_script_path = "./assets/scripts/get_annotations/get_annotations.js"
                json_data = run_node_script(node_script_path, [sbol_file_name_annotated, sbol_file_name_original])
                if not json_data:
                    print("No JSON data received from Node.js script.")
                    return status.HTTP_500_INTERNAL_SERVER_ERROR, 'Node.js script returned no json data', None           

                print("JSON data received from the Node.js script:")
            
                return None, None, json_data

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
    print(res_json)

    # group grounded terms together
    annotations = res_json['annotations']
    print("+++++++++++++++++++++++++++++++++++++++++++++")
    print(annotations)
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
    print("+++++++++++++++++++++++++++++++++++++++++++++")
    print(annotations)
    
    # filter out annotations that are "CUI-less" (ungrounded)
    cuiless_terms = flatten(list(map(lambda anno: anno['mentions'], filter(lambda anno: anno['displayId'] == "CUI-less", annotations)))) 
    annotations = list(filter(lambda anno: anno['displayId'] != "CUI-less", annotations))
    print("+++++++++++++++++++++++++++++++++++++++++++++")
    print ("cuiless_terms: ", cuiless_terms)
    print("annotations: ", annotations)
    # # do fuzzy matching
    # search_index = {}
    # search_collection = flatten(list(map(lambda anno: (
    #     list(map(lambda mention: (
    #         search_index[mention['text']] = anno['id']
    #         return mention['text']                           
    #     ), anno['mentions']))
    # ), annotations)))

    # # grab all the terms we should search with
    # words_to_search = [*cuiless_terms]
    # for i, word in enumerate(split_into_words(text)):        
    #     if (all([not (word in term) for term in search_collection]) and (
    #         all([not (word in term['text']) for term in cuiless_terms]))):
    #         words_to_search.append({
    #             'text': word,
    #             'startWord': i,
    #             'length': 1,
    #             'fuzzyMatched': true
    #         })

    # for word in words_to_search:
    #     # do the fuzzy search!
    #     top_result =

    #     # ignore empty results and results without a high enough score
    #     if (not top_result or top_result['score'] < SEARCH_THRESHOLD):
    #         continue

    #     word['confidence'] = top_result['score']
    #     anno = None
    #     for annotation in annotations:
    #         if annotation['id'] == search_index[top_result['item']]:
    #             anno = annotation
    #             break

    # for every annotation, append two keys: terms and label. label is jsut terms[0]
    # terms is just the unique mentions as text. The text property of the mention, for each annotation
    annotations = list(map(add_terms, annotations))
    print("annotations: ", annotations)

    # vvv this method expects a string, so return json form of this, or not?
    return annotations

#     return """[
#   {
#     id: 'https://identifiers.org/NCBIGene:6862',
#     displayId: 'NCBIGene:6862',
#     mentions: [ [Object] ],
#     terms: [ 'TetR' ],
#     label: 'TetR'
#   },
#   {
#     id: 'https://identifiers.org/NCBIGene:7035',
#     displayId: 'NCBIGene:7035',
#     mentions: [ [Object] ],
#     terms: [ 'LacI' ],
#     label: 'LacI'
#   },
#   {
#     id: 'https://identifiers.org/NCBIGene:4712',
#     displayId: 'NCBIGene:4712',
#     mentions: [ [Object] ],
#     terms: [ 'CI' ],
#     label: 'CI'
#   },
#   {
#     id: 'https://identifiers.org/NCBIGene:8790',
#     displayId: 'NCBIGene:8790',
#     mentions: [ [Object] ],
#     terms: [ 'GFP reporter' ],
#     label: 'GFP reporter'
#   }
# ]"""

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
        
# @app.route('/')
# def hello_world() -> str:
#     return "Hello, world cat!"

# @app.post("/echo")
# def echo():
#     data = request.get_json()    
#     return {"input": data, "extra": True}

@app.post("/api/annotateSequence")
def annotate_sequence():
    sbol_content = request.get_json()['completeSbolContent']

    print("Running SYNBICT...")
    # Run SYNBICT
    try:
        error_code, error_message, annotations = run_synbict(sbol_content)
        
        if (error_code):
            return {"sbol": sbol_content, "error_message": error_message}, error_code
        
    except Exception as e:
        print("Caught exception")
        print(str(e))
        return {"sbol": sbol_content, "extra": True}, status.HTTP_500_INTERNAL_SERVER_ERROR
    else:
        return {"annotations": annotations}

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
