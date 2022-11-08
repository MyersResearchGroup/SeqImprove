import { ActionIcon, Box, Group, Textarea } from "@mantine/core"
import { useState } from "react"
import { FaCheck, FaPencilAlt, FaTimes } from "react-icons/fa"
import AddTextAnnotation from "../components/AddTextAnnotation"
import FormSection from "../components/FormSection"
import TextAnnotationCheckbox from "../components/TextAnnotationCheckbox"
import TextHighlighter from "../components/TextHighlighter"
import { useStore } from "../modules/store"
import { useCyclicalColors } from "./misc"


export default function useTextAnnotations() {

    // pull out what we need from the store
    const description = useStore(s => s.description)
    const setDescription = useStore(s => s.setDescription)
    const annotations = useStore(s => s.textAnnotations)
    const { isAnnotationActive, selectAnnotation, deselectAnnotation } = useStore(s => s.textAnnotationActions)

    // create a set of contrasty colors
    const colors = useCyclicalColors(annotations.length)

    // description editing state
    const [workingDescription, setWorkingDescription] = useState(false)
    const handleDescriptionEdit = () => {
        setDescription(workingDescription)
        setWorkingDescription(false)
    }

    return [
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
                <TextHighlighter
                    terms={annotations.map((anno, i) =>
                        anno.terms.map(termText => {
                            const foundMentions = []
                            const reg = new RegExp(termText, "gi")
                            let occurence
                            while (occurence = reg.exec(description)) {
                                foundMentions.push({
                                    id: anno.id,
                                    color: colors[i],
                                    active: isAnnotationActive(anno.id) ?? false,
                                    start: occurence.index,
                                    end: occurence.index + termText.length,
                                })
                            }
                            return foundMentions
                        }).flat()
                    ).flat()}
                    onChange={(id, val) => val ? selectAnnotation(id) : deselectAnnotation(id)}
                    h={200}
                >
                    {description}
                </TextHighlighter>}
        </FormSection>,

        <FormSection title="Recognized Terms" w={350}>
            {annotations.map((anno, i) =>
                <TextAnnotationCheckbox id={anno.id} color={colors[i]} key={anno.id} />
            )}

            <AddTextAnnotation />
        </FormSection>
    ]
}