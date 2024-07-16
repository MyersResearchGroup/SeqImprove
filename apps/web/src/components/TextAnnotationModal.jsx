import { Button, Group, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useState } from "react"
import { useStore } from '../modules/store'
import { fetchSuggestions } from '../modules/api'
import MultiRowSelect from './MultiRowSelect'

export default function TextAnnotationModal({ id, context, innerProps: { editing = false, label, identifier, uri } }) {

    const { getAnnotation, editAnnotation, addAnnotation } = useStore(s => s.textAnnotationActions)

    // form hook
    const form = useForm({
        initialValues: {
            label: label ?? "",
            identifier: identifier ?? "",
            uri: uri ?? "",
        },
        validate: {
            label: value => !value,
            identifier: value => !value,
            uri: value => !value ||
                (value != uri && !!getAnnotation(value) && "An annotation with this URI already exists"),
        }
    })

    // submit -- propagate event then treat like a cancel
    const handleSubmit = formValues => {

        if (editing) {
            editAnnotation(uri, {
                id: formValues.uri,
                label: formValues.label,
                displayId: formValues.identifier,
            })
        }
        else {
            addAnnotation({
                id: formValues.uri,
                label: formValues.label,
                displayId: formValues.identifier,
                mentions: [],
            })
        }

        context.closeModal(id)
    }

    // cancel -- close modal
    const handleCancel = () => {
        context.closeModal(id)
    }

    const organisms = [];
    const [searchOptions, setSearchOptions] = useState();


    return (
        <form onSubmit={form.onSubmit(handleSubmit)}>

            <TextInput
                label="Label"
                {...form.getInputProps("label")}
                mb={6}
            />

            {/* <TextInput // TODO: to MultiRowSelect
                label="Identifier" 
                placeholder="Search ontologies or enter custom identifier"
                {...form.getInputProps("identifier")}
                mb={6}
            /> */}

            <MultiRowSelect
                items={organisms} //empty
                //addItem={handleAdd}
                //removeItem={handleRemove}
                search={fetchSuggestions}
                //itemComponent={OrganismItem}
                //searchItemComponent={OrganismSearchItem}
                messages={{ initial: "Type something to search", nothingFound: "Nothing found in Taxonomy" }}
                pluralLabel="organisms"
                debounce={800}
                placeholder="Search ontologies or enter custom identifie"
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

/**
 * Component for a selected item
 */
// const OrganismItem = forwardRef(({ id, name, commonName, uri, onRemove }, ref) =>
//     <a href={uri} target="_blank">
//         <Tooltip label="View in Taxonomy" withArrow position="bottom">
//             <Group noWrap ref={ref} spacing="xs" sx={theme => ({
//                 padding: "8px 12px",
//                 margin: 8,
//                 border: "1px solid " + theme.colors.gray[3],
//                 borderRadius: 24,
//                 display: "inline-flex",
//                 "&:hover": {
//                     borderColor: theme.colors.gray[5],
//                 }
//             })}>
//                 <Text size="sm" color="dark">{name}</Text>
//                 <Text size="sm" color="dimmed">{commonName}</Text>
//                 <ActionIcon color="red" onClick={event => {
//                     event.preventDefault()
//                     onRemove()
//                 }}><FaTimes /></ActionIcon>
//             </Group>
//         </Tooltip>
//     </a>
// )

/**
 * Component for an item appearing in the search
 */
// const OrganismSearchItem = forwardRef(({ label, name, commonName, ...others }, ref) =>
//     <div ref={ref} {...others}>
//         <Group noWrap position="apart">
//             <Text>{name}</Text>
//             <Text color="dimmed">{commonName}</Text>
//         </Group>
//     </div>
// )