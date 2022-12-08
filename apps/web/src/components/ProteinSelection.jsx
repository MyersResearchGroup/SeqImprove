import { ActionIcon, Group, Text, Tooltip } from '@mantine/core'
import { forwardRef, useEffect, useMemo } from 'react'
import { useUniprot } from '../modules/ontologies/uniprot'
import FormSection from './FormSection'
import { FaTimes } from "react-icons/fa"
import { useStore } from '../modules/store'
import shallow from 'zustand/shallow'
import MultiRowSelect from './MultiRowSelect'
import { useSetState } from '@mantine/hooks'


export default function ProteinSelection() {

    // store state
    const proteinUris = useStore(s => s.document.root.proteins, shallow)
    const addProtein = useStore(s => s.addProtein)
    const removeProtein = useStore(s => s.removeProtein)

    // the SDOM only stores URIs, so we need a cache for extra info
    const [cache, setCache] = useSetState({})

    // memo protein objects -- start with URI from SDOM and pull from cache
    const proteins = useMemo(
        () => proteinUris.map(uri => cache[uri]).filter(item => !!item),
        [proteinUris, cache]
    )

    // handlers
    const handleAdd = value => {
        // check for duplicates
        if (proteinUris.includes(value.uri))
            return

        // add to cache
        setCache({ [value.uri]: value })
        // add to SDOM
        addProtein(value.uri)
    }
    const handleRemove = value => {
        const uri = Object.values(cache).find(item => item?.id == value)?.uri
        if(uri) {
            removeProtein(uri)
            setCache({ [uri]: undefined })
        }
    }

    // search UniProt Knowledgebase
    const searchUniprot = useUniprot("uniprotkb", result => ({
        id: result.primaryAccession,
        name: result.proteinDescription?.recommendedName?.fullName?.value,
        organism: result.organism?.scientificName,
        identifier: `UniProt:${result.primaryAccession}`,
        uri: `https://identifiers.org/UniProt:${result.primaryAccession}`,
    }))

    // try to search for URIs not in cache so we can get full info about them
    useEffect(() => {
        proteinUris
            .filter(uri => !cache[uri])
            .forEach(async uri => {
                const matchedId = uri.match(/\w+$/)?.[0]
                const searchResult = (await searchUniprot(matchedId)).find(result => result.uri == uri)
                searchResult && setCache({ [uri]: searchResult })
            })
    }, [proteinUris])

    return (
        <FormSection title="Proteins">
            <MultiRowSelect
                items={proteins}
                addItem={handleAdd}
                removeItem={handleRemove}
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

