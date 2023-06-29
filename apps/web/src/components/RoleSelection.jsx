import { Group, Select, Text, Space, Button } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { forwardRef, useEffect, useState } from 'react'
import { useSequenceOntology } from '../modules/ontologies/so'
import { mutateDocument, useStore } from '../modules/store'
import shallow from 'zustand/shallow'
import { decodeRoleURI } from '../modules/roles'

function equalLists(a, b) {
    const aList = a.slice().sort();
    const bList = a.slice().sort();

    return aList.every((e, i) => e === bList[i]);
}

function Role({ idx }) {
    // const roles = useStore(s => s.document.root.roles); // should be from s.roles not s.document.root.roles
    const roles = useStore(s => s.roles);
    
    const setRole = val => {        
        mutateDocument(useStore.setState, state => {
            state.roles = state.roles.slice(0, idx).concat(val, state.roles.slice(idx + 1));
            state.document.root.roles = state.roles;
            // to ensure that state.document.root.roles is the same as state.roles, even if different order.
            if (!equalLists(state.roles, state.document.root.roles)) {
                throw new Error("useStore roles != document.root.roles");
            }
        });
    };
    
    const [searchValue, onSearchChange] = useState("");
    const [debouncedQuery] = useDebouncedValue(searchValue, 300);

    const searchSO = useSequenceOntology();
    const [searchResults, setSearchResults] = useState([]);       

    // when query changes, search
    useEffect(() => {
        searchSO(debouncedQuery)
            .then(results => setSearchResults(
                mapResultsToSelectData(results.slice(0, 20))
            ));
    }, [debouncedQuery]);

    // make sure search results initially have our selected item
    useEffect(() => {
        const func = async () => {
            if (roles[idx]) {
                const ontology = decodeRoleURI(roles[idx]);
                if (ontology) {
                    const results = await searchSO(`shortId:${ontology.replace(":", "\\:")}`);
                    setSearchResults(mapResultsToSelectData(results));
                }                
            }
        };
        func();
        // role && searchSO(`shortId:${decodeRoleURI(role).replace(":", "\\:")}`)
        //     .then(results => setSearchResults(mapResultsToSelectData(results)));        
    }, [roles[idx]]);
    
    return (
        <div key={idx}>
            <Group spacing={40}>            
                <Text size="lg" weight={600} mt={20}>Role</Text>            
                <Select
                    label={<Text color="dimmed" size="xs" ml={10}>{decodeRoleURI(roles[idx])}</Text>}
                    placeholder="Select the role for this part"
                    value={roles[idx]}
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
            <Space h="lg" />
        </div>
    );
}

export default function RoleSelection() {
    const roles = useStore(s => s.document.root.roles);

    const addRoleHandler = _ => {
        console.log(roles);
    };
    
    return roles.map((_, idx) =>
        <Role key={idx} idx={idx} />).concat(<Button key={'a'} onClick={addRoleHandler}>Add Role</Button>);
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
