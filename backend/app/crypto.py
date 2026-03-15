import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag
from base64 import b64encode, b64decode
from dotenv import load_dotenv

load_dotenv()

_key_hex = os.getenv("MASTER_ENCRYPTION_KEY")
if not _key_hex:
    raise RuntimeError("MASTER_ENCRYPTION_KEY is not set in environment variables")

MASTER_KEY = bytes.fromhex(_key_hex)

def encrypt_value(plaintext: str) -> str:
    aesgcm = AESGCM(MASTER_KEY)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return b64encode(nonce + ciphertext).decode('utf-8')

def decrypt_value(encrypted_str: str) -> str:
    try:
        aesgcm = AESGCM(MASTER_KEY)
        raw_data = b64decode(encrypted_str)
        nonce = raw_data[:12]
        ciphertext = raw_data[12:]
        decrypted_bytes = aesgcm.decrypt(nonce, ciphertext, None)
        return decrypted_bytes.decode('utf-8')
    except (InvalidTag, ValueError, Exception):
        raise ValueError("Failed to decrypt secret — data may be corrupted or key is wrong")
