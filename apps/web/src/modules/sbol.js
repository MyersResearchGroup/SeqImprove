import { Predicates } from "bioterms"

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