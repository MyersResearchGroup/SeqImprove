import { useMantineTheme } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";

export function useRandomColor(level) {
    const theme = useMantineTheme()
    const colors = Object.keys(theme.colors).slice(2)

    const [color, setColor] = useState()

    useEffect(() => {
        const colorName = colors[Math.floor(Math.random() * colors.length)]
        setColor(
            level == null ?
                colorName : theme.colors[colorName][level]
        )
    }, [])

    return color
}

export function useCyclicalColors(amount, level) {
    const theme = useMantineTheme()
    const result = []

    let index = 0
    while(result.length < amount) {
        const colorName = colorCycle[index++]
        result.push(
            level == null ?
                colorName : 
                theme.colors[colorName][level]
        )
        index >= colorCycle.length && (index = 0)
    }
    
    return result
}

const colorCycle = ["pink", "yellow", "teal", "indigo", "red", "lime", "cyan", "violet", "orange", "green", "blue", "grape" ]