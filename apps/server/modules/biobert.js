import { Searcher } from "fast-fuzzy"
import fetch, { FormData } from "node-fetch"

const BIOBERT_URL = "http://bern2.korea.ac.kr/plain"
const SEARCH_THRESHOLD = 0.75

export async function runBiobert(text) {

    // send request
    const res = await fetch(BIOBERT_URL, {
        method: 'POST',
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
    })
    const jsonRes = await res.json()

    // group grounded terms together
    let annotations = Object.values(
        jsonRes.annotations.reduce((accum, current) => {
            current.id.forEach(id => {
                accum[id] = {
                    id: findOntologyLink(id),
                    displayId: id,
                    mentions: [
                        ...(accum[id]?.mentions || []),
                        {
                            text: current.mention,
                            confidence: current.prob,
                            start: current.span.begin,
                            end: current.span.end,
                            startWord: wordIndexFromIndex(text, current.span.begin),
                            length: countWords(current.mention),
                        }
                    ]
                }
            })
            return accum
        }, {})
    )

    // filter out annotations that are "CUI-less" (ungrounded)
    const cuilessTerms = annotations.filter(anno => anno.displayId == "CUI-less")
        .map(anno => anno.mentions)
        .flat()
    annotations = annotations.filter(anno => anno.displayId != "CUI-less")

    // do fuzzy matching
    const searchIndex = {}
    const searchCollection = annotations
        .map(anno => anno.mentions.map(mention => {
            searchIndex[mention.text] = anno.id     // simultaneously create lookup table for getting result IDs
            return mention.text
        }))
        .flat()
    const fuzzySearcher = new Searcher(searchCollection)

    // grab all the terms we should search with
    const wordsToSearch = [...cuilessTerms]
    // used to use this so we could store the character-wise index; instead, see below 
    // const wordReg = /\w+/g
    // let wordMatch
    // while (wordMatch = wordReg.exec(text)) {
    //     if (searchCollection.every(term => !term.includes(wordMatch[0])) &&
    //         cuilessTerms.every(term => !term.text.includes(wordMatch[0])))
    //         wordsToSearch.push({
    //             text: wordMatch[0],
    //             start: wordMatch.index,
    //             end: wordMatch.index + wordMatch[0].length
    //         })
    // }
    // simpler method, just getting word-wise index
    splitIntoWords(text).forEach((word, i) => {
        if (searchCollection.every(term => !term.includes(word)) && cuilessTerms.every(term => !term.text.includes(word)))
            wordsToSearch.push({
                text: word,
                startWord: i,
                length: 1,
                fuzzyMatched: true,
            })
    })

    // do the search on the words we found + the cui-less words
    wordsToSearch.forEach(word => {
        const topResult = fuzzySearcher.search(word.text, { returnMatchData: true })[0]

        // ignore empty results and results without a high enough score
        if (!topResult || topResult.score < SEARCH_THRESHOLD)
            return

        // add in annotation
        word.confidence = topResult.score
        const anno = annotations.find(anno => anno.id == searchIndex[topResult.item])
        
        // Disabling fuzzy matching for now

        // but make sure we're not referring to the same word
        // if (anno.mentions.every(mention => mention.startWord != word.startWord))
        //     anno.mentions.push(word)
    })


    // for the sake of simplicity, we're gonna cut out the start and end
    // properties of each mention and calculate them dynamically
    return annotations.map(anno => ({
        ...anno,
        terms: [...new Set(anno.mentions.map(mention => mention.text))]
    }))
}

function findOntologyLink(id) {
    // const split = id.split(":")
    // return OntologyMap[split[0]]?.(split[1])
    return "https://identifiers.org/" + id
}

// const OntologyMap = {
//     NCBITaxon: id => `https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${id}`,
//     mesh: id => `https://id.nlm.nih.gov/mesh/${id}.html`,
// }

function splitIntoWords(str) {
    return str.split(/\s+/)
}

function countWords(str) {
    return splitIntoWords(str).length
}

function wordIndexFromIndex(text, index) {
    const sentinel = "$%^&"
    return splitIntoWords(text.slice(0, index) + sentinel + text.slice(index))
        .findIndex(word => word.includes(sentinel))
}