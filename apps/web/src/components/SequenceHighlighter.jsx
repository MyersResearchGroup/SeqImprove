import { Box, ScrollArea, Text } from '@mantine/core'
import { useForceUpdate, useIntersection } from '@mantine/hooks'
import { useEffect, useState, useRef, useMemo, createElement } from 'react'

export default function SequenceHighlighter({ sequence, annotations, onChange, isActive, wordSize, spacing = 12, scrollAreaProps = { h: 400 } }) {

    // split sequence into "words"
    // const splitSequence = sequence.match(new RegExp(`.{1,${wordSize}}`, "g"))

    // create object containing word and character indexes for each annotation
    // const annotationSpans = useMemo(
    //     () => Object.fromEntries(
    //         annotations.map(anno => [
    //             anno.id,
    //             {
    //                 start: {
    //                     word: Math.floor(anno.location[0] / wordSize),
    //                     char: anno.location[0] % wordSize,
    //                 },
    //                 end: {
    //                     word: Math.floor(anno.location[1] / wordSize),
    //                     char: anno.location[1] % wordSize,
    //                 },
    //             }
    //         ])
    //     ),
    //     [annotations, sequence, wordSize]
    // )

    // create refs 
    // const refs = useRef({})

    // force update when annotations are loaded -- forces refs to update
    const forceUpdate = useForceUpdate()
    useEffect(() => {
        forceUpdate()
    }, [annotations, sequence, wordSize])

    // props for Text components 
    // const textProps = {
    //     ff: "monospace",
    //     size: "sm",
    //     display: "inline-block",
    //     px: spacing / 2,
    // }

    // state for max width
    // const [maxContainerWidth, setMaxContainerWidth] = useState(0)
    // this isn't quite ready yet -- we'll try this later

    return (
        <>
            <ScrollArea
                pr={20}
                {...scrollAreaProps}
                styles={{ viewport: { position: "relative", paddingTop: 4 } }}
            >
                {/* {annotations.map(anno => {
                    const span = annotationSpans[anno.id]
                    const ref = refs.current[anno.id]

                    return (
                        <Box
                            pos="absolute"
                            left={0}
                            top={refs.current[anno.id]?.start.offsetTop - 4}
                            w="100%"
                            // maw={maxContainerWidth + 30}
                            key={anno.id}
                        >
                            <Box
                                display="inline"
                                ml={`calc(${ref?.start.offsetLeft - 2 + spacing / 2}px + ${span?.start.char - 1}ch)`}
                                bg={anno.active && `${anno.color}.2`}
                                onClick={() => onChange?.(anno.id, !anno.active)}
                                sx={theme => ({
                                    borderRadius: 5,
                                    cursor: "pointer",
                                    // border: anno.active ? "none" : `3px solid ${theme.colors[anno.color][3]}`,
                                    border: `3px solid ${theme.colors[anno.color][anno.active ? 5 : 2]}`,








                                    


                                })}
                            >
                                <Text
                                    {...textProps}
                                    px={undefined}
                                    pr={spacing / 2}
                                    // color={anno.color}
                                    c="transparent"
                                >
                                    {Array(wordSize - (span?.start.char - 1)).fill("_").join("")}
                                </Text>

                                {Array(span?.end.word - span?.start.word - 1).fill(0).map((_, i) =>
                                    <Text
                                        {...textProps}
                                        // color={anno.color}
                                        c="transparent"
                                        key={"filler" + i}
                                    >
                                        {Array(wordSize).fill("_").join("")}
                                    </Text>
                                )}

                                <Text
                                    {...textProps}
                                    px={undefined}
                                    pl={spacing / 2}
                                    // color={anno.color}
                                    c="transparent"
                                >
                                    {Array(span?.end.char).fill("_").join("")}
                                </Text>
                            </Box>
                        </Box>
                    )
                })} */}

                {                    
                    createElement(
                        'p', 
                        {
                            style: {fontFamily: "monospace", fontSize: "14px"}, 
                            onClick: e => {                                 
                                if (e.target.tagName == 'SPAN') {                                                                        
                                    const id = e.target.dataset.annotationId
                                    onChange?.(id, !isActive(id))                                      
                                }
                            }
                        },
                        ...insertSpaces(wordSize, annotations.reduce((sequenceParts, annotation) => {    
                            let k = 0
                            let j = 0 // sequenceParts Element Index

                            while (k + (sequenceParts[j].length ? sequenceParts[j].length : sequenceParts[j].props.children.length) < annotation.location[0]) {
                                k += (sequenceParts[j].length ? sequenceParts[j].length : sequenceParts[j].props.children.length)
                                j++
                            }
                            // assuming sequenceParts[j] is text!!! 
                            const startingCharIndex = annotation.location[0] - k
                            const annotationLength = annotation.location[1] - annotation.location[0]
                            
                            const span = createElement(
                                'span',
                                {
                                    style: {
                                        backgroundColor: (isActive(annotation.id) ? annotation.color : lighter(annotation.color)),
                                        cursor: "pointer",
                                        borderStyle: "solid",
                                        borderRadius: "5px",
                                        borderColor: darker(annotation.color),
                                    },
                                    'data-annotation-id': annotation.id, // on click event for sequence section needs to know which span was clicked
                                    // 'data-isActive': '0'
                                },
                                sequenceParts[j].slice(startingCharIndex, startingCharIndex + annotationLength)                                                        
                            )                    

                            return sequenceParts.slice(0,j)
                                                .concat(
                                                    sequenceParts[j].slice(0, startingCharIndex),
                                                    span,
                                                    sequenceParts[j].slice(startingCharIndex + annotationLength),
                                                    ...sequenceParts.slice(j + 1)
                                                )

                        }, [sequence]))
                    )                    
                }

                {/* {splitSequence.map((word, i) =>
                    <Text
                        {...textProps}
                        pos="relative"
                        ref={el => {
                            createRefForWord(annotationSpans, refs, i)?.(el)
                            if (el)
                                setMaxContainerWidth(Math.max(el.offsetLeft + el.offsetWidth, maxContainerWidth))
                        }}
                        key={"seq" + i}
                        sx={{ pointerEvents: "none" }}
                    >
                        {word}
                    </Text>
                )} */}
            </ScrollArea>
            <OnScreenDetector onShow={() => forceUpdate()} />
        </>
    )
}

