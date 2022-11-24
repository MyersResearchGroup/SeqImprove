import { Box, Button, ColorSwatch, Group, Popover, Text, useMantineTheme } from '@mantine/core'
import { useTextSelection } from '@mantine/hooks'
import React, { useEffect } from 'react'
import { useMemo } from 'react'
import { FaMinus } from "react-icons/fa"
import { useStore } from '../modules/store'
import TextLink from './TextLink'


export default function RichDescription({ colorMap, onSelectionChange }) {

    const annotations = useStore(s => s.textAnnotations)
    const { isActive } = useStore(s => s.textAnnotationActions)
    const richDescriptionBuffer = useStore(s => s.richDescriptionBuffer)

    // find and sort active mentions
    const activeMentions = annotations
        .reduce((accum, anno) => {
            return isActive(anno.id) ?
                [...accum, ...anno.mentions.map(m => ({ ...m, annotationId: anno.id, color: colorMap[anno.id] }))] :
                accum
        }, [])
        .sort((a, b) => a.start - b.start)

    // handle text selection
    const selection = useTextSelection()
    useEffect(() => {
        if (!selection || selection.anchorNode != selection.focusNode || selection.anchorOffset == selection.focusOffset) {
            onSelectionChange?.(null)
            return
        }

        // grab selection offset
        const offset = parseInt(selection.anchorNode.parentElement.getAttribute("selection-offset"))

        // calculate forward range and add it to object
        selection.range = selection.anchorOffset > selection.focusOffset ?
            [offset + selection.focusOffset, offset + selection.anchorOffset] :
            [offset + selection.anchorOffset, offset + selection.focusOffset]

        onSelectionChange?.(selection)
    }, [selection?.anchorOffset, selection?.focusOffset])


    return (
        <Box>
            <TextSpan offset={0}>
                {richDescriptionBuffer.getText(0, activeMentions[0]?.start)}
            </TextSpan>
            {activeMentions.map((mention, i) =>
                <React.Fragment key={i}>
                    <Mention mention={mention} />
                    <TextSpan offset={mention.end}>
                        {richDescriptionBuffer.getText(mention.end, activeMentions[i + 1]?.start)}
                    </TextSpan>
                </React.Fragment>
            )}
        </Box>
    )
}


function TextSpan({ children, offset }) {
    return (
        <Text component="span" selection-offset={offset} sx={{ position: "relative", zIndex: 2 }}>
            {children}
        </Text>
    )
}


function Mention({ mention }) {

    const theme = useMantineTheme()

    const { getAnnotation, editAnnotation } = useStore(s => s.textAnnotationActions)
    const annotation = useMemo(() => getAnnotation(mention.annotationId), [mention.annotationId])

    const handleRemoveAnnotation = () => {
        editAnnotation(annotation.id, {
            mentions: annotation.mentions.filter(m =>
                m.start != mention.start ||
                m.end != mention.end
            )
        })
    }

    return (
        <Popover width={200} shadow="md" withArrow closeOnClickOutside key={mention.annotationId + mention.start}>
            <Popover.Target>
                <Text
                    px={5}
                    component="span"
                    sx={theme => ({
                        cursor: "pointer",
                        userSelect: "none",
                        borderRadius: 6,
                        color: theme.colors[mention.color][9],
                        backgroundColor: theme.colors[mention.color][1],
                        "&:hover": {
                            outline: "2px solid " + theme.colors[mention.color][3],
                        },

                    })}
                // {...props}
                >
                    {mention.text}
                </Text>
            </Popover.Target>
            <Popover.Dropdown>
                <ColorSwatch
                    color={theme.colors[mention.color][5]}
                    size={8}
                    sx={{ width: 60 }}
                />
                <Text my={10}>"{mention.text}"</Text>
                <Group position="apart">
                    <Text size="sm">{annotation.label}</Text>
                    <TextLink size="sm" color="dimmed" href={annotation.id}>{annotation.displayId}</TextLink>
                </Group>
                <Group position="center" mt={20}>
                    <Button color="red" size="xs" variant="subtle" leftIcon={<FaMinus />} onClick={handleRemoveAnnotation}>
                        Remove Mention
                    </Button>
                </Group>
            </Popover.Dropdown>
        </Popover>
    )
}