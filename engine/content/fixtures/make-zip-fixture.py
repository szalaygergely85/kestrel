# Regenerates py.zip (KPKG-01 fixture): python -I engine/content/fixtures/make-zip-fixture.py
import zipfile, os
here = os.path.dirname(os.path.abspath(__file__))
rows = [
    ('kestrel.json', b'{"a":1}', zipfile.ZIP_STORED),
    ('content/a.txt', b'hello hello hello hello ' * 50, zipfile.ZIP_DEFLATED),
    ('models/x.bin', bytes(range(256)), zipfile.ZIP_STORED),
    ('uni/ä.txt', 'über'.encode(), zipfile.ZIP_DEFLATED),
]
with zipfile.ZipFile(os.path.join(here, 'py.zip'), 'w') as z:
    for n, d, m in rows:
        z.writestr(zipfile.ZipInfo(n, (1980, 1, 1, 0, 0, 0)), d, compress_type=m)
