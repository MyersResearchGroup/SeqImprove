import { Loader, Select, Text } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import React, { useEffect, useState } from 'react'

export default function MultiRowSelect({ items, addItem, removeItem, search, itemComponent: ItemComponent, searchItemComponent, 
    pluralLabel, debounce = 500, messages: { nothingFound, initial } = {}, ...props }) {

    // states
    const [query, setQuery] = useState("")
    const [debouncedQuery] = useDebouncedValue(query, debounce)
    const [searchResults, setSearchResults] = useState([])
    const [searchLoading, setSearchLoading] = useState(false)

    // handlers
    const handleSelection = selected => {
        setQuery("")
        !items.find(item => item.id == selected) &&
        addItem(searchResults.find(result => result.id == selected))
    }
    const handleSearchChange = newQuery => {
        newQuery && setSearchLoading(true)
        setQuery(newQuery)
    }

    // search when debounced query changes
    useEffect(() => {
        if (debouncedQuery)
            search(debouncedQuery).then(results => {
                setSearchResults(
                    results.slice(0, 20).map(result => ({
                        ...result,
                        label: result.name,
                        value: result.id,
                    }))
                )
                setSearchLoading(false)
            })
        else setSearchLoading(false)
    }, [debouncedQuery])

    return (
        <>
            {items.length ?
                items.map(item => <ItemComponent {...item} onRemove={() => removeItem(item.id)} key={item.id} />) :
                <Text color="dimmed" px={10}>Search below to add {pluralLabel}</Text>}
            <Select
                value={null}
                onChange={handleSelection}
                searchable
                onSearchChange={handleSearchChange}
                searchValue={query}
                nothingFound={query ? searchLoading ? "..." : nothingFound : initial}
                data={searchResults ?? []}
                dropdownPosition="bottom"
                itemComponent={searchItemComponent}
                filter={() => true}
                rightSection={searchLoading && <Loader size="xs" mr={10} />}
                styles={selectStyles}
                mt={10}
                {...props}
            />
        </>
    )
}


const selectStyles = theme => ({
    itemsWrapper: {
        width: "calc(100% - 20px)",
    }
})