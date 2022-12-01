import { Graph, S2ComponentDefinition, SBOL2GraphView } from "sbolgraph"
import { TextBuffer } from "text-ranger"

const Prefix = "https://seqimprove.org/"

const Predicates = {
    RichDescription: `${Prefix}richDescription`,
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
 * @param {{string}} id
 */
export function removeSequenceAnnotation(componentDefinition, { id }) {
    if (!hasSequenceAnnotation(componentDefinition, id))
        return

    const annotation = componentDefinition.sequenceAnnotations.find(sa => sa.persistentIdentity == id)
    annotation.destroy()
}

export function parseTextAnnotations(description) {
    // Use a buffer to replace annotations with their regular text
    const reverseBuffer = new TextBuffer(description)

    const matches = [...description.matchAll(createAnnotationRegex(".+?"))]
    matches.forEach(match => {
        reverseBuffer.createAlias(match.index, match.index + match[0].length, match[1])
            .enable()
    })

    // project all the indeces to form regular text annotations
    const reverseResult = reverseBuffer.getText(true)
    const buffer = new TextBuffer(reverseResult.text)

    // map to annotations
    let annotations = reverseResult.patches.map((patch, i) => {
        const alias = buffer.createAlias(patch.projectedStart, patch.projectedEnd, matches[i][0])
        alias.enable()
        return {
            id: matches[i][2],
            displayId: matches[i][2].match(/[^\/]*$/)?.[0] ?? matches[i][2],
            label: patch.alias.text,
            mentions: [{ start: alias.start, end: alias.end, text: patch.alias.text, bufferPatch: alias }],
        }
    })

    // combine annotations with same ID
    annotations = Object.values(
        annotations.reduce((accum, anno) => {
            if (accum[anno.id])
                accum[anno.id].mentions.push(...anno.mentions)
            else
                accum[anno.id] = anno
            return accum
        }, {})
    )

    return { buffer, annotations }
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
 * Tests if a string is or contains a text annotation.
 *
 * @export
 * @param {string} text
 * @return {boolean} 
 */
export function isMention(text) {
    return createAnnotationRegex(".+?", "").test(text)
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
 * @param {TextBuffer} buffer
 */
export function addTextAnnotation(componentDefinition, annoInfo) {

    annoInfo.mentions.forEach(
        mention => mention.bufferPatch.enable()
    )

    const buffer = annoInfo.mentions[0]?.bufferPatch.buffer
    if (buffer) {
        componentDefinition.richDescription = buffer.getText()
        componentDefinition.description = buffer.originalText
    }
}

/**
 * Removes the text annotation matching the passed annotation ID from the passed
 * ComponentDefinition.
 *
 * @export
 * @param {S2ComponentDefinition} componentDefinition
 * @param {string} annotationId
 */
export function removeTextAnnotation(componentDefinition, annoInfo) {

    annoInfo.mentions.forEach(
        mention => mention.bufferPatch.disable()
    )

    const buffer = annoInfo.mentions[0]?.bufferPatch.buffer
    if (buffer) {
        componentDefinition.richDescription = buffer.getText()
        componentDefinition.description = buffer.originalText
    }
}