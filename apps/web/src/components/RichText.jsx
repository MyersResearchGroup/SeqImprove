import { Box, Text, useMantineTheme } from '@mantine/core'
import { useClickOutside, useHover } from '@mantine/hooks'
import React, { useMemo, useState } from 'react'
import { useEffect } from 'react'
import { useCallback } from 'react'
import { createAnnotationRegex } from '../modules/sbol'

export default function RichText({ children, colorMap, onSelectionChange }) {

    // break description into words
    const words = useMemo(() => {
        // separate out annotations
        return children.split(/(\[.*?\))/g)
            // separate words
            .map(str => str.startsWith("[") ? str : str.split(/\s+/g)).flat()
            // filter out empties
            .filter(str => !!str)
            // map to objects with more info
            .map(str => {
                const match = str.match(createAnnotationRegex(".+?", ""))
                return match ? {
                    text: match[1],
                    id: match[2],
                    length: str.split(/\s+/g).length,
                    isAnnotation: true,
                    rawText: str,
                    color: colorMap[match[2]],
                } : {
                    text: str,
                    isAnnotation: false,
                }
            })
    }, [children])

    // watch for word selections
    const [selectedWords, selectionHandlers] = useWordSelection(words)
    // const wordBoxRef = useClickOutside(selectionHandlers.clear)

    useEffect(() => {
        onSelectionChange?.(selectedWords && {
            selectedWords,
            clear: selectionHandlers.clear,
        })
    }, [selectedWords])

    return (
        <Box
            sx={{ flexWrap: 'wrap' }}
            // ref={wordBoxRef}
        >
            {words.map((word, i) =>
                <Word
                    {...(word.isAnnotation ? {
                        onClick: () => {
                            selectionHandlers.clear()
                        }
                    } : {
                        onMouseDown: event => selectionHandlers.mouseDown(word, event),
                        onMouseUp: event => selectionHandlers.mouseUp(word, event),
                        onMouseMove: event => selectionHandlers.mouseMove(word, event),
                    })}

                    highlight={word.color ?? (selectedWords?.includes(word) && "blue")}
                    key={i}
                >
                    {word.text}
                </Word>
            )}
        </Box>
    )
}

function Word({ children, highlight, ...props }) {

    const theme = useMantineTheme()
    const { hovered, ref } = useHover()

    return (
        <Text
            px={3}
            color={hovered ? theme.colors.blue[6] : "black"}
            ref={ref}

            sx={theme => ({
                display: "inline-block",
                // borderRadius: 6,
                cursor: "pointer",
                userSelect: "none",

                ...(highlight && {
                    backgroundColor: theme.colors[highlight][1],
                    color: theme.colors[highlight][9],
                })
            })}
            {...props}
        >
            {children}
        </Text>
    )
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