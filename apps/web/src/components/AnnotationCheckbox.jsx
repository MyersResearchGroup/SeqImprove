import { Checkbox, Text, Group, Box } from '@mantine/core'

export default function AnnotationCheckbox({ title, subtitle, active, onChange, color }) {

    return (
        <Checkbox
            size="md"
            label={
                <Group spacing="xs">
                    <Text color={color} weight={600}>{title}</Text>
                    <Box sx={{ flexGrow: 1 }} >{subtitle}</Box>
                </Group>
            }
            color={color}
            checked={active}
            onChange={event => onChange(event.currentTarget.checked)}
            mb={10}
            styles={theme => ({
                input: { backgroundColor: theme.colors[color]?.[1] ?? "transparent" },
                label: { flexGrow: 1 },
            })}
        />
    )
}