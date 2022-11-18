import { Predicates as BioTermsPredicates } from "bioterms"
import { Graph, S2ComponentDefinition, SBOL2GraphView } from "sbolgraph"
import { splitIntoWords } from "./text"


const Predicates = {
    RichDescription: "sbh:richDescription",
}


/**
 * Creates an SBOL document from the passed SBOL content.
 *
 * @export
 * @param {string} sbolContent
 * @return {SBOL2GraphView} 
 */
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

/**
 * Checks if the passed ComponentDefinition contains the sequence annotation specified
 * by the passed annotation ID.
 *
 * @export
 * @param {S2ComponentDefinition} componentDefinition
 * @param {string} annotationId
 * @return {boolean} 
 */
export function hasSequenceAnnotation(componentDefinition, annotationId) {
    return !!componentDefinition.sequenceAnnotations.find(sa => sa.persistentIdentity == annotationId)
}

/**
 * Adds a sequence annotation with the information from the passed annotation object
 * to the passed ComponentDefinition.
 *
 * @export
 * @param {S2ComponentDefinition} componentDefinition
 * @param {{
 *      id: string,
 *      name: string,
 *      location: number[],
 * }} annoInfo
 */
export function addSequenceAnnotation(componentDefinition, annoInfo) {
    if (hasSequenceAnnotation(componentDefinition, annoInfo.id))
        return

    const sa = componentDefinition.annotateRange(annoInfo.location[0], annoInfo.location[1], annoInfo.name)
    sa.persistentIdentity = annoInfo.id
}

/**
 * Removes the sequence annotation matching the passed annotation ID from the passed
 * ComponentDefinition.
 *
 * @export
 * @param {S2ComponentDefinition} componentDefinition
 * @param {string} annotationId
 */
export function removeSequenceAnnotation(componentDefinition, annotationId) {
    if (!hasSequenceAnnotation(componentDefinition, annotationId))
        return

    const annotation = componentDefinition.sequenceAnnotations.find(sa => sa.persistentIdentity == annotationId)
    annotation.destroy()
}

/**
 * Creates a regular expression that searches for a text annotation with the
 * passed ID.
 *
 * @export
 * @param {string} id
 * @param {string} [flags="g"]
 * @return {RegExp} 
 */
export function createAnnotationRegex(id, flags = "g") {
    return new RegExp(`\\[([^\\]]*?)\\]\\((${id})\\)`, flags)
}

/**
 * Checks if the passed ComponentDefinition contains the text annotation specified
 * by the passed annotation ID.
 *
 * @export
 * @param {S2ComponentDefinition} componentDefinition
 * @param {string} annotationId
 * @return {boolean} 
 */
export function hasTextAnnotation(componentDefinition, annotationId) {
    return createAnnotationRegex(annotationId).test(componentDefinition.richDescription)
}

/**
 * Adds a text annotation with the information from the passed annotation object
 * to the passed ComponentDefinition.
 *
 * @export
 * @param {S2ComponentDefinition} componentDefinition
 * @param {{
 *      id: string,
 *      mentions: any[],
 * }} annoInfo
 */
export function addTextAnnotation(componentDefinition, annoInfo) {
    if (hasTextAnnotation(componentDefinition, annoInfo.id))
        return

    const words = splitIntoWords(componentDefinition.richDescription)
    annoInfo.mentions.forEach(mention => {
        // remove annotation phrase
        const removedPhrase = words.splice(mention.startWord, mention.length).join(" ")
        // insert it as a link with padding to maintain total length
        words.splice(mention.startWord, 0, `[${removedPhrase}](${annoInfo.id})`, ...Array(mention.length - 1).fill(""))
    })
    componentDefinition.richDescription = words.join(" ")
}

/**
 * Removes the text annotation matching the passed annotation ID from the passed
 * ComponentDefinition.
 *
 * @export
 * @param {S2ComponentDefinition} componentDefinition
 * @param {string} annotationId
 */
export function removeTextAnnotation(componentDefinition, annotationId) {
    if (!hasTextAnnotation(componentDefinition, annotationId))
        return

    componentDefinition.richDescription = componentDefinition.richDescription.replaceAll(
        createAnnotationRegex(annotationId),
        "$1"
    )
}