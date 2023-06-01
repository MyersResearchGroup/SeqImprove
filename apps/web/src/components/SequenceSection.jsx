import { Button, Center, Loader, NavLink, Space } from "@mantine/core"
import { FiDownloadCloud } from "react-icons/fi"
import { useAsyncLoader, useStore } from "../modules/store"
import AnnotationCheckbox from "./AnnotationCheckbox"
import FormSection from "./FormSection"
import SequenceHighlighter from "./SequenceHighlighter"


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
            {annotations.map((anno, i) =>
                <AnnotationCheckbox
                    title={anno.name}
                    color={colors[i]}
                    active={isActive(anno.id) ?? false}
                    onChange={val => setActive(anno.id, val)}
                    key={anno.name + i}
                />
            )}

            {loading ?
                <Center>
                    <Loader my={30} size="sm" variant="dots" /> :
                </Center>
                :
                <NavLink
                    label="Analyze Sequence"
                    icon={<FiDownloadCloud />}
                    variant="subtle"
                    active={true}
                    color="blue"
                    onClick={load}
                    sx={{ borderRadius: 6 }}
                />}
        </FormSection>
    )
}


export default {
    Sequence, Annotations
}