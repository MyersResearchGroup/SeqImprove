import { Group, Select, Text } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { forwardRef, useEffect, useState } from 'react'
import { useSequenceOntology } from '../ontologies/so'
import { useStore } from '../modules/store'
import shallow from 'zustand/shallow'

export default function RoleSelection() {

    const [searchValue, onSearchChange] = useState("")
    const [debouncedQuery] = useDebouncedValue(searchValue, 300)

    const searchSO = useSequenceOntology()
    const [searchResults, setSearchResults] = useState([])

    const [role, setRole] = useStore(s => [s.role, s.setRole], shallow)

    useEffect(() => {
        searchSO(debouncedQuery).then(results => setSearchResults(
            results.slice(0, 20).map(result => {
                const fixedName = toTitleCase(result.document.name ?? "unknown")
                return {
                    ...result.document,
                    name: fixedName,
                    // label: `${fixedName}, ${result.document.id}`,
                    label: fixedName,
                    value: result.document.id,
                }
            })

        ))
    }, [debouncedQuery])

    return (
        <Group spacing={40}>
            <Text size="lg" weight={600} mt={20}>Role</Text>
            <Select
                label={<Text color="dimmed" size="xs" ml={10}>{role}</Text>}
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

const RoleItem = forwardRef(({ label, id, name, ...others }, ref) =>
    <div ref={ref} {...others}>
        <Group noWrap position="apart">
            <Text transform="capitalize">{name}</Text>
            <Text color="dimmed">{id}</Text>
        </Group>
    </div>
)

const selectStyles = theme => ({
    itemsWrapper: {
        width: "calc(100% - 20px)",
    }
})

function toTitleCase(text) {
    return text.toLowerCase()
        .replaceAll("_", " ")
        .split(" ")
        .map((s) => s.charAt(0).toUpperCase() + s.substring(1))
        .join(" ")
}