function darker(color) {
    // Create a dummy element to apply the color
    const dummyElement = document.createElement('div')
    dummyElement.style.color = color
    
    document.body.appendChild(dummyElement)

    // Get the computed RGB values
    const computedColor = window.getComputedStyle(dummyElement).color
    const rgbValues = computedColor.match(/\d+/g).map(Number)
  
    // remove dummy element
    document.body.removeChild(dummyElement)

    // Calculate darker RGB values
    const lighterRgbValues = rgbValues.map(value => Math.floor(value * 0.85))
  
    // Convert RGB to RGB string format
    const rgbString = `rgb(${lighterRgbValues.join(', ')})`

    return rgbString    
}

function lighter(color) {
    // Create a dummy element to apply the color
    const dummyElement = document.createElement('div')
    dummyElement.style.color = color
    
    document.body.appendChild(dummyElement)

    // Get the computed RGB values
    const computedColor = window.getComputedStyle(dummyElement).color
    const rgbValues = computedColor.match(/\d+/g).map(Number)
  
    // remove dummy element
    document.body.removeChild(dummyElement)

    // Calculate lighter RGB values
    const lighterRgbValues = rgbValues.map(value => Math.floor((255 - value) * 0.7 + value))
  
    // Convert RGB to RGB string format
    const rgbString = `rgb(${lighterRgbValues.join(', ')})`

    return rgbString
}

function insertSpaces(wordSize, sequenceParts) {    
    let result = new Array(sequenceParts.length)
    let jump = wordSize
    
    for (let i = 0; i < sequenceParts.length; i++) {
        let length
        let text

        if (sequenceParts[i].hasOwnProperty('length')) {
            length = sequenceParts[i].length
            text = sequenceParts[i]
            result[i] = ""
            let prevJ = 0
            let j
            for (j = jump; j < length; j += wordSize) {
                result[i] += text.slice(prevJ, j) + ' '
                prevJ = j
            }
            result[i] += text.slice(prevJ, j) + (length == j ? ' ' : '')
            
            jump = wordSize - ((length + wordSize - jump) % wordSize)
         } else {            
            length = sequenceParts[i].props.children.length
            text = sequenceParts[i].props.children            
            let textWithSpaces = ""
            let prevJ = 0
            let j
            for (j = jump; j < length; j += wordSize) {
                textWithSpaces += text.slice(prevJ, j) + ' '
                prevJ = j
            }
            textWithSpaces += text.slice(prevJ, j) + (length == j ? ' ': '')
            result[i] = createElement('span', sequenceParts[i].props, textWithSpaces)
            jump = wordSize - ((length + wordSize - jump) % wordSize)            
         }

    }

    return result
}

/**
 * Creates a ref function for a given word index that matches an annotations start
 * or end indexes.
 *
 * @param {*} spans
 * @param {*} refs
 * @param {number} wordIndex
 * @return {Function | undefined} Function to be passed as component's ref
 */
// function createRefForWord(spans, refs, wordIndex) {
//     // find relevant annotation span
//     const foundSpan = Object.entries(spans).find(
//         ([, { start, end }]) => start.word == wordIndex || end.word == wordIndex
//     )

//     if (!foundSpan)
//         return

//     const id = foundSpan[0]
//     const position = foundSpan[1].start.word == wordIndex ? "start" : "end"

//     // create ref function to insert element in refs object
//     return el => {
//         if (refs.current[id])
//             refs.current[id][position] = el
//         else
//             refs.current[id] = { [position]: el }
//     }
// }


function OnScreenDetector({ onShow }) {

    const bodyRef = useRef(document.querySelector("body"))
    const { ref, entry } = useIntersection({
        root: bodyRef.current,
        threshold: 1,
    })

    useEffect(() => {
        entry?.isIntersecting && onShow?.()
    }, [entry?.isIntersecting])

    return <Box ref={ref}></Box>
}