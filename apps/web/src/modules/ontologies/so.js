import { SearchIndex } from "."
import lunr from "lunr"


/*
    Index Sequence Ontology for searching
*/
const soIndex = new SearchIndex(resolve => {
    fetch("/so.json")
        .then(res => res.json())
        .then(so => {
            const documents = {}
            const index = lunr(function () {
                this.field("id", { boost: 3 })
                this.field("name", { boost: 5 })
                this.field("description")
                this.field("synonyms")

                so.graphs[0].nodes.forEach(node => {
                    const id = "SO:" + node.id.match(/[^_]+$/)?.[0]
                    const newDoc = {
                        id,
                        name: node.lbl,
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