import re

# Credential shapes to blank out of any exported transcript. Deliberately
# broad: a false positive costs a few redacted characters, a miss publishes a
# live credential.
PATTERNS = [
    (re.compile(r'\bAQ\.[A-Za-z0-9_\-]{20,}'),            'GOOGLE_TOKEN'),
    (re.compile(r'\bya29\.[A-Za-z0-9_\-]{20,}'),          'GOOGLE_OAUTH_TOKEN'),
    (re.compile(r'\bAIza[0-9A-Za-z_\-]{35}\b'),           'GCP_API_KEY'),
    (re.compile(r'\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b'), 'GITHUB_TOKEN'),
    (re.compile(r'\bgithub_pat_[A-Za-z0-9_]{50,}\b'),     'GITHUB_PAT'),
    (re.compile(r'\b(?:AKIA|ASIA)[0-9A-Z]{16}\b'),        'AWS_ACCESS_KEY_ID'),
    (re.compile(r'\bsk-[A-Za-z0-9\-_]{20,}\b'),           'API_KEY'),
    (re.compile(r'\bxox[baprs]-[A-Za-z0-9\-]{10,}\b'),    'SLACK_TOKEN'),
    (re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----', re.S), 'PRIVATE_KEY'),
    (re.compile(r'(?i)\b(authorization|bearer)\s*[:=]?\s*[A-Za-z0-9._\-]{24,}'), 'AUTH_HEADER'),
]

def scrub(text):
    hits = {}
    for pat, label in PATTERNS:
        def sub(m):
            hits[label] = hits.get(label, 0) + 1
            return f'[{label} REDACTED]'
        text = pat.sub(sub, text)
    return text, hits

if __name__ == '__main__':
    import sys
    total = {}
    for path in sys.argv[1:]:
        out, hits = scrub(open(path).read())
        open(path, 'w').write(out)
        for k, v in hits.items():
            total[k] = total.get(k, 0) + v
        print(f'{path}: {sum(hits.values())} redactions {hits if hits else ""}')
    print('TOTAL:', total or 'none')
