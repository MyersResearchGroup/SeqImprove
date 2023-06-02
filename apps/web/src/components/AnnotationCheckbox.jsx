import { Checkbox, Text, Group, Box } from '@mantine/core'

export default function AnnotationCheckbox({ title, subtitle, active, onChange, color }) {

    return (
        <Checkbox
            size="md"
            label={
                <Group spacing="xs" sx={{ flexGrow: 1, }}>
                    <Text color={color} weight={600}>{title}</Text>
                    <Box sx={{ flexGrow: "1 !important" }} >{subtitle}</Box>                                        
                </Group>
            }
            color={color}
            checked={active}
            onChange={event => onChange(event.currentTarget.checked)}
            mb={10}
            styles={theme => ({
                body: { display: "flex" },
                input: { backgroundColor: theme.colors[color]?.[1] ?? "transparent", cursor: "pointer" },
                label: { display: "flex", flexGrow: 1, cursor: "pointer" },
                labelWrapper: { flexGrow: 1, },
            })}
        />
    )
}