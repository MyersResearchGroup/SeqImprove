import { set } from "lodash"
import { Graph, S2ComponentDefinition, S2ComponentInstance, SBOL2GraphView } from "sbolgraph"
import { TextBuffer } from "text-ranger"
import { mutateDocument, useAsyncLoader, useStore } from "./store"

//change to seqimprove.synbiohub.org?
const Prefix = "https://seqimprove.org/"

const Predicates = {
    RichDescription: `${Prefix}richDescription`,
    TargetOrganism: `${Prefix}targetOrganism`,
    Protein: `${Prefix}protein`,
    Reference: `${Prefix}reference`,
}


/**
 * Add some additional utility members to the sboljs classes
 */
Object.defineProperty(SBOL2GraphView.prototype, "root", {
    get() {
        return this.rootComponentDefinitions[0]
    }
})

Object.defineProperties(S2ComponentDefinition.prototype, {
    sequence: {
        get() { return this.sequences[0]?.elements; },
        set(value) {
            if (this.sequences) {
                if (this.sequences[0]) {
                    this.sequences[0].elements = value;                    
                } else {
                    this.sequences[0] = { elements: value };
                }
            } else {
                this.sequences = [ { elements: value } ];
            }

        },
    },

    richDescription: {
        get() { return this.getStringProperty(Predicates.RichDescription) },
        set(value) { this.setStringProperty(Predicates.RichDescription, value) },
    },

    title: {
        get() { return this.getStringProperty("http://purl.org/dc/terms/title") },
        set(value) { this.setStringProperty("http://purl.org/dc/terms/title", value) },
    },

    // role: {
    //     get() { return this.roles[0] },
    //     set(value) {
    //         this.addRole(value)
    //     }
    // },

    roles: {
        set(value) {
            const roles = this.roles.slice();
            roles.forEach(role => this.removeRole(role));
            value.forEach(role => this.addRole(role));
        }
    },

    targetOrganisms: {
        get() { return this.getUriProperties(Predicates.TargetOrganism) },
    },
    addTargetOrganism: {
        get() {
            return (function addTargetOrganism(uri) {
                this.insertUriProperty(Predicates.TargetOrganism, uri)
            }).bind(this)
        }
    },
    removeTargetOrganism: {
        get() {
            return (function removeTargetOrganism(uri) {
                this.graph.removeMatches(this.subject, Predicates.TargetOrganism, uri)
            }).bind(this)
        }
    },

    proteins: {
        get() { return this.getUriProperties(Predicates.Protein) },
    },
    addProtein: {
        get() {
            return (function addProtein(uri) {
                this.insertUriProperty(Predicates.Protein, uri)
            }).bind(this)
        }
    },
    removeProtein: {
        get() {
            return (function removeProtein(uri) {
                this.graph.removeMatches(this.subject, Predicates.Protein, uri)
            }).bind(this)
        }
    },

    references: {
        get() { return this.getUriProperties(Predicates.Reference) },
    },
    addReference: {
        get() {
            return (function addReference(uri) {
                this.insertUriProperty(Predicates.Reference, uri)
            }).bind(this)
        }
    },
    removeReference: {
        get() {
            return (function removeReference(uri) {
                this.graph.removeMatches(this.subject, Predicates.Reference, uri)
            }).bind(this)
        }
    },
})


/**
 * Creates an SBOL document from the passed SBOL content.
 *
 * @export
 * @param {string} sbolContent
 * @return {SBOL2GraphView} 
 */
export async function createSBOLDocument(sbolContent) {
    let document = new SBOL2GraphView(new Graph());
    await document.loadString(sbolContent);

    // initialize rich description as regular description if one doesn't exist
    if (!document.root.richDescription) {
        document.root.richDescription = document.root.description
    }
    
    // initialize title as display ID if one doesn't exist
    if (!document.root.title) {
        document.root.title = document.root.displayId
    }
    
    return document
}

export function isfromSynBioHub(componentDefinition) {
    //expand to include every sbh instance
    if (componentDefinition.uriChain.includes('https://synbiohub.org')) return true

    return false
}

