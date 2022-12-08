import { ActionIcon, TextInput } from '@mantine/core'
import { getHotkeyHandler } from '@mantine/hooks'
import React, { useState } from 'react'
import { FaPlus } from 'react-icons/fa'
import shallow from 'zustand/shallow'
import { useStore } from '../modules/store'
import FormSection from './FormSection'

export default function References() {

    // store state
    const referenceUris = useStore(s => s.document.root.targetOrganisms, shallow)
    const addReference = useStore(s => s.addReference)
    const removeReference = useStore(s => s.removeReference)

    // controlled text input state
    const [textInput, setTextInput] = useState("")

    // validation
    const validate = () => {
        return textInput.includes("zach")
    }

    // submit handler
    const handleSubmit = doi => {
        if(!validate()) {
            console.log(doi)
            setTextInput("")
        }
    }

    return (
        <FormSection title="References">
            <TextInput
                value={textInput}
                onChange={event => setTextInput(event.currentTarget.value)}
                placeholder="Enter a DOI"
                rightSection={<ActionIcon onClick={handleSubmit}>
                    <FaPlus />
                </ActionIcon>}
                onKeyDown={getHotkeyHandler([
                    ["Enter", handleSubmit],
                    ["Escape", () => setTextInput("")]
                ])}
                error={validate()}
            />
        </FormSection>
    )
}

function ReferenceCard() {

}