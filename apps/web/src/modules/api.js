import { showServerErrorNotification } from "./util"

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

export async function fetchAnnotateSequence(sbolContent) {

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
        var result = await response.json()
    }
    catch (err) {
        console.error("Couldn't parse JSON.")
        showServerErrorNotification()
        return
    }
    
    console.log("Successfully annotated.")
    return result.annotations
}

export async function fetchAnnotateText(text) {

    console.log("Annotating text...")

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
    return result.annotations
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
