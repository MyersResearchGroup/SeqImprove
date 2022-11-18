
export function splitIntoWords(str) {
    return str.split(/\s+/)
}

const trailingPunctuationRegex = /[\.,\/#!$%\^&\*;:{}=\-_`~()]$/

export function hasTrailingPunctuation(text) {
    return trailingPunctuationRegex.test(text)
}

export function removeTrailingPunctuation(text) {
    return text.replace(trailingPunctuationRegex, "")
}