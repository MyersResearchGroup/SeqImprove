// The homespace SeqImprove mints its URIs under. Kept in its own module (no
// imports, so anything can pull it in without an import cycle) because it is
// referenced from the SBOL predicate namespace, the FASTA→SBOL template, and
// the "is this document already cleaned?" check.
export const HOMESPACE = "https://seqimprove.org"

// Homespaces a document may already have been cleaned under. The legacy entries
// have to stay: documents cleaned before the homespace change still carry
// synbiohub.org URIs, and re-cleaning them would rewrite URIs that are already
// stable.
export const CLEANED_URI_PREFIXES = [
    HOMESPACE,
    "https://seqimprove.synbiohub.org",
    "https://charmme.synbiohub.org",
]
