"""Regenerate the SynBioHub upload fixtures from test_part.fasta.

Two things about these files are deliberate, and both were learned the hard way
by uploading files that produced an *empty* collection:

  1. No Collection object. SynBioHub creates the collection from what you type
     in the submit form. A hand-written Collection is not merged with that one;
     it is ingested as a second object whose members are just URI references.

  2. A namespace SynBioHub does not own. When the URIs already sit under the
     target instance (https://synbiohub.org/public/... or /user/...), SynBioHub
     reads them as references to objects it already has and skips ingesting
     them -- so the parts never arrive and the collection comes out empty. A
     foreign namespace makes it treat them as new content and re-namespace them
     into /user/<you>/<collection>/ on the way in.

Also note the XML declaration added at the end: pySBOL2 does not write one and
libSBOLj wants it.

Run:  python3 build_fixtures.py
"""
import sbol2

FASTA = "../test_part.fasta"

# SeqImprove's own homespace -- see apps/web/src/modules/homespace.js. Any namespace
# SynBioHub does not own would do; this one says where the parts came from.
HOMESPACE = "https://seqimprove.org/"

# start, end, SO role, description -- coordinates into Test_Part
PARTS = {
    'TP_promoter':   (0,    60,   'http://identifiers.org/so/SO:0000167'),
    'TP_rbs':        (60,   90,   'http://identifiers.org/so/SO:0000139'),
    'TP_cds':        (463,  1548, 'http://identifiers.org/so/SO:0000316'),
    'TP_terminator': (1600, 1660, 'http://identifiers.org/so/SO:0000141'),
    'TP_origin':     (1700, 1900, 'http://identifiers.org/so/SO:0000296'),
}

# file -> (collection id to type into the submit form, parts)
FIXTURES = {
    'A_public_v1.xml':       ('SeqImprove_TestPublic',  ['TP_promoter', 'TP_rbs', 'TP_terminator']),
    'B_private_v1.xml':      ('SeqImprove_TestPrivate', ['TP_promoter', 'TP_cds']),
    # v2 is v1 plus TP_origin: submit it into the SAME collection as v1 to test
    # that SeqImprove notices the update.
    'B_private_v2.xml':      ('SeqImprove_TestPrivate', ['TP_promoter', 'TP_cds', 'TP_origin']),
    'C_private_other_v1.xml':('SeqImprove_TestOther',   ['TP_terminator', 'TP_origin']),
    'minimal_one_part.xml':  ('SeqImprove_TestPrivate', ['TP_promoter']),
}


def test_part():
    with open(FASTA) as fh:
        return ''.join(l.strip() for l in fh if not l.startswith('>'))


def build(path, collection_id, wanted, sequence):
    sbol2.setHomespace(HOMESPACE + collection_id)
    sbol2.Config.setOption('sbol_typed_uris', False)
    doc = sbol2.Document()
    for name in wanted:
        start, end, role = PARTS[name]
        elements = sequence[start:end]
        seq = sbol2.Sequence(name + '_sequence', elements, sbol2.SBOL_ENCODING_IUPAC, '1')
        seq.name = name + ' Sequence'
        doc.addSequence(seq)
        cd = sbol2.ComponentDefinition(name, sbol2.BIOPAX_DNA, '1')
        cd.roles = [role]
        cd.name = name
        cd.description = '%s -- %d bp slice of Test_Part' % (name, end - start)
        cd.sequences = [seq.identity]
        doc.addComponentDefinition(cd)
    doc.write(path)

    # pySBOL2 emits no XML declaration and names dcterms "ns0"; both differ from
    # what SynBioHub itself writes, so match its output.
    with open(path, encoding='utf-8') as fh:
        xml = fh.read()
    xml = xml.replace('xmlns:ns0="http://purl.org/dc/terms/"',
                      'xmlns:dcterms="http://purl.org/dc/terms/"').replace('ns0:', 'dcterms:')
    if not xml.startswith('<?xml'):
        xml = '<?xml version="1.0" ?>\n' + xml
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(xml)
    return len(wanted)


if __name__ == '__main__':
    sequence = test_part()
    for path, (collection_id, wanted) in FIXTURES.items():
        n = build(path, collection_id, wanted, sequence)
        check = sbol2.Document()
        check.read(path)
        print('%-24s collection=%-24s %d parts  %s' % (
            path, collection_id, n, check.validate()))
