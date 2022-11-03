import { Button, Group, Modal, MultiSelect, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { getHotkeyHandler } from '@mantine/hooks'
import { useEffect } from 'react'

export default function TextAnnotationModal({ opened, onClose, onSubmit, values = {
    id: "",
    idLink: "",
    terms: [],
} }) {

    // form hook
    const form = useForm({
        initialValues: values,
    })

    // cancel -- close modal and reset values
    const handleCancel = () => {
        onClose?.()
        form.setValues(values) // clear form values
    }

    // submit -- propagate event then treat like a cancel
    const handleSubmit = formValues => {
        onSubmit?.(formValues)
        onClose?.()
    }

    // key handlers
    const keyHandler = getHotkeyHandler([
        ["escape", handleCancel]
    ])

    // make sure form stays synced with outside values
    useEffect(() => {
        form.setValues(values)
    }, [JSON.stringify(values)])


    return (
        <Modal opened={opened} onClose={handleCancel} title="Add Annotation" onKeyDown={keyHandler} closeOnClickOutside={true}>
            <form onSubmit={form.onSubmit(handleSubmit)}>

                <TextInput
                    label="Identifier"
                    placeholder="Search ontologies or enter custom identifier"
                    {...form.getInputProps("id")}
                    mb={6}
                />

                <TextInput
                    label="URI"
                    {...form.getInputProps("idLink")}
                    mb={6}
                />

                <MultiSelect
                    label="Terms"
                    data={form.getInputProps("terms").value}
                    placeholder="Add terms that should be recognized"
                    searchable
                    creatable
                    getCreateLabel={query => `+ ${query}`}
                    onCreate={query => query}
                    {...form.getInputProps("terms")}
                    mb={6}
                    styles={multiSelectStyles}
                />

                <Group position="right" mt="md">
                    <Button color="red" variant="outline" onClick={handleCancel}>Cancel</Button>
                    <Button type="submit">Submit</Button>
                </Group>
            </form>
        </Modal>
    )
}

const multiSelectStyles = theme => ({
    itemsWrapper: {
        width: "95%",
    }
})