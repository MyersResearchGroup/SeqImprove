"""Shared fixtures for the multi-user tests.

Libraries are built from real slices of the Test_Part sequence, so a part in a
library genuinely occurs in the target and an annotation run would find it --
rather than from synthetic sequences that only exercise the plumbing.
"""

import os
import re
import sbol2

HERE = os.path.dirname(os.path.abspath(__file__))
FASTA = os.path.join(HERE, "test_part.fasta")


def test_part_sequence() -> str:
    """The Test_Part target sequence, from the FASTA fixture."""
    with open(FASTA) as f:
        return "".join(line.strip() for line in f if not line.startswith(">")).lower()


def slice_parts(names_and_spans) -> dict:
    """Cut named parts out of the Test_Part sequence."""
    seq = test_part_sequence()
    return {name: seq[start:end] for name, (start, end) in names_and_spans.items()}


def write_library(path: str, parts: dict) -> str:
    """Write an SBOL library containing the given {name: sequence} parts."""
    doc = sbol2.Document()
    for name, elements in parts.items():
        cd = doc.componentDefinitions.create(name)
        cd.types = [sbol2.BIOPAX_DNA]
        cd.roles = ["http://identifiers.org/so/SO:0000110"]
        seq = doc.sequences.create(name + "_seq")
        seq.elements = elements
        cd.sequences = [seq.identity]
    doc.write(path)
    return doc.writeString()


def library_text(parts: dict) -> str:
    """Same, but returned as a string instead of written to disk."""
    doc = sbol2.Document()
    for name, elements in parts.items():
        cd = doc.componentDefinitions.create(name)
        cd.types = [sbol2.BIOPAX_DNA]
        seq = doc.sequences.create(name + "_seq")
        seq.elements = elements
        cd.sequences = [seq.identity]
    return doc.writeString()


def part_names(feature_library) -> list:
    """The part names a FeatureLibrary exposes, for comparing before/after."""
    return sorted(f.identity.split("/")[-2] for f in feature_library.features)


# Three parts taken from distinct regions of Test_Part.
PARTS = slice_parts({
    "promoter_region": (0, 60),
    "cds_region": (463, 1548),      # the LacI-length region
    "terminator_region": (1600, 1660),
})
