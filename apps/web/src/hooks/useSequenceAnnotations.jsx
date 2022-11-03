import AnnotationCheckbox from "../components/AnnotationCheckbox"
import FormSection from "../components/FormSection"
import TextHighlighter from "../components/TextHighlighter"
import { useStore } from "../modules/store"
import { useCyclicalColors } from "./hooks"

export default function useSequenceAnnotations() {

    // pull out what we need from the store
    const sequence = useStore(s => s.sequence)
    const annotations = useStore(s => s.sequenceAnnotations)
    const { isAnnotationActive, selectAnnotation, deselectAnnotation } = useStore(s => s.sequenceAnnotationActions)

    // create a set of contrasty colors
    const colors = useCyclicalColors(annotations.length)

    return [
        <FormSection title="Sequence">
            <TextHighlighter
                terms={annotations.map((anno, i) => ({
                    id: anno.id,
                    start: anno.location[0],
                    end: anno.location[1],
                    color: colors[i],
                    active: isAnnotationActive(anno.id) ?? false,
                }))}
                onChange={(id, val) => val ? selectAnnotation(id) : deselectAnnotation(id)}
                h={400}
                offsetStart={-1}
                wordMode={8}
                textStyle={{
                    fontFamily: "monospace",
                    fontSize: 14,
                    letterSpacing: 0.2,
                }}
            >
                {sequence.toLowerCase()}
            </TextHighlighter>
        </FormSection>,

        <FormSection title="Sequence Annotations" w={350}>
            {annotations.map((anno, i) =>
                <AnnotationCheckbox
                    title={anno.name}
                    color={colors[i]}
                    active={isAnnotationActive(anno.id) ?? false}
                    onChange={val => val ? selectAnnotation(anno.id) : deselectAnnotation(anno.id)}
                    key={anno.name}
                />
            )}
        </FormSection>
    ]
}