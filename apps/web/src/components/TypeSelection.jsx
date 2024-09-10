import { Group, Select, Text, Space, Button, CloseButton } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { forwardRef, useEffect, useState } from 'react'
import { useSequenceOntology } from '../modules/ontologies/so'
import { mutateDocument, useStore } from '../modules/store'
import shallow from 'zustand/shallow'
import { decodeRoleURI } from '../modules/roles'
import { ScooterElectric } from 'tabler-icons-react'


export default function TypeSelection() {
    const type = useStore(s => s.types);
    const isFileEdited = useStore((s) => s.isFileEdited);

    let selectedTopology = type.filter(item => item.startsWith('http://identifiers.org/so/SO:'));

    const labels = ['Linear', 'Circular', 'Double-stranded', 'Single-stranded', 'Linear double-stranded', 'Linear single-stranded', 'Circular double-stranded', 'Circular single-stranded']

    const types = [
        // use an array for values, then append to types in document
        { value: ['http://identifiers.org/so/SO:0000987'], label: 'Linear' },
        { value: ['http://identifiers.org/so/SO:0000988'], label: 'Circular' },
        { value: ['http://identifiers.org/so/SO:0000985'], label: 'Double-stranded'}, 
        { value: ['http://identifiers.org/so/SO:0000984'], label: 'Single-stranded'},
        { value: ['http://identifiers.org/so/SO:0000987', 'http://identifiers.org/so/SO:0000985'], label: 'Linear double-stranded'},
        { value: ['http://identifiers.org/so/SO:0000988', 'http://identifiers.org/so/SO:0000985'], label: 'Circular double-stranded'}, 
        { value: ['http://identifiers.org/so/SO:0000987', 'http://identifiers.org/so/SO:0000984'], label: 'Linear single-stranded'}, 
        { value: ['http://identifiers.org/so/SO:0000988', 'http://identifiers.org/so/SO:0000984'], label: 'Circular single-stranded'},
    ]

    const getLabelFromValue = (value) => {
        for (const type of types) {
            if (String(type.value) === String(value)) {
                return type.label;
            }
        }
        return
    }

    const getValueFromLabel = (label) => {
        for (const type of types) {
            if (String(type.label) === String(label)) {
                return type.value;
            }
        }
        return
    }
    
    const setType = val => {
        const selectedTypes = getValueFromLabel(val)
        selectedTopology = selectedTypes    
            
        mutateDocument(useStore.setState, state => {
            state.types = state.types.filter(x => !x.startsWith('http://identifiers.org/so/SO:'))
            state.document.root.type = state.types[0] //reset and only include dna region type

            // state.types.push(String(val))
            for (const x in selectedTypes) {
                state.types.push(String(selectedTypes[x]))
                state.document.root.addType(String(selectedTypes[x]));
            }
        });
    };

    return (
        <div>
            <Group spacing={40}>  
                <Text size="lg" weight={600} mt={20}>DNA Topology</Text>            
                <Select
                    data={labels}
                    value={getLabelFromValue(selectedTopology)}
                    onChange={setType}
                    label={<Text color="dimmed" size="xs" ml={10}>{formatTopologies(selectedTopology)}</Text>}
                    sx={{ flexGrow: 1, }}
                    styles={selectStyles}
                    searchable
                    allowDeselect={true}
                />
            </Group>
            <Space h="lg" />
        </div>
    );
}

const formatTopologies = (topologies) => {
    let formattedString = ''
    for (let x in topologies) {
        topologies[x] = decodeRoleURI(topologies[x])
        if (x == 0) formattedString += topologies[x] 
        else formattedString += ', ' + topologies[x]
    }

    return formattedString
}

const selectStyles = theme => ({
    itemsWrapper: {
        width: "calc(100% - 20px)",
    }
})