import { Button, Center, Loader, Space } from "@mantine/core"
import { useAsyncLoader, useStore } from "../modules/store"
import AnnotationCheckbox from "./AnnotationCheckbox"
import FormSection from "./FormSection"
import SequenceHighlighter from "./SequenceHighlighter"
import TextHighlighter from "./TextHighlighter"


function Sequence({ colors }) {

    const sequence = useStore(s => s.document?.root.sequence)

    const annotations = useStore(s => s.sequenceAnnotations)
    useStore(s => s.document?.root.sequenceAnnotations)    // force rerender from document change

    const { isActive, setActive } = useStore(s => s.sequenceAnnotationActions)

    return (
        <FormSection title="Sequence">
            {sequence &&
                <SequenceHighlighter
                    sequence={sequence.toLowerCase()}
                    annotations={annotations.map((anno, i) => ({
                        ...anno,
                        color: colors[i],
                        active: isActive(anno.id) ?? false,
                    }))}
                    onChange={setActive}
                    wordSize={8}
                />}
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