import { useState } from 'react'
import { useStore } from '../modules/store'
import { ActionIcon, Box, Group, Tooltip } from '@mantine/core'
import { useClickOutside, useDisclosure } from '@mantine/hooks'
import AnnotationCheckbox from './AnnotationCheckbox'
import TextAnnotationModal from './TextAnnotationModal'
import TextLink from "./TextLink"
import { FaPencilAlt, FaTrashAlt } from 'react-icons/fa'


export default function TextAnnotationCheckbox({ id, color }) {

    // grab state from store
    const annotation = useStore(s => s.textAnnotationActions.getAnnotation(id))
    const { editAnnotation, removeAnnotation } = useStore(s => s.textAnnotationActions)

    // editing state and handlers
    const [editing, editingHandlers] = useDisclosure(false)
    const handleEdit = formValues => {
        editAnnotation(id, formValues)
    }

    // state for confirming deletion
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const handleDeleteClick = () => {
        confirmingDelete ? removeAnnotation(id) : setConfirmingDelete(true)
    }
    const deleteRef = useClickOutside(() => setConfirmingDelete(false))

    return (
        <>
            <AnnotationCheckbox
                title={annotation.terms[0]}
                subtitle={
                    <Group spacing="xs" position="apart" sx={{ flexGrow: 1, }}>
                        <Tooltip label={id} position="bottom" withArrow>
                            <Box>
                                <TextLink color="gray" href={id}>{annotation.displayId}</TextLink>
                            </Box>
                        </Tooltip>
                        <Group spacing={6}>
                            {annotation.deletable &&
                                <ActionIcon color={confirmingDelete ? "red" : "gray"} onClick={handleDeleteClick} ref={deleteRef}>
                                    <FaTrashAlt />
                                </ActionIcon>}
                            <ActionIcon onClick={editingHandlers.open}>
                                <FaPencilAlt />
                            </ActionIcon>
                        </Group>
                    </Group>
                }
                color={color}
                active={annotation.active}
                onChange={val => annotation.active = val}
            />
            <TextAnnotationModal opened={editing} onClose={editingHandlers.close} onSubmit={handleEdit} values={annotation} />
        </>
    )
}
