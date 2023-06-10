import { Box, ScrollArea, Text } from '@mantine/core'
import { useForceUpdate, useIntersection } from '@mantine/hooks'
import { useEffect, useState, useRef, useMemo, createElement } from 'react'

export default function SequenceHighlighter({ sequence, annotations, onChange, isActive, wordSize, spacing = 12, scrollAreaProps = { h: 400 } }) {
    // force update when annotations are loaded -- forces refs to update
    const forceUpdate = useForceUpdate()    
    useEffect(() => {
        forceUpdate()
    }, [annotations, sequence, wordSize])
    
    const delimiters = annotations
        .reduce((delimiters, annotation) => {
            return delimiters.concat({
                loc: annotation.location[0],
                anno: annotation,
                beg: true
            }, {
                loc: annotation.location[1],
                anno: annotation,
                beg: false,            
            });
        }, [])
        .sort((a,b) => a.loc < b.loc ? -1 : a.loc == b.loc ? 0 : 1);    

    const sequenceSections = delimiters.reduce((seqSections, delimiter) => {
        let i = seqSections.length - 1;
        let lastSection = seqSections[i];

        const startingCharIndex = delimiter.loc - lastSection.start;

        let modifiedSection = [];
        if (startingCharIndex != 0) {
            modifiedSection.push({ 
                seq: lastSection.seq.slice(0, startingCharIndex), 
                annotations: lastSection.annotations, 
                start: lastSection.start,
            });
        }
        
        if (delimiter.beg) {
            modifiedSection.push({
                seq: lastSection.seq.slice(startingCharIndex),
                annotations: lastSection.annotations.concat(delimiter.anno),
                start: delimiter.loc
            });
        } else {            
            modifiedSection.push({
                seq: lastSection.seq.slice(startingCharIndex),
                annotations: lastSection.annotations.filter(anno => anno != delimiter.anno),
                start: delimiter.loc,
            });
        }

        return seqSections
            .slice(0, i)
            .concat(...modifiedSection);
    }, [{ seq: sequence, annotations: [], start: 0 }]);
    
    return (
        <>
            <ScrollArea
                pr={20}
                {...scrollAreaProps}
                styles={{ viewport: { position: "relative", paddingTop: 4 } }}
            >            
                {                                          
                    createElement(
                        'p', 
                        {
                            style: {fontFamily: "monospace", fontSize: "14px"}, 
                            onClick: e => {                                 
                                if (e.target.tagName == 'SPAN') {                                                                        
                                    const idx = parseInt(e.target.dataset.seqSectionIdx, 10);
                                    // debugger
                                    sequenceSections[idx].annotations.forEach(anno => {
                                        onChange?.(anno.id, !isActive(anno.id));
                                    });                                    
                                }
                            }
                        },
                        ...insertSpaces(wordSize, sequenceSections.map((seqSection, i) => {
                            return seqSection.annotations.length == 0 ? seqSection.seq : createElement(
                                'span',
                                {
                                    style: {
                                        backgroundColor: colorFromAnnotations(seqSection.annotations, isActive),
                                        cursor: "pointer",
                                        borderStyle: "solid",
                                        borderRadius: "1px",
                                        borderWidth: "1px 0 1px 0",
                                        borderColor: darker(colorFromAnnotations(seqSection.annotations, isActive)),
                                    },
                                    'data-seq-section-idx': i,
                                },
                                seqSection.seq
                            );
                        }))
                    )                    
                }                
            </ScrollArea>
            <OnScreenDetector onShow={() => forceUpdate()} />
        </>
    )
}

function colorFromAnnotations(annotations, isActive) {
    // return annotations[0].color;
    let rgbCollection = [];

    annotations.forEach(({ color, id }) => {        
        // Create a dummy element to apply the color
        const dummyElement = document.createElement('div');
        dummyElement.style.color = (isActive(id) ? color : lighter(color));
        
        document.body.appendChild(dummyElement);

        // Get the computed RGB values
        const computedColor = window.getComputedStyle(dummyElement).color;
        const rgbValues = computedColor.match(/\d+/g).map(Number);  

        rgbCollection.push(rgbValues);

        // remove dummy element
        document.body.removeChild(dummyElement);
    });
        
    const rgbAvg = [0,1,2].map(i => {
        return parseInt(
            rgbCollection.reduce((avg, rgb) => {                
                return ((1.0 / rgbCollection.length) * rgb[i]) + avg;
            }, 0.0), 
            10
        );
    });

    // Guard against colors that are too dark for text highlighting
    const rgb = rgbNorm(rgbAvg);    
    
    // Convert RGB to RGB string format
    const rgbString = `rgb(${rgb.join(', ')})`

    return rgbString;
}


function rgbNorm(rgb) {
    const sum = rgb.reduce((sum, colorValue) => sum + colorValue);
    if (sum < 555) {
        const increment = (555 - sum) / 3;
        return rgb.map(c => c + increment);
    } else {
        return rgb;
    }
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
    const darkerRgbValues = rgbValues.map(value => Math.floor(value * 0.75))
  
    // Convert RGB to RGB string format
    const rgbString = `rgb(${darkerRgbValues.join(', ')})`

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
    const lighterRgbValues = rgbValues.map(value => Math.floor((255 - value) * 0.8 + value))
  
    // Convert RGB to RGB string format
    const rgbString = `rgb(${lighterRgbValues.join(', ')})`

    return rgbString
}

function insertSpaces(wordSize, sequenceParts) {    
    let result = new Array(sequenceParts.length);
    let jump = wordSize;
    
    for (let i = 0; i < sequenceParts.length; i++) {
        let length;
        let text;

        if (sequenceParts[i].hasOwnProperty('length')) {
            length = sequenceParts[i].length;
            text = sequenceParts[i];
            result[i] = "";
            let prevJ = 0;
            let j;
            for (j = jump; j < length; j += wordSize) {
                result[i] += text.slice(prevJ, j) + ' ';
                prevJ = j;
            }
            result[i] += text.slice(prevJ, j) + (length == j ? ' ' : '');
            
            jump = wordSize - ((length + wordSize - jump) % wordSize);
         } else {            
            length = sequenceParts[i].props.children.length;
            text = sequenceParts[i].props.children;  
            let textWithSpaces = "";
            let prevJ = 0;
            let j;
            for (j = jump; j < length; j += wordSize) {
                textWithSpaces += text.slice(prevJ, j) + ' ';
                prevJ = j;
            }
            textWithSpaces += text.slice(prevJ, j) + (length == j ? ' ': '');
            result[i] = createElement('span', sequenceParts[i].props, textWithSpaces);
            jump = wordSize - ((length + wordSize - jump) % wordSize);
         }

    }

    return result;
}

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