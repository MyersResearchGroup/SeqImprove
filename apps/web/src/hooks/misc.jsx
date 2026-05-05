import { useMantineTheme } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { generateCyclicalColors, getSearchParams } from "../modules/util";
import { isEmbedded, onEmbedChange } from "../modules/embedded";

export function useSearchParams() {
    return useMemo(() => getSearchParams(), [window.location.search])
}

export function useIsEmbedded() {
    const [embedded, setEmbedded] = useState(isEmbedded());
    useEffect(() => onEmbedChange(() => setEmbedded(isEmbedded())), []);
    return embedded;
}

export function useRandomColor(level) {
    const theme = useMantineTheme()
    const colors = Object.keys(theme.colors).slice(2)

    return useMemo(() => {
        const colorName = colors[Math.floor(Math.random() * colors.length)]
        return level == null ?
            colorName : theme.colors[colorName][level]
    }, [])
}

export function useCyclicalColors(amount, level) {
    const theme = useMantineTheme()
    return useMemo(() => generateCyclicalColors(theme.colors, amount, level), [amount, level])
}