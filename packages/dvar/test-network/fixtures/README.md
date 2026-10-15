# Local-only TLS test fixtures

These are deliberately public TEST credentials. Never use this key, certificate,
or trust root outside the loopback tests. The private CA key is not distributed.
The leaf certificate contains only `DNS:service.example` (no loopback IP SAN).

TLS tests start child Node processes with NODE_EXTRA_CA_CERTS pointing to this
fixture. The production transport always enables normal certificate verification.
The mismatch and untrusted-chain tests must fail before HTTP request bytes reach
the local server. Regenerate these fixtures before their 2036 expiry.
