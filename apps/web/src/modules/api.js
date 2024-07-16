import { showServerErrorNotification } from "./util"
import { Graph, SBOL2GraphView } from "sbolgraph"

export async function bootAPIserver() {
    try {
        var response = await fetch(`${import.meta.env.VITE_API_LOCATION}/api/boot`);        
    } catch (err) {
        console.error(err);
        return
    }

    if (response.status == 200) {
        console.log(response);
    }
}

export async function fetchConvertGenbankToSBOL2(genbankContent) {
    const TYPE_ERROR = 11;
    let response;
    let result;
    let count;
    for (count = 4; count < 10; count++) {
        try {
            response = await fetchWithTimeout(`${import.meta.env.VITE_API_LOCATION}/api/convert/genbanktosbol2`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"                
                },
                body: JSON.stringify({
                    GenBankContent: genbankContent,
                    uriPrefix: "https://seqimprove.synbiohub.org",
                }),
                timeout: count * 1000,
            });
            break;
        }
        catch (err) {            
            console.error(err);            
            count = TYPE_ERROR - 1;
        }
    }
    if (count == 10) {
        return { sbol2_content: "", err: "Network Error" };
    } else if (count == TYPE_ERROR) {        
        return { sbol2_content: "", err: TypeError };
    }
    
    // Parse
    try {
        result = await response.json();
    }
    catch (err) {
        console.error("Couldn't parse JSON.");
        showServerErrorNotification();
        return { sbol2_content: "", err: "Parse Error" };
    }
    
    return { sbol2_content: result.sbol2_content, err: result.err };
}

export async function fetchSBOL(url) {
    try {
        return await (await fetch(url)).text()
    }
    catch (err) {
        console.error(`Failed to fetch SBOL content from ${url}. Running in standalone mode.`)
        showNotification({
            title: "Failed to load SBOL from URL",
            color: "red",
        })
    }
}

export async function fetchAnnotateSequence({ sbolContent, selectedLibraryFileNames }) {
    console.log("Annotating sequence...")

    // Fetch
    try {
        var response = await fetchWithTimeout(`${import.meta.env.VITE_API_LOCATION}/api/annotateSequence`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                completeSbolContent: sbolContent,
                partLibraries: selectedLibraryFileNames,
            }),
            timeout: 120000,
        });
    }
    catch (err) {
        console.error("Failed to fetch.");
        showServerErrorNotification();
        return;
    }

    // Parse
    try {
        var result = await response.json();
    }
    catch (err) {
        console.error("Couldn't parse JSON.");
        showServerErrorNotification();
        return;
    }

    if (response.status == 200) {
        console.log("Successfully annotated.");
    }

    const annoLibsAssoc = result.annotations;    
    
    // create and load original doc
    const originalDoc = new SBOL2GraphView(new Graph());
    await originalDoc.loadString(sbolContent);
    
    // make a list of persistentIds to avoid
    const originalAnnotations = originalDoc.rootComponentDefinitions[0].sequenceAnnotations
          .map(sa => sa.persistentIdentity);
    
    let annotations = [];  

    await Promise.all(annoLibsAssoc.map(([ sbolAnnotated, partLibrary ]) => {
        return (async () => {
            // create and load annotated doc
            const annDoc = new SBOL2GraphView(new Graph());
            await annDoc.loadString(sbolAnnotated);
            
            // concatenate new annotations to result
            annotations = annotations.concat(annDoc.rootComponentDefinitions[0].sequenceAnnotations
                                             // filter annotations already in original document
                                             .filter(sa => !originalAnnotations.includes(sa.persistentIdentity))
                                             // just return the info we need
                                             .map(sa => ({
                                                 name: sa.displayName,
                                                 id: sa.persistentIdentity,
                                                 location: [sa.rangeMin, sa.rangeMax],
                                                 featureLibrary: partLibrary,
                                             })));
        })();
    }));

    return annotations;            
}

export async function fetchAnnotateText(text) {

    console.log("Annotating text...", `${import.meta.env.VITE_API_LOCATION}/api/annotateText`);

    // Fetch
    try {
        var response = await fetchWithTimeout(`${import.meta.env.VITE_API_LOCATION}/api/annotateText`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ text }),
            timeout: 120000,
        });
    }
    catch (err) {
        console.error("Failed to fetch.")
        showServerErrorNotification()
        throw(err);
    }
    
    // Parse
    try {
        var result = await response.json()
    }
    catch (err) {
        console.error("Couldn't parse JSON.")
        showServerErrorNotification()
        return
    }
    
    console.log("Successfully annotated.")    
    // https://bioregistry.io/NCBITaxon:562
    result.annotations.forEach((anno, i) => {
        result.annotations[i].id = "https://bioregistry.io/" + anno.displayId;
    });
    return result.annotations;
}

export async function fetchSimilarParts(topLevelUri) {

    console.log("Fetching similar parts...")

    // Fetch
    try {
        var response = await fetch(`${import.meta.env.VITE_API_LOCATION}/api/findSimilarParts`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ topLevelUri }),
        })
    }
    catch (err) {
        console.error("Failed to fetch.")
        showServerErrorNotification()
        return
    }

    // Parse
    try {
        var result = await response.json()
    }
    catch (err) {
        console.error("Couldn't parse JSON.")
        showServerErrorNotification()
        return
    }
    
    console.log("Successfully annotated.")
    return result.similarParts
}

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000 } = options;
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
  
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal  
    });
    clearTimeout(id);
  
    return response;
}

export async function fetchSuggestions(text) {
    const url = `https://www.ebi.ac.uk/ols4/api/suggest?q=${text}&rows=20&start=0`;
 
    const response2 = await fetch(url, {                
        method: "GET"
    });          

    const suggestions = await response2.json();
   
    console.log("suggestions: ", suggestions.response.docs);
    console.log("type", typeof suggestions.response.docs);
    const results = suggestions.response.docs;
    results.forEach((item, i) => {
        item.id = i + 1;
      });
    const result2 = results.slice(0, 20).map(result => ({ // show top 20 hits
        name: result.autosuggest,
        id: result.id,
    }))
    console.log("result2", result2);
    return result2;
}
