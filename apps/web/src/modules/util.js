
export function getColor(theme, color, level = 3) {
    return theme.colors[color]?.[level] ?? color
}