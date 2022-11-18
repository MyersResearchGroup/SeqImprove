import { Button, Center, Loader } from "@mantine/core"
import { useAsyncLoader, useStore } from "../modules/store"
import AnnotationCheckbox from "./AnnotationCheckbox"
import FormSection from "./FormSection"
import TextHighlighter from "./TextHighlighter"


function Sequence({ colors }) {

    const sequence = useStore(s => s.document?.root.sequence)

    const annotations = useStore(s => s.sequenceAnnotations)
    useStore(s => s.document?.root.sequenceAnnotations)    // force rerender from document change

    const { isActive, setActive } = useStore(s => s.sequenceAnnotationActions)

    return (
        <FormSection title="Sequence">
            {sequence && <TextHighlighter
                terms={annotations.map((anno, i) => ({
                    id: anno.id,
                    start: anno.location[0],
                    end: anno.location[1],
                    color: colors[i],
                    active: isActive(anno.id) ?? false,
                }))}
                onChange={setActive}
                h={400}
                offsetStart={-1}
                wordMode={8}
                textStyle={{
                    fontFamily: "monospace",
                    fontSize: 14,
                    letterSpacing: 0.2,
                }}
            >
                {sequence?.toLowerCase()}
            </TextHighlighter>}
        </FormSection>
    )
}


function Annotations({ colors }) {

    const annotations = useStore(s => s.sequenceAnnotations)
    const [load, loading] = useAsyncLoader("SequenceAnnotations")
    useStore(s => s.document?.root?.sequenceAnnotations)    // force rerender from document change

    const { isActive, setActive } = useStore(s => s.sequenceAnnotationActions)

    return (
        <FormSection title="Sequence Annotations">
            {annotations?.length ?
                annotations.map((anno, i) =>
                    <AnnotationCheckbox
                        title={anno.name}
                        color={colors[i]}
                        active={isActive(anno.id) ?? false}
                        onChange={val => setActive(anno.id, val)}
                        key={anno.name}
                    />
                )
                :
                <Center>
                    {loading ?
                        <Loader my={30} size="sm" variant="dots" /> :
                        <Button my={10} onClick={load}>Load Sequence Annotations</Button>}
                </Center>}
        </FormSection>
    )
}


export default {
    Sequence, Annotations
}