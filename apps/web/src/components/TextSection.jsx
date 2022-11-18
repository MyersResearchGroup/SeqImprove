import { ActionIcon, Button, Center, Group, Loader, NavLink, Select, Text, Textarea } from "@mantine/core"
import { forwardRef, useMemo, useState } from "react"
import { FaCheck, FaPencilAlt, FaPlus, FaTimes, FaArrowRight } from "react-icons/fa"
import { useAsyncLoader, useStore } from "../modules/store"
import FormSection from "./FormSection"
import TextAnnotationCheckbox from "./TextAnnotationCheckbox"
import RichText from "./RichText"
import { openConfirmModal, openContextModal } from "@mantine/modals"
import { showNotification } from "@mantine/notifications"
import { hasTrailingPunctuation, removeTrailingPunctuation } from "../modules/text"


function Description({ colors }) {

    const annotations = useStore(s => s.textAnnotations)
    const { getAnnotation, editAnnotation, setActive } = useStore(s => s.textAnnotationActions)

    // console.log(annotations)

    // make a map of colors for easier access
    const colorMap = useMemo(() => Object.fromEntries(annotations.map((anno, i) => [anno.id, colors[i]])), [colors])

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

    // handle adding mention from selection
    const handleAddMention = annoId => {
        const anno = getAnnotation(annoId)
        const newMention = {
            text: selection.selectedWords.map(sw => sw.text).join(" "),
            startWord: Math.min(...selection.selectedWords.map(sw => sw.index)),
            length: selection.selectedWords.reduce((accum, sw) => accum + (sw.length ?? 1), 0),
        }

        selection.clear()


        // make sure new mention doesn't overlap existing mentions
        const allMentions = annotations.map(a => a.mentions.map(m => ({
            ...m, annotationId: a.id,
        }))).flat()

        const overlappingMention = allMentions.find(mention =>
            !(mention.startWord > newMention.startWord + newMention.length - 1 ||
                newMention.startWord > mention.startWord + (mention.length ?? 1) - 1)
        )

        if (!!overlappingMention) {
            showNotification({
                title: "Can't add mention",
                message: "Mention overlaps existing mentions.",
                color: "red",
            })
            // set active to show conflicting mention
            setActive(overlappingMention.annotationId, true)
            return
        }

        
        // action to add mention to annotation
        const addMention = () => {
            editAnnotation(annoId, {
                mentions: [
                    ...anno.mentions,
                    newMention,
                ]
            })

            // set active to show new mention
            setActive(annoId, true)
        }

        // detect trailing punctuation / special characters
        if (hasTrailingPunctuation(newMention.text)) {
            const replacement = removeTrailingPunctuation(newMention.text)

            openConfirmModal({
                title: "Remove trailing punctuation?",
                children: <>
                    <Text size="sm">
                        There was trailing punctuation detected in your selection. Would you like to exclude
                        it from the mention?
                    </Text>
                    <Group my={10} position="center">
                        <Text>{newMention.text}</Text>
                        <Text color="dimmed"><FaArrowRight fontSize={10} /></Text>
                        <Text weight={600}>{replacement}</Text>
                    </Group>
                </>,
                labels: { confirm: "Remove Punctuation", cancel: "Keep Punctuation" },
                onConfirm: () => {
                    newMention.text = replacement
                    addMention()
                },
                onCancel: addMention,
            })
            return
        }

        // otherwise, just add the mention normally
        addMention()
    }

    // handle removing mentions
    const handleRemoveMention = word => {
        const anno = getAnnotation(word.id)
        editAnnotation(word.id, {
            mentions: anno.mentions.filter(mention =>
                mention.startWord != word.index ||
                mention.length != word.length
            )
        })
    }

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
                        onRemoveMention={handleRemoveMention}
                        colorMap={colorMap}
                    >
                        {description}
                    </RichText>
                }
            </FormSection>

            {selection &&
                <Group position="center">
                    {/* Create New Annotation Button */}
                    {/* <Button
                        variant="outline"
                        radius="xl"
                        leftIcon={<FaPlus />}
                    >
                        New Annotation
                    </Button> */}

                    {/* Add to Existing Annotation Select */}
                    <Select
                        radius="xl"
                        placeholder="Add to existing annotation"
                        itemComponent={SelectItem}
                        onChange={handleAddMention}
                        data={annotations.map(anno => ({
                            label: anno.label,
                            value: anno.id,
                            annotation: anno,
                            color: colorMap[anno.id],
                        }))}
                    />

                    {/* Clear Selection Button */}
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

            <NavLink
                label="Add Text Annotation"
                icon={<FaPlus />}
                variant="subtle"
                active={true}
                color="blue"
                onClick={() => openContextModal({
                    modal: "addAndEdit",
                    title: "Add Annotation",
                    innerProps: {
                        editing: false,
                    }
                })}
                sx={{ borderRadius: 6 }}
            />
        </FormSection>
    )
}

export default {
    Description, Annotations
}


const SelectItem = forwardRef(({ annotation, label, color, ...props }, ref) => {
    return (
        <div ref={ref} {...props}>
            <Group position="apart">
                <Text weight={600} color={color}>{label}</Text>
                <Text size="xs" color="dimmed">{annotation.displayId}</Text>
            </Group>
        </div>
    )
})