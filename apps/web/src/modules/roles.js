

export function decodeRoleURI(uri) {
    return uri.match(/SO[:_]\d+$/)?.[0].replace("_", ":")
}

export function createRoleURI(shortId) {
    return `http://identifiers.org/so/${shortId}`
}