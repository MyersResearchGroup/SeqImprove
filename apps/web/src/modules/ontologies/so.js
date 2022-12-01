import { SearchIndex } from "."
import lunr from "lunr"
import { createRoleURI, decodeRoleURI } from "../roles"
import { toTitleCase } from "../util"


/*
    Index Sequence Ontology for searching
*/
const soIndex = new SearchIndex(resolve => {
    fetch("/so.json")
        .then(res => res.json())
        .then(so => {
            const documents = {}
            const index = lunr(function () {
                this.field("id")
                this.field("shortId", { boost: 3 })
                this.field("name", { boost: 10 })
                this.field("description")
                this.field("synonyms")

                so.graphs[0].nodes.forEach(node => {
                    const shortId = decodeRoleURI(node.id)
                    const id = createRoleURI(shortId)
                    const newDoc = {
                        id,
                        shortId,
                        name: toTitleCase(node.lbl ?? "unknown"),
                        description: node.meta?.definition?.val,
                        synonyms: node.meta?.synonyms?.map(syn => syn.val).join(", ") ?? "",
                    }
                    this.add(newDoc)
                    documents[id] = newDoc
                })
            })
            // resolve search function
            resolve(query =>
                index.search(query).map(result => ({
                    ...result,
                    document: documents[result.ref]
                }))
            )
        })
}, true)

export const useSequenceOntology = soIndex.use.bind(soIndex)