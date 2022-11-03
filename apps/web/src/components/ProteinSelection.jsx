import { ActionIcon, Group, Text, Tooltip } from '@mantine/core'
import { forwardRef } from 'react'
import { useUniprot } from '../ontologies/uniprot'
import FormSection from './FormSection'
import { FaTimes } from "react-icons/fa"
import { useStore } from '../modules/store'
import shallow from 'zustand/shallow'
import MultiRowSelect from './MultiRowSelect'


export default function ProteinSelection() {

    const {
        items: proteins,
        add: addProtein,
        remove: removeProtein
    } = useStore(s => s.proteins, shallow)

    const searchUniprot = useUniprot("uniprotkb", result => ({
        id: result.primaryAccession,
        name: result.proteinDescription?.recommendedName?.fullName?.value,
        organism: result.organism?.scientificName,
        identifier: `UniProt:${result.primaryAccession}`,
        uri: `https://identifiers.org/UniProt:${result.primaryAccession}`,
    }))

    return (
        <FormSection title="Proteins">
            <MultiRowSelect
                items={proteins}
                addItem={addProtein}
                removeItem={removeProtein}
                search={searchUniprot}
                itemComponent={ProteinItem}
                searchItemComponent={ProtienSearchItem}
                messages={{ initial: "Type something to search UniProt", nothingFound: "Nothing found in UniProt" }}
                pluralLabel="proteins"
                debounce={800}
                placeholder="Search UniProt..."
            />
        </FormSection>
    )
}

const ProteinItem = forwardRef(({ name, organism, identifier, uri, onRemove }, ref) =>
    <a href={uri} target="_blank">
        <Tooltip label="View in UniProt" withArrow position="bottom">
            <Group noWrap ref={ref} spacing="xs" sx={theme => ({
                padding: "8px 12px",
                margin: 8,
                border: "1px solid " + theme.colors.gray[3],
                borderRadius: 24,
                display: "inline-flex",
                "&:hover": {
                    borderColor: theme.colors.gray[5],
                }
            })}>
                <Text size="sm" color="dark">{name}</Text>
                <Text size="sm" color="dimmed">{organism}</Text>
                <ActionIcon color="red" onClick={event => {
                    event.preventDefault()
                    onRemove()
                }}><FaTimes /></ActionIcon>
            </Group>
        </Tooltip>
    </a>
)

const ProtienSearchItem = forwardRef(({ label, organism, name, ...others }, ref) =>
    <div ref={ref} {...others}>
        <Group noWrap position="apart">
            <Text>{name}</Text>
            <Text color="dimmed">{organism}</Text>
        </Group>
    </div>
)