/**
 * Return the active status of any annotation in the sequenceAnnotations array
 *
 * @export
 * @param {array} sequenceAnnotations
 * @param {string} annotationId
 * @return {boolean} 
 */
export function hasSequenceAnnotation(sequenceAnnotations, annotationId) {
    const anno = sequenceAnnotations.find((sa) => sa.id == annotationId)

    return anno.enabled
}

/**
 * Returns the index of an annotation with the specified id
 * 
 * @export
 * @param {array} sequenceAnnotations
 * @param {string} annotationId
 * @return {boolean} 
 */
export function addSequenceAnnotation(sequenceAnnotations, annotationId) {
    if (hasSequenceAnnotation(sequenceAnnotations, annotationId)) return

    let annoIndex = sequenceAnnotations.findIndex((sa) => sa.id == annotationId)
    
    return annoIndex
}

/**
 * Returns the index of an annotation with the specified id
 * 
 * @export
 * @param {array} sequenceAnnotations
 * @param {string} annotationId
 * @return {boolean} 
 */
export function removeSequenceAnnotation(sequenceAnnotations, annotationId) {
    if (!hasSequenceAnnotation(sequenceAnnotations, annotationId)) return

    let annoIndex = sequenceAnnotations.findIndex((sa) => sa.id == annotationId)
    
    return annoIndex
}

/**
 * Return the active status of any annotation in the sequenceAnnotations array
 *
 * @export
 * @param {S2ComponentDefinition} componentDefinition
 * @param {string} annotationId
 * @return {boolean} 
 */
export function hasSequenceAnnotationSBOL(componentDefinition, annotationId) {
    return !!componentDefinition.sequenceAnnotations.find(sa => sa.persistentIdentity == annotationId)
}

/**
 * Removes any duplicate annotation and its associated component instance from SBOL document
 *
 * @export
  * @param {S2ComponentDefinition} componentDefinition
  * @param {array} sequenceAnnotations
 */
export function removeDuplicateComponentAnnotation(componentDefinition, id) {
    if (!hasSequenceAnnotationSBOL(componentDefinition, id))
        return

    const duplicateAnnotation = componentDefinition.sequenceAnnotations.find(sa => sa.persistentIdentity == id)
    const associatedComponent = duplicateAnnotation.component

    const origIdNum = Number(id.slice(-1)) - 1 
    const originalAnnotation = componentDefinition.sequenceAnnotations.find(sa => sa.persistentIdentity == id.slice(0, -1) + origIdNum)

    if (originalAnnotation.rangeMax === duplicateAnnotation.rangeMax && originalAnnotation.rangeMin === duplicateAnnotation.rangeMin) {
        console.log("removing duplicate annotation: " + duplicateAnnotation.displayId)
        duplicateAnnotation.destroy()
        associatedComponent.destroy()
    }
}

/**
 * Removes annotation, component instance, component definition, and associated sequence from SBOL document
 *
 * @export
  * @param {S2ComponentDefinition} componentDefinition
  * @param {array} sequenceAnnotations
 */
export function removeAnnotationWithDefinition(componentDefinition, id) {
    console.log(id)
    if (!hasSequenceAnnotationSBOL(componentDefinition, id))
        return

    const annotation = componentDefinition.sequenceAnnotations.find(sa => sa.persistentIdentity == id)
    const associatedComponent = annotation.component
    const definition = associatedComponent.definition
    const sequences = definition.sequences

    sequences[0].destroy()
    annotation.destroy()
    associatedComponent.destroy()
    definition.destroy()
}

export function incrementVersion(componentDefinition) {
    const version = Number(componentDefinition.version)

    componentDefinition.version = version + 1
}

/**
 * Finds existing SequenceAnnotations on a ComponentDefinition and returns
 * them in a form suitable for the store.
 *
 * @export
 * @param {S2ComponentDefinition} componentDefinition
 * @return {any[]} 
 */
export function getExistingSequenceAnnotations(componentDefinition) {
    return componentDefinition.sequenceAnnotations.map(sa => ({
        id: sa.persistentIdentity,
        name: sa.displayName,
        location: [sa.locations[0].start - 1, sa.locations[0].end], // convert to 0 based indexing to match javascript array indices
    }))
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
