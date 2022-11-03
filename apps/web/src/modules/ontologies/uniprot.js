
export const useUniprot = (database = "uniprotkb", mapping, options = {}) => async query => {
    
    // construct param string
    const params = new URLSearchParams()
    params.append("query", query)
    Object.entries(options).map(([key, value]) => params.append(key, value))
    
    const response = await (await fetch(`https://rest.uniprot.org/${database}/search?${params.toString()}`, {
        headers: {
            "Accept": "application/json",
        },
    })).json()

    return mapping ? response.results.map(mapping) : response.results
}