import { Button, Center, Group, Loader, NavLink, Space, CopyButton, ActionIcon, Tooltip } from "@mantine/core"
import { FiDownloadCloud } from "react-icons/fi"
import { useAsyncLoader, useStore } from "../modules/store"
import AnnotationCheckbox from "./AnnotationCheckbox"
import FormSection from "./FormSection"
import SequenceHighlighter from "./SequenceHighlighter"
import { Copy, Check } from "tabler-icons-react"

function Copier({ anno, sequence }) {
    const selectionStart = anno.location[0]
    const selectionLength = anno.location[1] - selectionStart
    const selection = Array.from(sequence).splice(selectionStart, selectionLength).join('') 

    return (
        <CopyButton value={selection} timeout={2000}>
            {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="right">
                    <ActionIcon color={copied ? 'teal' : 'gray'} onClick={copy}>
                        {copied ? <Check size="1rem" /> : <Copy size="1rem" />}
                    </ActionIcon>
                </Tooltip>
            )}
        </CopyButton>
  );
}

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
                    isActive={isActive}
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

    const sequence = useStore(s => s.document?.root.sequence).toLowerCase()

    return (
        <FormSection title="Sequence Annotations">
            {annotations.map((anno, i) =>
                <Group spacing="xs" sx={{ flexGrow: 1, }} key={anno.name}>
                    <AnnotationCheckbox                        
                        title={anno.name}
                        color={colors[i]}
                        active={isActive(anno.id) ?? false}
                        onChange={val => setActive(anno.id, val)}
<<<<<<< HEAD
                        key={anno.name}
=======
                        key={anno.name + i}
>>>>>>> main
                    />                    
                    <Copier anno={anno} sequence={sequence}/>   
                </Group>              
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