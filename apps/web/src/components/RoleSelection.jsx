import { Group, Select, Text } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { forwardRef, useEffect, useState } from 'react'
import { useSequenceOntology } from '../modules/ontologies/so'
import { mutateDocument, useStore } from '../modules/store'
import shallow from 'zustand/shallow'
import { decodeRoleURI } from '../modules/roles'

export default function RoleSelection() {

    const [searchValue, onSearchChange] = useState("")
    const [debouncedQuery] = useDebouncedValue(searchValue, 300)

    const searchSO = useSequenceOntology()
    const [searchResults, setSearchResults] = useState([])

    const role = useStore(s => s.document.root.role)
    const setRole = val => {
        mutateDocument(useStore.setState, state => {
            state.document.root.role = val
        })
    }

    // when query changes, search
    useEffect(() => {
        searchSO(debouncedQuery)
            .then(results => setSearchResults(
                mapResultsToSelectData(results.slice(0, 20))
            ))
    }, [debouncedQuery])

    // make sure search results initially have our selected item
    useEffect(() => {
        role && searchSO(`shortId:${decodeRoleURI(role).replace(":", "\\:")}`)
            .then(results => setSearchResults(
                mapResultsToSelectData(results)
            ))
    }, [role])


    return (
        <Group spacing={40}>
            <Text size="lg" weight={600} mt={20}>Role</Text>
            <Select
                label={<Text color="dimmed" size="xs" ml={10}>{decodeRoleURI(role)}</Text>}
                placeholder="Select the role for this part"
                value={role}
                onChange={setRole}
                searchable
                onSearchChange={onSearchChange}
                searchValue={searchValue}
                nothingFound="No options"
                data={searchResults ?? []}
                dropdownPosition="bottom"
                itemComponent={RoleItem}
                filter={() => true}
                styles={selectStyles}
                sx={{ flexGrow: 1, }}
            />
        </Group>
    )
}

const RoleItem = forwardRef(({ label, shortId, ...others }, ref) =>
    <div ref={ref} {...others}>
        <Group noWrap position="apart">
            <Text transform="capitalize">{label}</Text>
            <Text color="dimmed">{shortId}</Text>
        </Group>
    </div>
)

const selectStyles = theme => ({
    itemsWrapper: {
        width: "calc(100% - 20px)",
    }
})


function mapResultsToSelectData(results) {
    return results.map(result => ({
        label: result.document.name ?? "Unknown",
        value: result.document.id,
        shortId: result.document.shortId,
    }))
}