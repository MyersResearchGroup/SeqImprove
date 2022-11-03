import fetch from "node-fetch"

export async function findSimilarParts(topLevelUri) {
    const res = await (await fetch(topLevelUri + "/similar", {
        headers: {
            "Accept": "application/json"
        }
    })).json()

    return res.map(({ name, uri }) => ({
        name, uri
    }))
}