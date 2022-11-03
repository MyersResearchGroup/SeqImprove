import { Box, ScrollArea, Text, useMantineTheme } from '@mantine/core'
import React from 'react'
import { getColor } from '../modules/util'

export default function TextHighlighter({ children, h, terms, onChange, offsetStart = 0, textStyle = {}, wordMode }) {

    // break text up into "words" if wordLength is defined -- useful for sequences
    const wordModeContent = wordMode && children.match(new RegExp(`.{1,${wordMode}}`, "g"))

    return (
        <ScrollArea styles={scrollAreaStyles(h)} pr={20}>
            <Box my={5} sx={{ position: "relative" }}>
                {wordMode ?
                    <>
                        {/* Word mode */}
                        <Box sx={mainTextStyle(textStyle)}>
                            {wordModeContent.map((word, i) =>
                                <Word textStyle={textStyle} key={word + i}>{word}</Word>
                            )}
                        </Box>

                        {terms.map((term, i) =>
                            <WordedOverlay
                                term={term}
                                offsetStart={offsetStart}
                                wordMode={wordMode}
                                textStyle={textStyle}
                                onChange={val => onChange(term.id, val)}
                                key={term.id + i}
                            >
                                {wordModeContent}
                            </WordedOverlay>
                        )}
                    </> :
                    <>
                        {/* Regular mode */}
                        <Text sx={mainTextStyle(textStyle)}>
                            {children}
                        </Text>

                        {terms.map((term, i) =>
                            <Overlay
                                term={term}
                                offsetStart={offsetStart}
                                textStyle={textStyle}
                                onChange={val => onChange(term.id, val)}
                                key={term.id + i}
                            >
                                {children}
                            </Overlay>
                        )}
                    </>
                }
            </Box>
        </ScrollArea>
    )
}

function WordedOverlay({ children, term, offsetStart, wordMode, textStyle, onChange }) {

    // split up based on start and end of term
    const actualStart = term.start + offsetStart
    const startWordIndex = Math.floor(actualStart / wordMode)
    const intraWordStartIndex = actualStart - wordMode * startWordIndex
    const endWordIndex = Math.floor(term.end / wordMode)
    const intraWordEndIndex = term.end - wordMode * endWordIndex

    const before = [...children.slice(0, startWordIndex), children[startWordIndex].slice(0, intraWordStartIndex)]
    const during = [children[startWordIndex].slice(intraWordStartIndex), ...children.slice(startWordIndex + 1, endWordIndex), children[endWordIndex].slice(0, intraWordEndIndex)]

    // handle clicks on during element
    const clickHandler = () => {
        onChange(!term.active)
    }

    return <Box
        sx={overlayContainerStyle(term.active)}
    >
        <Box sx={overlayBeforeStyle(textStyle)}>
            {before.map((beforeTerm, i) =>
                <Word textStyle={textStyle} key={beforeTerm + i}
                    ignoreRightPadding={i == before.length - 1 && beforeTerm.length < wordMode}
                >
                    {beforeTerm}
                </Word>
            )}
        </Box>
        <Box sx={overlayDuringStyle(textStyle)(term.active, term.color)} onClick={clickHandler}>
            {during.map((duringTerm, i) =>
                <Word textStyle={textStyle} key={duringTerm + i}
                    ignoreLeftPadding={i == 0 && duringTerm.length < wordMode}
                    ignoreRightPadding={i == during.length - 1}
                >
                    {duringTerm}
                </Word>
            )}
        </Box>
    </Box>
}


function Overlay({ children, term, offsetStart, textStyle, onChange }) {

    const actualStart = term.start + offsetStart
    const before = children.slice(0, actualStart)
    const during = children.slice(actualStart, term.end)

    const clickHandler = () => {
        onChange(!term.active)
    }

    return <Box
        sx={overlayContainerStyle(term.active)}
    >
        <Text sx={overlayBeforeStyle(textStyle)}>{before}</Text>
        <Text sx={overlayDuringStyle(textStyle)(term.active, term.color)} onClick={clickHandler}>{during}</Text>
    </Box>

}

function Word({ children, textStyle, ignoreLeftPadding, ignoreRightPadding }) {

    const padding = "0.7ch"

    return <Text sx={{
        ...wordStyle,
        ...textStyle,
        paddingRight: ignoreRightPadding ? 0 : padding,
        paddingLeft: ignoreLeftPadding ? 0 : padding,
    }}>
        {children}
    </Text>
}


const overlayContainerStyle = active => theme => ({
    position: "absolute",
    top: 0,
    zIndex: active ? 6 : 5,
    pointerEvents: "none",
    opacity: active ? 0.8 : 0.5,
    "&:hover": {
        opacity: 0.8,
        zIndex: 7,
    }
})

const wordStyle = {
    fontFamily: "inherit",
    lineHeight: "inherit",
    display: "inline-block",
}

const generalTextStyle = (textStyle = {}) => ({
    lineHeight: 1.8,
    ...textStyle,
})

const overlayBeforeStyle = textStyle => theme => ({
    ...generalTextStyle(textStyle),
    display: "inline",
    color: "transparent",
})

const overlayDuringStyle = textStyle => (active, color) => theme => ({
    ...generalTextStyle(textStyle),
    display: "inline",
    color: "transparent",
    pointerEvents: "all",
    cursor: "pointer",
    marginLeft: -3,
    borderRadius: 5,
    backgroundColor: active ? getColor(theme, color, 3) : "transparent",
    border: "3px solid " + getColor(theme, color, active ? 3 : 2),
})

const mainTextStyle = textStyle => theme => ({
    ...generalTextStyle(textStyle),
    zIndex: 10,
    position: "relative",
    pointerEvents: "none",
})

const scrollAreaStyles = (height = 300) => theme => ({
    root: {
        height,
    },
    viewport: {
        backgroundColor: "transparent",
    },
})