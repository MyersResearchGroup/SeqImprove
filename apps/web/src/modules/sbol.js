import { Predicates } from "bioterms"
import { Graph, SBOL2GraphView } from "sbolgraph"

export async function createSBOLDocument(sbolContent) {
    const document = new SBOL2GraphView(new Graph())
    await document.loadString(sbolContent)
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
        Predicates.SBOL2.sequenceAnnotation,
        annotation.subject
    )
}

export function hasTextAnnotation(componentDefinition, annotationId) {
    return false
}

export function addTextAnnotation(componentDefinition, annoInfo) {

}

export function removeTextAnnotation(componentDefinition, annotationId) {
    
}