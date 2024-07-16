import { ActionIcon, Checkbox, Group, Text, Tooltip } from '@mantine/core'
import { forwardRef, useState } from 'react'
import { useUniprot } from '../modules/ontologies/uniprot'
import FormSection from './FormSection'
import { FaTimes } from "react-icons/fa"
import { useStore } from '../modules/store'
import shallow from 'zustand/shallow'
import MultiRowSelect from './MultiRowSelect'
import { useSetState } from '@mantine/hooks'
import { useMemo } from 'react'
import { useEffect } from 'react'


export default function TargetOrganismsSelection() {

    // store state
    const organismUris = useStore(s => s.document.root.targetOrganisms, shallow)
    const addOrganism = useStore(s => s.addTargetOrganism)
    const removeOrganism = useStore(s => s.removeTargetOrganism)

    // handlers
    const handleAdd = value => {
        // check for duplicates
        if (organismUris.includes(value.uri))
            return

        // add to cache
        setCache({ [value.uri]: value })
        // add to SDOM
        addOrganism(value.uri)
    }
    const handleRemove = value => {
        const uri = Object.values(cache).find(item => item?.id == value)?.uri
        if(uri) {
            removeOrganism(uri)
            setCache({ [uri]: undefined })
        }
    }

    // the SDOM only stores URIs, so we need a cache for extra info
    const [cache, setCache] = useSetState({})

    // memo organism objects -- start with URI from SDOM and pull from cache
    const organisms = useMemo(
        () => organismUris.map(uri => cache[uri]).filter(item => !!item),
        [organismUris, cache]
    )

    // state for search objects
    const [searchOptions, setSearchOptions] = useSetState({
        prioritizeParents: true,
    })

    // search Uniprot Taxonomy
    const searchUniprot = useUniprot("taxonomy", result => ({
        id: result.taxonId,
        name: result.scientificName,
        commonName: result.commonName ?? "",
        uri: `https://www.uniprot.org/taxonomy/${result.taxonId}`,
        parent: result.parent?.taxonId,
    }))

    // search function that also searches parents
    const searchWithParent = async query => {
        // do regular search
        const results = await searchUniprot(query)

        // take the top 3 results and search their parents
        await Promise.all(
            results.slice(0, 3).map(async result => {
                const parentResult = (await searchUniprot(result.parent))[0]

                // splice in parent result if it's not already in the list
                if (!results.find(item => item.id == parentResult.id))
                    results.splice(results.indexOf(result), 0, parentResult)
            })
        )
        return results
    }

    // try to search for URIs not in cache so we can get full info about them
    useEffect(() => {
        organismUris
            .filter(uri => !cache[uri])
            .forEach(async uri => {
                const matchedId = uri.match(/\d+$/)?.[0]
                const searchResult = (await searchUniprot(matchedId)).find(result => result.uri == uri)
                searchResult && setCache({ [uri]: searchResult })
            })
    }, [organismUris])

    return (
        
        <FormSection title="Target Organisms">
            <MultiRowSelect
                items={organisms} //empty
                addItem={handleAdd}
                removeItem={handleRemove}
                search={searchOptions.prioritizeParents ? searchWithParent : searchUniprot}
                itemComponent={OrganismItem}
                searchItemComponent={OrganismSearchItem}
                messages={{ initial: "Type something to search", nothingFound: "Nothing found in Taxonomy" }}
                pluralLabel="organisms"
                debounce={800}
                placeholder="Search Taxonomy..."
            />
            <Group mt={10} px={2}>
                <Checkbox size="xs" label="Prioritize parents in search" checked={searchOptions.prioritizeParents} onChange={event => setSearchOptions({ prioritizeParents: event.currentTarget.checked })} />
            </Group>
        </FormSection>
    )
}


/**
 * Component for a selected item
 */
const OrganismItem = forwardRef(({ id, name, commonName, uri, onRemove }, ref) =>
    <a href={uri} target="_blank">
        <Tooltip label="View in Taxonomy" withArrow position="bottom">
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
                <Text size="sm" color="dimmed">{commonName}</Text>
                <ActionIcon color="red" onClick={event => {
                    event.preventDefault()
                    onRemove()
                }}><FaTimes /></ActionIcon>
            </Group>
        </Tooltip>
    </a>
)

/**
 * Component for an item appearing in the search
 */
const OrganismSearchItem = forwardRef(({ label, name, commonName, ...others }, ref) =>
    <div ref={ref} {...others}>
        <Group noWrap position="apart">
            <Text>{name}</Text>
            <Text color="dimmed">{commonName}</Text>
        </Group>
    </div>
)

