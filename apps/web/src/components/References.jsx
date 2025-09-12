import { ActionIcon, Box, Group, ScrollArea, TextInput, Tooltip } from '@mantine/core'
import { getHotkeyHandler } from '@mantine/hooks'
import React, { useState } from 'react'
import { FaPlus, FaTimes } from 'react-icons/fa'
import shallow from 'zustand/shallow'
import { useStore } from '../modules/store'
import FormSection from './FormSection'
import TextLink from './TextLink'

export default function References() {

    // store state
    const referenceUris = useStore(s => s.document.root.references, shallow)
    const addReference = useStore(s => s.addReference)
    const removeReference = useStore(s => s.removeReference)

    // controlled text input state
    const [textInput, setTextInput] = useState("")
    const [error, setError] = useState(false)

    // validation - check if it's a valid DOI or URL
    const validate = (input) => {
        const trimmed = input.trim()
        if (!trimmed) return "Please enter a DOI or URL"
        
        // check if it's a DOI (starts with 10. and contains a slash)
        const doiRegex = /^10\.\d{4,}\/[^\s]+$/
        if (doiRegex.test(trimmed)) return null
        
        // check if it's a URL
        try {
            new URL(trimmed)
            return null
        } catch {
            // not a valid URL
        }
        
        // check if it looks like a DOI without the 10. prefix
        if (trimmed.includes('/') && !trimmed.includes(' ')) {
            return "DOI should start with '10.' (e.g., 10.1038/nature10212)"
        }
        
        return "Please enter a valid DOI (e.g., 10.1038/nature10212) or URL"
    }

    // submit handler
    const handleSubmit = () => {
        const validationError = validate(textInput)
        if (validationError) {
            setError(validationError)
            return
        }

        // normalize DOI to URL format
        let uri = textInput.trim()
        const doiRegex = /^10\.\d{4,}\/[^\s]+$/
        if (doiRegex.test(uri)) {
            uri = `https://doi.org/${uri}`
        }

        // check for duplicates
        if (referenceUris && referenceUris.includes(uri)) {
            setError("This reference has already been added")
            return
        }

        // add the reference
        addReference(uri)
        setTextInput("")
        setError(false)
    }

    return (
        <FormSection title="References">
            {/* Display added references */}
            {referenceUris && referenceUris.length > 0 && (
                <ScrollArea styles={scrollAreaStyles}>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                        {referenceUris.map(uri => (
                            <ReferenceItem 
                                key={uri} 
                                uri={uri} 
                                onRemove={() => removeReference(uri)} 
                            />
                        ))}
                    </Box>
                </ScrollArea>
            )}
            
            {/* Input for adding new references */}
            <TextInput
                value={textInput}
                onChange={event => {
                    setTextInput(event.currentTarget.value)
                    if (error) setError(false)
                }}
                placeholder="Enter a DOI (e.g., 10.1038/nature10212) or URL"
                rightSection={<ActionIcon onClick={handleSubmit}>
                    <FaPlus />
                </ActionIcon>}
                onKeyDown={getHotkeyHandler([
                    ["Enter", handleSubmit],
                    ["Escape", () => {
                        setTextInput("")
                        setError(false)
                    }]
                ])}
                error={error}
            />
        </FormSection>
    )
}

/**
 * Component for displaying a single reference
 */
function ReferenceItem({ uri, onRemove }) {
    // extract DOI or display URI as-is
    const displayText = uri.startsWith('https://doi.org/') 
        ? uri.replace('https://doi.org/', 'DOI: ')
        : uri

    return (
        <Group noWrap spacing="xs" sx={theme => ({
            padding: "8px 12px",
            border: "1px solid " + theme.colors.gray[3],
            borderRadius: 8,
            backgroundColor: theme.colors.gray[0],
            "&:hover": {
                borderColor: theme.colors.gray[5],
                backgroundColor: theme.colors.gray[1],
            }
        })}>
            <Box sx={{ flexGrow: 1 }}>
                <TextLink href={uri} color="blue" size="sm">
                    {displayText}
                </TextLink>
            </Box>
            <Tooltip label="Remove reference" withArrow position="left">
                <ActionIcon 
                    color="red" 
                    size="sm" 
                    onClick={onRemove}
                    sx={{ flexShrink: 0 }}
                >
                    <FaTimes />
                </ActionIcon>
            </Tooltip>
        </Group>
    )
}

const scrollAreaStyles = theme => ({
    root: {
        maxHeight: 200,
    },
})