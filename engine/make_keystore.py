"""Create the Android signing key for Echo Lingo (run once).

Writes engine/keys/echo-lingo-release.p12 and engine/keys/password.txt (both git-ignored).
Keep a backup: every future APK must be signed with this same key or Android refuses the update.
"""
import datetime
import os
import secrets

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = os.path.join(HERE, 'keys')
P12 = os.path.join(KEYS, 'echo-lingo-release.p12')
PW = os.path.join(KEYS, 'password.txt')

if os.path.exists(P12):
    raise SystemExit(f'{P12} already exists; refusing to overwrite the signing key')
os.makedirs(KEYS, exist_ok=True)
password = secrets.token_urlsafe(24)
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Echo Lingo'), x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Echo Lingo')])
now = datetime.datetime.now(datetime.timezone.utc)
cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365 * 30)).sign(key, hashes.SHA256()))
enc = (serialization.PrivateFormat.PKCS12.encryption_builder()
       .kdf_rounds(50000).key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC)
       .hmac_hash(hashes.SHA1()).build(password.encode()))
with open(P12, 'wb') as f:
    f.write(pkcs12.serialize_key_and_certificates(b'echolingo', key, cert, None, enc))
with open(PW, 'w', encoding='utf-8') as f:
    f.write(password)
print('created', P12, '(alias: echolingo)')
