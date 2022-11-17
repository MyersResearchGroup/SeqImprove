import { useState } from 'react'
import { useStore } from '../modules/store'
import { ActionIcon, Box, Group, Tooltip } from '@mantine/core'
import { useClickOutside } from '@mantine/hooks'
import AnnotationCheckbox from './AnnotationCheckbox'
import TextLink from "./TextLink"
import { FaPencilAlt, FaTrashAlt } from 'react-icons/fa'
import { openContextModal } from '@mantine/modals'


export default function TextAnnotationCheckbox({ id, color }) {

    // grab state from store
    const annotation = useStore(s => s.textAnnotationActions.getAnnotation(id))
    const { isActive, setActive, removeAnnotation } = useStore(s => s.textAnnotationActions)

    // state for confirming deletion
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const handleDeleteClick = () => {
        confirmingDelete ? removeAnnotation(id) : setConfirmingDelete(true)
    }
    const deleteRef = useClickOutside(() => setConfirmingDelete(false))


    return (
        <>
            <AnnotationCheckbox
                title={annotation.label}
                subtitle={
                    <Group spacing="xs" position="apart">
                        <Tooltip label={id} position="bottom" withArrow>
                            <Box>
                                <TextLink color="gray" href={id}>{annotation.displayId}</TextLink>
                            </Box>
                        </Tooltip>
                        <Group spacing={6}>
                            <ActionIcon onClick={() => openContextModal({
                                modal: "addAndEdit",
                                title: "Edit Annotation",
                                innerProps: {
                                    editing: true,
                                    label: annotation.label,
                                    identifier: annotation.displayId,
                                    uri: annotation.id,
                                }
                            })}>
                                <FaPencilAlt />
                            </ActionIcon>

                            <ActionIcon color={confirmingDelete ? "red" : "gray"} onClick={handleDeleteClick} ref={deleteRef}>
                                <FaTrashAlt />
                            </ActionIcon>
                        </Group>
                    </Group>
                }
                color={color}
                active={isActive(id)}
                onChange={val => setActive(id, val)}
            />
        </>
    )
}
