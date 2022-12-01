
export async function fetchSBOL(url) {
    try {
        return await (await fetch(url)).text()
    }
    catch (err) {
        console.error(`Failed to fetch SBOL content from ${url}. Running in standalone mode.`)
    }
}

export async function fetchAnnotateSequence(sbolContent) {

    console.log("Annotating sequence...")

    // Fetch
    try {
        var response = await fetch(`${import.meta.env.VITE_API_LOCATION}/api/annotateSequence`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                completeSbolContent: sbolContent,
            }),
        })
    }
    catch (err) {
        console.error("Failed to fetch.")
        return
    }

    // Parse
    try {
        var result = await response.json()
    }
    catch (err) {
        console.error("Couldn't parse JSON.")
        return
    }
    
    console.log("Successfully annotated.")
    return result.annotations
}

export async function fetchAnnotateText(text) {

    console.log("Annotating text...")

    // Fetch
    try {
        var response = await fetch(`${import.meta.env.VITE_API_LOCATION}/api/annotateText`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ text }),
        })
    }
    catch (err) {
        console.error("Failed to fetch.")
        return
    }

    // Parse
    try {
        var result = await response.json()
    }
    catch (err) {
        console.error("Couldn't parse JSON.")
        return
    }
    
    console.log("Successfully annotated.")
    return result.annotations
}