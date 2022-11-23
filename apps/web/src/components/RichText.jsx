import { useMemo, useState, useCallback, useEffect } from 'react'
import { Box, Button, ColorSwatch, Group, Menu, Popover, Text, useMantineTheme } from '@mantine/core'
import { FaMinus } from "react-icons/fa"
import { createAnnotationRegex } from '../modules/sbol'
import { useStore } from '../modules/store'
import TextLink from './TextLink'
import { splitByAnnotations, splitIntoAnnotationsAndWords } from '../modules/text'


export default function RichText({ children, colorMap, onRemoveMention, onSelectionChange }) {

    // break description into words
    const words = useMemo(() => {
        let wordOffset = 0
        
        return splitIntoAnnotationsAndWords(children)
            // map to objects with more info
            .map((str, index) => {
                const match = str.match(createAnnotationRegex(".+?", ""))
                const length = str.split(/\s+/g).length

                const result = match ? {
                    text: match[1],
                    id: match[2],
                    isAnnotation: true,
                    rawText: str,
                    color: colorMap[match[2]],
                    length,
                    index: index + wordOffset,
                } : {
                    text: str,
                    isAnnotation: false,
                    index: index + wordOffset,
                }

                // need this so the indexes don't get messed up when there are multi-word
                // annotations in the mix
                wordOffset += length - 1

                return result
            })
    }, [children])

    // watch for word selections
    const [selectedWords, selectionHandlers] = useWordSelection(words)

    // propagate selection changes to parent
    useEffect(() => {
        onSelectionChange?.(selectedWords && {
            selectedWords,
            clear: selectionHandlers.clear,
        })
    }, [selectedWords])

    return (
        <Box sx={{ flexWrap: 'wrap' }}>
            {words.map((word, i) =>
                <Word
                    word={word}
                    selected={selectedWords?.includes(word)}
                    key={i}

                    {...(word.isAnnotation ? {
                        onClick: () => selectionHandlers.clear(),
                        onRemoveMention,
                    } : {
                        onMouseDown: event => selectionHandlers.mouseDown(word, event),
                        onMouseUp: event => selectionHandlers.mouseUp(word, event),
                        onMouseMove: event => selectionHandlers.mouseMove(word, event),
                    })}
                />
            )}
        </Box>
    )
}


function Word({ word, selected, onRemoveMention, ...props }) {

    const theme = useMantineTheme()

    // find the annotation and mention this word refers to
    const { getAnnotation } = useStore(s => s.textAnnotationActions)
    const annotation = useMemo(() => word.id && getAnnotation(word.id), [word.id])
    const mention = useMemo(() => annotation?.mentions.find(m => m.startWord == word.index), [annotation, word.index])

    const highlight = word.color ?? (selected && "blue")

    const textComponent = <Text
        px={3}
        sx={theme => ({
            display: "inline-block",
            cursor: "pointer",
            userSelect: "none",

            ...(word.isAnnotation ? {
                borderRadius: 6,
                "&:hover": {
                    outline: "2px solid " + theme.colors[highlight][3],
                }
            } : {
                "&:hover": {
                    color: theme.colors.blue[6],
                },
            }),

            ...(highlight && {
                backgroundColor: theme.colors[highlight][1],
                color: theme.colors[highlight][9],
            }),
        })}
        {...props}
    >
        {word.text}
    </Text>

    return word.isAnnotation ?
        <Popover width={200} shadow="md" withArrow closeOnClickOutside>
            <Popover.Target>{textComponent}</Popover.Target>
            <Popover.Dropdown>
                <ColorSwatch size={8} sx={{ width: 60 }} color={theme.colors[word.color][5]} />
                <Text my={10}>{mention?.text ?? word.text}</Text>
                <Group position="apart">
                    <Text size="sm">{annotation.label}</Text>
                    <TextLink size="sm" color="dimmed" href={annotation.id}>{annotation.displayId}</TextLink>
                </Group>
                <Group position="center" mt={20}>
                    <Button color="red" size="xs" variant="subtle" leftIcon={<FaMinus />} onClick={() => onRemoveMention?.(word)}>
                        Remove Mention
                    </Button>
                </Group>
            </Popover.Dropdown>
        </Popover>
        :
        textComponent
}

function useWordSelection(words) {

    const [selectionStartWord, setSelectionStartWord] = useState()
    const [selectionEndWord, setSelectionEndWord] = useState()
    const [dragging, setDragging] = useState(false)

    const mouseDownHandler = useCallback((word, event) => {
        setSelectionStartWord(word)
        setSelectionEndWord(null)
        setDragging(true)
    }, [])

    const mouseMoveHandler = useCallback((word, event) => {
        if (dragging)
            setSelectionEndWord(word)
    }, [words, dragging])

    const mouseUpHandler = useCallback((word, event) => {
        setDragging(false)

        // handle single click case
        if (selectionStartWord && !selectionEndWord)
            setSelectionEndWord(selectionStartWord)
    }, [selectionStartWord, selectionEndWord])

    const clearSelection = useCallback(() => {
        setSelectionStartWord(null)
        setSelectionEndWord(null)
    }, [])

    // calculate selection
    const selectedWords = useMemo(() => {

        if (!selectionStartWord || !selectionEndWord)
            return

        // determine direction of selection
        const direction = words.indexOf(selectionEndWord) < words.indexOf(selectionStartWord)
        const startWord = direction ? selectionEndWord : selectionStartWord
        const endWord = direction ? selectionStartWord : selectionEndWord

        // filter out words that aren't in the selection
        let inSelection = false
        return words.filter(word => {
            if (word == startWord)
                inSelection = true

            if (word == endWord) {
                inSelection = false
                return true
            }
            return inSelection
        })
    }, [selectionStartWord, selectionEndWord])

    // reset when words changes
    useEffect(() => {
        clearSelection()
    }, [words])

    // add global event listener to stop dragging
    useEffect(() => {
        const stopDragging = () => setDragging(false)
        window.addEventListener("mouseup", stopDragging)
        return () => window.removeEventListener("mouseup", stopDragging)
    }, [])

    return [selectedWords, {
        mouseDown: mouseDownHandler,
        mouseUp: mouseUpHandler,
        mouseMove: mouseMoveHandler,
        clear: clearSelection,
    }]
}