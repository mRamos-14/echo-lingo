"""Stamp a new app version and regenerate sw.js + js/version.js.

Run this before every publish:  .venv\\Scripts\\python.exe build_pwa.py
Phones running the installed app notice the changed sw.js, download the new version in the
background, and show an "Update now" button.
"""
import datetime
import hashlib
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SHELL = ['./', 'index.html', 'download.html','css/app.css', 'js/lang.js', 'js/app.js', 'js/version.js', 'manifest.webmanifest',
         'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
         'icons/favicon.png', 'data/index.json', 'audio/manifest.json']


def main():
    with open(os.path.join(ROOT, 'data', 'index.json'), encoding='utf-8') as f:
        files = SHELL + [t['file'] for c in json.load(f) for t in c['tiers']]
    # content fingerprint, so the version only changes when something actually changed
    h = hashlib.sha1()
    for rel in [f for f in files if f not in ('./', 'js/version.js')] + ['engine/sw.template.js']:
        with open(os.path.join(ROOT, rel), 'rb') as f:
            h.update(rel.encode() + f.read())
    fp = h.hexdigest()[:8]
    vfile = os.path.join(ROOT, 'js', 'version.js')
    old = open(vfile, encoding='utf-8').read() if os.path.exists(vfile) else ''
    if f"fp: '{fp}'" in old:
        version = re.search(r"version: '([^']+)'", old).group(1)
        print('no changes since', version)
    else:
        version = datetime.datetime.now().strftime('%Y.%m.%d-%H%M%S')
        with open(vfile, 'w', encoding='utf-8') as f:
            f.write(f"window.EL_VERSION = {{ version: '{version}', fp: '{fp}' }};\n")
    with open(os.path.join(ROOT, 'engine', 'sw.template.js'), encoding='utf-8') as f:
        sw = f.read().replace('__VERSION__', version).replace('__FP__', fp).replace('__FILES__', json.dumps(files, indent=2))
    with open(os.path.join(ROOT, 'sw.js'), 'w', encoding='utf-8') as f:
        f.write(sw)
    print(f'version {version} ({len(files)} files precached)')


if __name__ == '__main__':
    main()
