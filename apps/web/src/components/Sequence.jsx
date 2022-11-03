import { Box, ScrollArea, Text, useMantineTheme } from '@mantine/core'
import React from 'react'

export default function Sequence({ sequence, subSequences, onChange }) {

    const theme = useMantineTheme()

    const brokenSequence = sequence.match(/.{1,8}/g)

    const highlightOverlays = subSequences.map(({ start, end, color, active, id }) => {
        const before = sequence.slice(0, start - 1).match(/.{1,8}/g)
        let during = sequence.slice(start - 1, end)

        const duringOffset = 8 - before[before.length - 1].length
        during = [
            during.slice(0, duringOffset),
            ...during.slice(duringOffset).match(/.{1,8}/g)
        ]

        const highlightColor = theme.colors[color]?.[active ? 3 : 1] ?? "transparent"

        return <Box
            sx={{
                color: "transparent",
                position: "absolute",
                top: 0,
                zIndex: active ? 6 : 5,
                pointerEvents: "none",
                opacity: active ? 0.8 : 0.5,
                "&:hover": {
                    opacity: 0.8,
                    zIndex: 7,
                }
            }}
            key={`${start}-${end}`}
        >
            {before.map((seq, i, arr) => <BasePairGroup seq={seq} key={seq + i} lastChild={i == arr.length - 1} />)}
            {during.map((seq, i, arr) => <BasePairGroup seq={seq} key={seq + i} lastChild={i == arr.length - 1} highlight={highlightColor} onClick={() => onChange?.(id, !active)} />)}
        </Box>
    })


    return (
        <ScrollArea styles={scrollAreaStyles} pr={20}>
            {brokenSequence.map((seq, i) => <BasePairGroup seq={seq} key={i} />)}
            {highlightOverlays}
        </ScrollArea>
    )
}

function BasePairGroup({ seq, highlight, lastChild, onClick }) {

    const style = theme => ({
        fontFamily: "monospace",
        fontSize: 16,
        display: "inline-block",
        paddingRight: seq.length < 8 && lastChild ? 0 : 12,
        letterSpacing: 0.2,
        zIndex: 10,
        backgroundColor: "transparent",
        position: "relative",
        pointerEvents: "none",
        ...(highlight && {
            backgroundColor: highlight,
            cursor: "pointer",
            pointerEvents: "all",
        })
    })

    return <Text sx={style} onClick={onClick}>
        {seq.toLowerCase()}
    </Text>
}

const scrollAreaStyles = theme => ({
    root: {
        height: 500,
    },
    viewport: {
        position: "relative",
        backgroundColor: "transparent",
    },
})