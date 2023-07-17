import fetch from "node-fetch"

export async function findSimilarParts(topLevelUri) {
    const res = await fetch(topLevelUri + "/similar", {
        headers: {
            "Accept": "application/json"
        }
    }).then(response => response.json()).catch(err => {
        console.error(err);
        return [];
    });;

    return res.map(({ name, uri }) => ({
        name, uri
    }))
}
