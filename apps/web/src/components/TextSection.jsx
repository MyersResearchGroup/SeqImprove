import { ActionIcon, Button, Center, Group, Loader, Text, Textarea } from "@mantine/core"
import { useState } from "react"
import ReactMarkdown from 'react-markdown'
import { FaCheck, FaPencilAlt, FaTimes } from "react-icons/fa"
import { useAsyncLoader, useStore } from "../modules/store"
import AddTextAnnotation from "./AddTextAnnotation"
import FormSection from "./FormSection"
import TextAnnotationCheckbox from "./TextAnnotationCheckbox"
import TextHighlighter from "./TextHighlighter"
import RichText from "./RichText"


function Description({ colors }) {

    const annotations = useStore(s => s.textAnnotations)

    const description = useStore(s => s.document?.root.richDescription)
    const setDescription = useStore(s => s.document?.root.setDescription)

    // description editing state
    const [workingDescription, setWorkingDescription] = useState(false)
    const handleDescriptionEdit = () => {
        setDescription(workingDescription)
        setWorkingDescription(false)
    }

    return (
        <FormSection title="Description" rightSection={
            workingDescription ?
                <Group spacing={6}>
                    <ActionIcon onClick={() => setWorkingDescription(false)} color="red"><FaTimes /></ActionIcon>
                    <ActionIcon onClick={handleDescriptionEdit} color="green"><FaCheck /></ActionIcon>
                </Group> :
                <ActionIcon onClick={() => setWorkingDescription(description)}><FaPencilAlt /></ActionIcon>
        }>
            {workingDescription ?
                <Textarea
                    size="md"
                    minRows={8}
                    value={workingDescription}
                    onChange={event => setWorkingDescription(event.currentTarget.value)}
                /> :
                // <TextHighlighter
                //     terms={annotations.map((anno, i) =>
                //         anno.terms.map(termText => {
                //             const foundMentions = []
                //             const reg = new RegExp(termText, "gi")
                //             let occurence
                //             while (occurence = reg.exec(description)) {
                //                 foundMentions.push({
                //                     id: anno.id,
                //                     color: colors[i],
                //                     active: anno.active,
                //                     start: occurence.index,
                //                     end: occurence.index + termText.length,
                //                 })
                //             }
                //             return foundMentions
                //         }).flat()
                //     ).flat()}
                //     onChange={(id, val) => annotations.find(anno => anno.id == id).active = val}
                //     h={200}
                // >
                //     {description}
                // </TextHighlighter>
                description &&
                <RichText
                    colorMap={Object.fromEntries(annotations.map((anno, i) => [anno.id, colors[i]]))}
                >
                    {description}
                </RichText>
            }
        </FormSection>
    )
}

function Annotations({ colors }) {

    const annotations = useStore(s => s.textAnnotations)
    const [load, loading] = useAsyncLoader("TextAnnotations")
    useStore(s => s.document?.root.richDescription)    // force rerender from document change

    // console.log(useStore(s => s.document?.root.richDescription))

    return (
        <FormSection title="Recognized Terms" w={350}>
            {annotations.length ?
                annotations.map((anno, i) =>
                    <TextAnnotationCheckbox id={anno.id} color={colors[i]} key={anno.id} />
                )
                :
                <Center>
                    {loading ?
                        <Loader my={30} size="sm" variant="dots" /> :
                        <Button my={10} onClick={load}>Load Text Annotations</Button>}
                </Center>}

            <AddTextAnnotation />
        </FormSection>
    )
}

export default {
    Description, Annotations
}