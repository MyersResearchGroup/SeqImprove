import { Box, Text } from '@mantine/core'
import { useHover } from '@mantine/hooks'
import React, { useMemo } from 'react'
import { createAnnotationRegex } from '../modules/sbol'

export default function RichText({ children, colorMap }) {

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

    return (
        <Box sx={{ flexWrap: 'wrap' }}>
            {words.map((word, i) => <Word highlight={word.color} key={i}>{word.text}</Word>)}
        </Box>
    )
}

function Word({ children, highlight }) {

    const { hovered, ref } = useHover()

    return (
        <Text
            px={4}
            color={hovered ? "red" : "black"}
            ref={ref}
            sx={theme => ({ 
                display: "inline-block",
                borderRadius: 6,
                ...(highlight && {
                    backgroundColor: theme.colors[highlight][1],
                    color: theme.colors[highlight][9],
                    cursor: "pointer",
                })
            })}
        >
            {children}
        </Text>
    )
}