

export function decodeRoleURI(uri) { 
    return uri.match(/SO[:_]\d+$/)?.[0].replace("_", ":")
}

export function createRoleURI(shortId) {
    // console.log("shortId: " + shortId);
    return `http://identifiers.org/so/${shortId}`
}
