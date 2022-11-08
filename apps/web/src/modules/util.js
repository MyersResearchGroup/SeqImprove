
export function getColor(theme, color, level = 3) {
    return theme.colors[color]?.[level] ?? color
}

export function getSearchParams() {
    return new Proxy(
        new URLSearchParams(window.location.search),
        {
            get: (searchParams, prop) => searchParams.get(prop),
        }
    )
}