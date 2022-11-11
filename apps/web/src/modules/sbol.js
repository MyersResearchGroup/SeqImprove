import { Predicates as BioTermsPredicates } from "bioterms"
import { Graph, SBOL2GraphView } from "sbolgraph"
import { splitIntoWords } from "./text"


const Predicates = {
    RichDescription: "sbh:richDescription",
}


export async function createSBOLDocument(sbolContent) {
    const document = new SBOL2GraphView(new Graph())
    await document.loadString(sbolContent)

    // Prep document by defining some additional getters and setters

    // add alias for root component definition
    Object.defineProperty(document, "root", {
        get() {
            const root = this.rootComponentDefinitions[0]

            // add aliases for root
            Object.defineProperties(root, {
                sequence: {
                    get() { return this.sequences[0]?.elements },
                    enumerable: true,
                },
                richDescription: {
                    get() { return this.getStringProperty(Predicates.RichDescription) },
                    set(value) { this.setStringProperty(Predicates.RichDescription, value) },
                    enumerable: true,
                }
            })

            return root
        },
        enumerable: true,
    })

    // initialize rich description as regular description if one doesn't exist
    if (!document.root.richDescription)
        document.root.richDescription = document.root.description

    return document
}

export function hasSequenceAnnotation(componentDefinition, annotationId) {
    return !!componentDefinition.sequenceAnnotations.find(sa => sa.persistentIdentity == annotationId)
}

export function addSequenceAnnotation(componentDefinition, annoInfo) {
    const sa = componentDefinition.annotateRange(annoInfo.location[0], annoInfo.location[1], annoInfo.name)
    sa.persistentIdentity = annoInfo.id
}

export function removeSequenceAnnotation(componentDefinition, annotationId) {
    const annotation = componentDefinition.sequenceAnnotations.find(sa => sa.persistentIdentity == annotationId)
    componentDefinition.graph.removeMatches(
        componentDefinition.subject,
        BioTermsPredicates.SBOL2.sequenceAnnotation,
        annotation.subject
    )
}

export function createAnnotationRegex(id, flags = "g") {
    return new RegExp(`\\[([^\\]]*?)\\]\\((${id})\\)`, flags)
}

export function hasTextAnnotation(componentDefinition, annotationId) {
    // console.log(componentDefinition.richDescription)
    return createAnnotationRegex(annotationId).test(componentDefinition.richDescription)
}

export function addTextAnnotation(componentDefinition, annoInfo) {
    const words = splitIntoWords(componentDefinition.richDescription)
    annoInfo.mentions.forEach(mention => {
        // remove annotation phrase
        const removedPhrase = words.splice(mention.startWord, mention.length).join(" ")
        // insert it as a link with padding to maintain total length
        words.splice(mention.startWord, 0, `[${removedPhrase}](${annoInfo.id})`, ...Array(mention.length - 1).fill(""))
    })
    componentDefinition.richDescription = words.join(" ")
}

export function removeTextAnnotation(componentDefinition, annotationId) {
    componentDefinition.richDescription = componentDefinition.richDescription.replaceAll(
        createAnnotationRegex(annotationId),
        "$1"
    )
}