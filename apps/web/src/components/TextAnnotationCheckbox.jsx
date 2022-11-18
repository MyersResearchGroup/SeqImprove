import { useState } from 'react'
import { useStore } from '../modules/store'
import { ActionIcon, Box, Group, Popover, Text, ThemeIcon, Tooltip, useMantineTheme } from '@mantine/core'
import { useClickOutside } from '@mantine/hooks'
import AnnotationCheckbox from './AnnotationCheckbox'
import TextLink from "./TextLink"
import { FaPencilAlt, FaTrashAlt } from 'react-icons/fa'
import { IoWarningOutline } from "react-icons/io5"
import { openContextModal } from '@mantine/modals'


export default function TextAnnotationCheckbox({ id, color }) {

    const theme = useMantineTheme()

    // grab state from store
    const annotation = useStore(s => s.textAnnotationActions.getAnnotation(id))
    const { isActive, setActive, removeAnnotation } = useStore(s => s.textAnnotationActions)

    // state for confirming deletion
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const handleDeleteClick = () => {
        if(confirmingDelete) {
            setActive(id, false)
            removeAnnotation(id)
        }
        else
        setConfirmingDelete(true)
    }
    const deleteRef = useClickOutside(() => setConfirmingDelete(false))

    // checkbox component -- conditionally goes inside a PopOver
    const checkboxComponent =
        <AnnotationCheckbox
            title={annotation.label}
            subtitle={
                <Group spacing="xs" position="apart">
                    <Tooltip label={id} position="bottom" withArrow>
                        <Box>
                            <TextLink color="gray" href={id}>{annotation.displayId}</TextLink>
                        </Box>
                    </Tooltip>
                    <Group spacing={5}>
                        <ActionIcon
                            size="sm"
                            onClick={() => openContextModal({
                                modal: "addAndEdit",
                                title: "Edit Annotation",
                                innerProps: {
                                    editing: true,
                                    label: annotation.label,
                                    identifier: annotation.displayId,
                                    uri: annotation.id,
                                }
                            })}
                        >
                            <FaPencilAlt fontSize={"0.8em"} />
                        </ActionIcon>

                        <ActionIcon
                            size="sm"
                            color={confirmingDelete ? "red" : "gray"}
                            onClick={handleDeleteClick}
                            ref={deleteRef}
                        >
                            <FaTrashAlt fontSize={"0.8em"} />
                        </ActionIcon>
                    </Group>
                </Group>
            }
            color={color}
            active={isActive(id)}
            onChange={val => setActive(id, val)}
        />

    return annotation.mentions?.length ?
        checkboxComponent
        :
        <Popover closeOnClickOutside position="bottom-start" withArrow shadow="md">
            <Popover.Target>
                <div>
                    {checkboxComponent}
                </div>
            </Popover.Target>
            <Popover.Dropdown>
                <Group>
                    <ThemeIcon color="yellow"><IoWarningOutline /></ThemeIcon>
                    <Text>This annotation has no mentions.</Text>
                </Group>
            </Popover.Dropdown>
        </Popover>
}
