import { Button, Group, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useStore } from '../modules/store'


export default function TextAnnotationModal({ id, context, innerProps: { editing = false, label, identifier, uri } }) {

    const { editAnnotation, addAnnotation } = useStore(s => s.textAnnotationActions)

    // form hook
    const form = useForm({
        initialValues: {
            label,
            identifier,
            uri,
        },
        validate: {
            label: value => !value,
            identifier: value => !value,
            uri: value => !value,
        }
    })

    // submit -- propagate event then treat like a cancel
    const handleSubmit = formValues => {

        if(editing) {
            editAnnotation(uri, {
                id: formValues.uri,
                label: formValues.label,
                displayId: formValues.identifier,
            })
        }
        else {
            console.log("TO DO: implement adding")
        }

        context.closeModal(id)
    }

    // cancel -- close modal
    const handleCancel = () => {
        context.closeModal(id)
    }


    return (
        <form onSubmit={form.onSubmit(handleSubmit)}>

            <TextInput
                label="Label"
                {...form.getInputProps("label")}
                mb={6}
            />

            <TextInput
                label="Identifier"
                placeholder="Search ontologies or enter custom identifier"
                {...form.getInputProps("identifier")}
                mb={6}
            />

            <TextInput
                label="URI"
                {...form.getInputProps("uri")}
                mb={6}
            />

            <Group position="right" mt="md">
                <Button color="red" variant="outline" onClick={handleCancel}>Cancel</Button>
                <Button type="submit">Submit</Button>
            </Group>
        </form>
    )
}
