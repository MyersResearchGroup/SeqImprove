import { useState } from "react"
import { Button, Center, Group, Loader, NavLink, Space, CopyButton, ActionIcon, Tooltip, Textarea } from "@mantine/core"
import { FiDownloadCloud } from "react-icons/fi"
import { FaCheck, FaPencilAlt, FaPlus, FaTimes, FaArrowRight } from "react-icons/fa"
import { mutateDocument, useAsyncLoader, useStore } from "../modules/store"
import AnnotationCheckbox from "./AnnotationCheckbox"
import FormSection from "./FormSection"
import SequenceHighlighter from "./SequenceHighlighter"
import { Copy, Check } from "tabler-icons-react"
import "../index.css"

const WORDSIZE = 8;

function Copier({ anno, sequence }) {
    const selectionStart = anno.location[0];
    const selectionLength = anno.location[1] - selectionStart;
    const selection = Array.from(sequence).splice(selectionStart, selectionLength).join('');

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

function insertSpaces(wordSize, sequence) {
    const regex = new RegExp(".{1," + String(wordSize) + "}", "g");
    const matchData = sequence.match(regex);
    return matchData ? sequence.match(regex).join(' ') : sequence;
}

function reformat(sequenceText) {
    // return insertSpaces(WORDSIZE, sequenceText.replace(/\s/g, ''));
    return sequenceText;
}

function Sequence({ colors }) {

    const sequence = useStore(s => s.document?.root.sequence);

    const annotations = useStore(s => s.sequenceAnnotations);
    useStore(s => s.document?.root.sequenceAnnotations);    // force rerender from document change

    const { isActive, setActive } = useStore(s => s.sequenceAnnotationActions);

    // sequence editing state
    // const description = useStore(s => s.document?.root.richDescription)
    // const richDescriptionBuffer = useStore(s => s.richDescriptionBuffer)
    // const [workingDescription, setWorkingDescription] = useState(false)
    const [workingSequence, setWorkingSequence] = useState(false);

    const handleStartSequenceEdit = () => {
        // put spaces in text based on WORDSIZE ? or should I do this? yes, it would be nice, but not required        
        setWorkingSequence(insertSpaces(WORDSIZE, sequence.toLowerCase()));
    };

    const handleEndSequenceEdit = (discard = false) => {
        if (discard) {
            setWorkingSequence(false);
            return;
        }

        setWorkingSequence(false);

        // propagate buffer changes to sequence
        mutateDocument(useStore.setState, state => {
            state.document.root.sequence = workingSequence.replace(/\s/g, '');
            state.sequenceAnnotations.forEach(anno => {
                state.sequenceAnnotationActions.removeAnnotation(anno.id);
            });
        });
    }

    return (
        <FormSection title="Sequence" rightSection={
                workingSequence !== false ?
                    <Group spacing={6}>
                        <ActionIcon onClick={() => handleEndSequenceEdit(true)} color="red"><FaTimes /></ActionIcon>
                        <ActionIcon onClick={() => handleEndSequenceEdit(false)} color="green"><FaCheck /></ActionIcon>
                    </Group> :
                    <ActionIcon onClick={handleStartSequenceEdit}><FaPencilAlt /></ActionIcon>
            }>
            {workingSequence !== false ?
                    <Textarea
                        size="md"
                        minRows={20}
                        value={workingSequence}
                        onChange={event => {
                            const textArea = event.currentTarget;
                            const start = textArea.selectionStart;
                            const end = textArea.selectionEnd;
                            
                            setWorkingSequence(reformat(textArea.value));                            
                        }}
                        styles={{ input: { font: "14px monospace", lineHeight: "1.5em" } }}
                    /> : sequence &&
                    <SequenceHighlighter
                    sequence={sequence.toLowerCase()}
                    annotations={annotations.map((anno, i) => ({
                        ...anno,
                        color: colors[i],
                        active: isActive(anno.id) ?? false,
                    }))}
                    onChange={setActive}
                    isActive={isActive}
                    wordSize={WORDSIZE}
                    />
            }       
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
                        key={anno.name + i}
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
