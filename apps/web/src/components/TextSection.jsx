import { ActionIcon, Button, Center, Group, Loader, Select, Text, Textarea } from "@mantine/core"
import { useState } from "react"
import { FaCheck, FaPencilAlt, FaPlus, FaTimes } from "react-icons/fa"
import { useAsyncLoader, useStore } from "../modules/store"
import AddTextAnnotation from "./AddTextAnnotation"
import FormSection from "./FormSection"
import TextAnnotationCheckbox from "./TextAnnotationCheckbox"
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

    // text selection state
    const [selection, setSelection] = useState()

    return (
        <>
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

                    description &&
                    <RichText
                        onSelectionChange={setSelection}
                        colorMap={Object.fromEntries(annotations.map((anno, i) => [anno.id, colors[i]]))}
                    >
                        {description}
                    </RichText>
                }
            </FormSection>

            {selection &&
                <Group position="center">
                    <Button variant="outline" radius="xl" leftIcon={<FaPlus />}>New Annotation</Button>
                    <Select
                        radius="xl"
                        placeholder="Add to existing annotation"
                        data={[
                            { value: 'react', label: 'React' },
                            { value: 'ng', label: 'Angular' },
                            { value: 'svelte', label: 'Svelte' },
                            { value: 'vue', label: 'Vue' },
                        ]}
                    />
                    <Button variant="subtle" radius="xl" onClick={selection.clear}>Clear Selection</Button>
                </Group>
            }
        </>
    )
}

function Annotations({ colors }) {

    const annotations = useStore(s => s.textAnnotations)
    const [load, loading] = useAsyncLoader("TextAnnotations")
    useStore(s => s.document?.root.richDescription)    // force rerender from document change

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