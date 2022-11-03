import { useEffect } from "react"

export class SearchIndex extends Promise {

    constructor(indexCreator, fromConstructor) {
        let resolve
        super((res, rej) => {
            resolve = res
            if (!fromConstructor)
                return indexCreator(res, rej)   // required for subclassing Promise (.then needs this)
        })
        this.resolve = resolve
        this.startedIndexing = false
        this.indexCreator = indexCreator
    }

    index() {
        this.startedIndexing = true
        this.indexCreator(this.resolve)
    }

    async search(query) {
        return (await this)(query)
    }

    use() {
        useEffect(() => {
            if (!this.startedIndexing)
                this.index()
        }, [])
        return this.search.bind(this)
    }
}