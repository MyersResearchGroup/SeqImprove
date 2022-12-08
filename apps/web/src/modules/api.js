import { showNotification } from "@mantine/notifications"

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


function showErrorNotification(title, message) {
    showNotification({
        title,
        color: "red",
        message,
    })
}

function showServerErrorNotification() {
    showNotification({
        title: "Failed to load resource",
        color: "red",
        message: "This is probably an issue with our servers. Sorry!",
    })
}