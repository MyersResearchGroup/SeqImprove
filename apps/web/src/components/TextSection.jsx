import { ActionIcon, Button, Center, Group, Loader, NavLink, Select, Text, Textarea } from "@mantine/core"
import { forwardRef, useMemo, useState } from "react"
import { FaCheck, FaPencilAlt, FaPlus, FaTimes, FaArrowRight } from "react-icons/fa"
import { FiDownloadCloud } from "react-icons/fi"
import { mutateDocument, useAsyncLoader, useStore } from "../modules/store"
import FormSection from "./FormSection"
import TextAnnotationCheckbox from "./TextAnnotationCheckbox"
import { openConfirmModal, openContextModal } from "@mantine/modals"
import { showNotification } from "@mantine/notifications"
import { hasTrailingPunctuation, removeTrailingPunctuation } from "../modules/text"
import RichDescription from "./RichDescription"
import produce from "immer"


function Description({ colors }) {

    const annotations = useStore(s => s.textAnnotations)
    const { getAnnotation, editAnnotation, setActive, isActive, removeAnnotation } = useStore(s => s.textAnnotationActions)

    console.log("start: ", annotations)

    // make a map of colors for easier access
    const colorMap = useMemo(() => Object.fromEntries(annotations.map((anno, i) => [anno.id, colors[i]])), [colors])


    // description editing state
    const description = useStore(s => s.document?.root.richDescription)
    const richDescriptionBuffer = useStore(s => s.richDescriptionBuffer)
    const [isEditingDescription, setIsEditingDescription] = useState(false);
    const [workingDescription, setWorkingDescription] = useState(false);

    // handle the start of editing the description
    const handleStartDescriptionEdit = () => {
        setIsEditingDescription(true);
        setWorkingDescription(richDescriptionBuffer.originalText)
    }

    // handle finishing editing the description
    const handleEndDescriptionEdit = (cancel = false) => {
        if (!cancel) {

            // change text in buffer
            richDescriptionBuffer.changeText(workingDescription)

            // update mentions with new start & end
            annotations.forEach(anno => {
                editAnnotation(anno.id, {
                    mentions: produce(anno.mentions, draft => {
                        draft.forEach(mention => {
                            mention.start = mention.bufferPatch.start
                            mention.end = mention.bufferPatch.end
                            console.log("mention.start: ", mention.start);
                            console.log("mention.end: ", mention.end);
                        })
                    })
                });
            });

            // for each annotation, check to see if there are any mentions. If all mentions are gone, remove the annotation.
            annotations.forEach(anno => {
                const textAliases = Object.keys(anno.mentions.reduce((aliases, mention) => {
                    return {
                        ...aliases,
                        [mention.text]: true,
                    };
                }, {}));
                
                let newMentions = [];
                let foundInText = false;
                                
                textAliases.forEach(alias => {
                    const regexp = new RegExp(alias, 'g');
                    const matches = workingDescription.matchAll(regexp);

                    let match = matches.next();
                    if (match.done) {
                        return;
                    }


                    while (!match.done) {
                        const start = match.value.index;
                        const end = match.value[0].length + start;
                        newMentions.push({ start, end, text: alias });                                                
                        match = matches.next();
                    }

                    foundInText = true;
                    return;
                });

                if (!foundInText) {
                    setActive(anno.id, false);
                    removeAnnotation(anno.id);
                    return;
                }

                newMentions.forEach(mention => {
                    mention.bufferPatch = richDescriptionBuffer.createAlias(mention.start, mention.end, `[${mention.text}](${anno.id})`);
                })

                editAnnotation(anno.id, {
                    mentions: produce(anno.mentions, draft => newMentions)
                });
                
                // look at the workingDescription.
                // regex to find all instances of the annotation text (e.g. "GFP") in the workingDescription.                
                // - corresponding to mentions? How do I find these exactly?
                // update the annotation mentions start and end locations to reflect the match locations in the workingDescription
                // if there are no matches, set inactive: setActive(anno.id, false) and removeAnnotation(anno.id);
                
                // if (anno.mentions.length == 0) {                
                //     const { setActive, removeAnnotation } = useStore(s => s.textAnnotationActions);

                //     const handleDeleteClick = () => {
                //         setActive(anno.id, false)
                //         removeAnnotation(anno.id)
                //     }
                // }
            });


            // propagate buffer changes to rich description
            mutateDocument(useStore.setState, state => {
                state.document.root.richDescription = richDescriptionBuffer.getText()
                state.document.root.description = richDescriptionBuffer.originalText
            });
        }
        setWorkingDescription(false);
        setIsEditingDescription(false);
    }

    // text selection state
    const [selection, setSelection] = useState()

    // handle adding mention from selection
    const handleAddMention = annoId => {
        const anno = getAnnotation(annoId)
        const newMention = {
            text: selection.toString(),
            start: selection.range[0],
            end: selection.range[1],
        }

        selection.empty()


        // make sure new mention doesn't overlap existing mentions
        const allMentions = annotations.map(a => a.mentions.map(m => ({
            ...m, annotationId: a.id,
        }))).flat()

        const overlappingMention = allMentions.find(mention =>
            !(mention.start > newMention.end - 1 ||
                newMention.start > mention.end - 1)
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
            newMention.bufferPatch = richDescriptionBuffer.createAlias(newMention.start, newMention.end, `[${newMention.text}](${annoId})`)

            editAnnotation(annoId, {
                mentions: [
                    ...anno.mentions,
                    newMention,
                ]
            })

            // set active to show new mention
            setActive(annoId, true)
        }

        // Disabling this for now because it doesn't adjust start/end indices
        // detect trailing punctuation / special characters
        if (hasTrailingPunctuation(newMention.text)) {
            const { text: replacement, length: trailingLength } = removeTrailingPunctuation(newMention.text)

            openConfirmModal({
                title: "Remove trailing whitespace & punctuation?",
                children: <>
                    <Text size="sm">
                        There was trailing whitespace and/or punctuation detected in your selection. Would you like to exclude
                        it from the mention?
                    </Text>
                    <Group my={10} position="center">
                        <Text>"{newMention.text}"</Text>
                        <Text color="dimmed"><FaArrowRight fontSize={10} /></Text>
                        <Text weight={600}>"{replacement}"</Text>
                    </Group>
                </>,
                labels: { confirm: "Remove it", cancel: "Keep it" },
                onConfirm: () => {
                    newMention.text = replacement
                    newMention.end -= trailingLength
                    addMention()
                },
                onCancel: addMention,
            })
            return
        }

        // otherwise, just add the mention normally
        addMention()
    }

    return (
        <>
            <FormSection title="Description" rightSection={
                isEditingDescription ?
                    <Group spacing={6}>
                        <ActionIcon onClick={() => handleEndDescriptionEdit(true)} color="red"><FaTimes /></ActionIcon>
                        <ActionIcon onClick={() => handleEndDescriptionEdit(false)} color="green"><FaCheck /></ActionIcon>
                    </Group> :
                    <ActionIcon onClick={handleStartDescriptionEdit}><FaPencilAlt /></ActionIcon>
            }>
                {isEditingDescription ?
                    <Textarea
                        size="md"
                        minRows={8}
                        value={workingDescription}
                        onChange={event => setWorkingDescription(event.currentTarget.value)}
                    /> :

                    description &&
                    <RichDescription
                        onSelectionChange={setSelection}
                        colorMap={colorMap}
                    />
                }
            </FormSection>
            {selection &&
                <Group position="center" onMouseDown={event => event.preventDefault()}>
                    {annotations.length ?
                        <>
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
                                w={250}
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
                            <Button variant="subtle" radius="xl" onClick={() => selection.empty()}>Clear Selection</Button>
                        </>
                        :
                        <>
                            <Text color="dimmed" size="sm">Create or load text annotations to get started.</Text>
                        </>}
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
        <FormSection title="Recognized Terms">
            {annotations.map((anno, i) =>
                <TextAnnotationCheckbox id={anno.id} color={colors[i]} key={anno.id} />
            )}

            <NavLink
                label="Create Text Annotation"
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

            {loading ?
                <Center>
                    <Loader my={30} size="sm" variant="dots" /> :
                </Center>
                :
                <NavLink
                    label="Analyze Text"
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
