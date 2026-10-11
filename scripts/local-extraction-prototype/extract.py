"""Offline synthetic source-to-candidate slice. No gateway, network, DB or secrets.
Only the complete public boundary-PDF grammar for medical/utility bills is supported.
Not an arbitrary PDF parser, scanner receipt, production redactor or write authority.
"""
from dataclasses import dataclass
from datetime import date
from hashlib import sha256
import re

PREFIX = 'FICTIONAL TEST SAMPLE - NOT VALID FOR ANY REAL USE'
SUFFIX = 'All details invented. No valid identity, account or payment reference.'
TYPES = {'SYNTHETIC MEDICAL BILL': 'medical_bill', 'SYNTHETIC UTILITY BILL': 'utility_bill'}
MONTHS = {name: i for i, name in enumerate(('January February March April May June July August September October November December').split(), 1)}


class ReviewRequired(ValueError):
    def __init__(self, reason='unsupported_source'):
        self.reason = reason
        super().__init__(reason)  # no input bytes/values in errors


def canonical_pdf(lines):
    """Exact existing draft corpus PDF grammar, used to account for every byte."""
    esc = lambda s: s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    stream = 'BT\n/F1 11 Tf\n54 738 Td\n' + '\n0 -22 Td\n'.join('(' + esc(s) + ') Tj' for s in lines) + '\nET\n'
    bodies = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
              '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
              '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', f'<< /Length {len(stream)} >>\nstream\n{stream}endstream']
    out = '%PDF-1.4\n'; offsets = []
    for i, body in enumerate(bodies, 1):
        offsets.append(len(out)); out += f'{i} 0 obj\n{body}\nendobj\n'
    start = len(out); out += 'xref\n0 6\n0000000000 65535 f \n' + ''.join(f'{v:010} 00000 n \n' for v in offsets)
    return (out + f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n').encode('ascii')


@dataclass(frozen=True)
class Citation:
    source_hash: str
    page: int
    line: int
    start: int
    end: int
    baseline_x: int
    baseline_y: int


@dataclass(frozen=True)
class Field:
    name: str
    value: str | int | None
    status: str
    citations: tuple[Citation, ...]


@dataclass(frozen=True)
class Result:
    source_hash: str
    doc_type: str
    fields: tuple[Field, ...]
    reasons: tuple[str, ...]
    # Proposals only; never persisted or scheduled, and always require review.
    payment_candidate: tuple[str, str, int] | None
    decision: str = 'requires-human-review'


def _lines(raw):
    if type(raw) is not bytes or not 500 <= len(raw) <= 8192 or any(b > 127 for b in raw):
        raise ReviewRequired()
    text = raw.decode('ascii')
    matches = list(re.finditer(r'^\(((?:[^()\\\n]|\\[()\\])*)\) Tj$', text, re.M))
    if not 6 <= len(matches) <= 12:
        raise ReviewRequired()
    lines = [re.sub(r'\\([()\\])', r'\1', m[1]) for m in matches]
    if any(len(line) > 180 for line in lines) or canonical_pdf(lines) != raw:
        raise ReviewRequired()
    # Value regions refer to literal content bytes; parenthesis/backslash escaping
    # is accounted for in raw quote span. Normalized text is not a byte offset.
    return lines, matches


def extract(raw):
    lines, matches = _lines(raw)
    if lines[0] != PREFIX or lines[-1] != SUFFIX or lines[1] not in TYPES:
        raise ReviewRequired('unsupported_type_or_format')
    if lines[2:4] != ['Issued to: Example Person', 'Issuer: Example Organization']:
        raise ReviewRequired('unsupported_identity_fixture')
    source_hash = sha256(raw).hexdigest()
    def cite(i):
        m = matches[i]
        return Citation(source_hash, 1, i + 1, m.start(1), m.end(1), 54, 738 - 22 * i)
    fields = [Field('holder', 'Example Person', 'supported', (cite(2),)),
              Field('issuer', 'Example Organization', 'supported', (cite(3),))]
    reasons = []; dates = []; date_refs = []; amount = None; amount_ref = None; blocked_payment = False
    body = lines[4:-1]
    specials = {
        'medical_bill': 'Balance due: USD 0.00. Paid in full. No payment due.',
        'utility_bill': 'Account credit: USD 25.00. No amount payable.'}
    if body == [specials[TYPES[lines[1]]]]:
        blocked_payment = True
        status = 'paid' if TYPES[lines[1]] == 'medical_bill' else 'credit'
        fields.append(Field('document_state', status, 'supported', (cite(4),)))
        fields.append(Field('amount_due', 0, 'supported', (cite(4),)))
        if status == 'credit': fields.append(Field('credit_amount', 2500, 'supported', (cite(4),)))
        reasons.append('no_payment_due')
    else:
        # Fully enumerated local grammar; no silent unknown-line/identifier drop.
        if not 2 <= len(body) <= 4 or not body[0].startswith('Payment due date: ') or not body[-1].startswith('Amount due: USD '):
            raise ReviewRequired()
        amount_match = re.fullmatch(r'Amount due: USD ([0-9]{1,6})\.([0-9]{2})', body[-1])
        if not amount_match: raise ReviewRequired('invalid_amount')
        amount = int(amount_match[1]) * 100 + int(amount_match[2]); amount_ref = cite(len(lines) - 2)
        date_lines = body[:-1]
        if len(date_lines) != 1 and not (len(date_lines) == 3 and date_lines[1].startswith('Payment due date in attached note: ')
                and date_lines[2] == 'Neither statement identifies which one supersedes the other.'):
            raise ReviewRequired()
        date_lines = date_lines[:2] if len(date_lines) == 3 else date_lines
        for offset, line in enumerate(date_lines):
            prefix = 'Payment due date: ' if offset == 0 else 'Payment due date in attached note: '
            value = line[len(prefix):]; date_refs.append(cite(offset + 4))
            if value == 'Not supplied': dates.append(None); reasons.append('missing_date'); continue
            if re.fullmatch(r'[0-9]{2}/[0-9]{2}/20[2-9][0-9] \(date order unspecified\)', value):
                dates.append(None); reasons.append('ambiguous_date'); continue
            match = re.fullmatch(r'([A-Za-z]+) ([0-9]{1,2}), (20[2-9][0-9])', value)
            if not match or match[1] not in MONTHS: raise ReviewRequired('unsupported_date_text')
            try: dates.append(date(int(match[3]), MONTHS[match[1]], int(match[2])).isoformat())
            except ValueError: dates.append(None); reasons.append('invalid_calendar_date')
        status = 'supported'
        if len(dates) > 1:
            status = ('invalid' if 'invalid_calendar_date' in reasons else 'ambiguous') if any(d is None for d in dates) else 'conflicting' if len(set(dates)) > 1 else 'ambiguous'
            reasons.append('multiple_date_statements')
        elif reasons: status = 'ambiguous' if 'ambiguous_date' in reasons else 'missing' if 'missing_date' in reasons else 'invalid'
        fields.append(Field('payment_due_date', dates[0] if status == 'supported' else None, status, tuple(date_refs)))
        fields.append(Field('amount_due', amount, 'supported', (amount_ref,)))
    payment = None
    if not blocked_payment and not reasons and amount is not None and amount > 0:
        payment = ('owed_by', dates[0], amount)
    # No guessed expiry, credit-refund date, recurrence, legal deadline or auto-apply.
    return Result(source_hash, TYPES[lines[1]], tuple(fields), tuple(sorted(set(reasons))), payment)


def resolve_source(raw, citation):
    lines, matches = _lines(raw)
    if not isinstance(citation, Citation) or citation.source_hash != sha256(raw).hexdigest() or citation.page != 1:
        raise ReviewRequired('stale_source')
    if any(type(value) is not int for value in (citation.page, citation.line, citation.start, citation.end, citation.baseline_x, citation.baseline_y)):
        raise ReviewRequired('stale_source')
    if type(citation.line) is not int or not 1 <= citation.line <= len(lines): raise ReviewRequired('stale_source')
    index = citation.line - 1; match = matches[index]
    if (citation.start, citation.end, citation.baseline_x, citation.baseline_y) != (match.start(1), match.end(1), 54, 738 - 22 * index):
        raise ReviewRequired('stale_source')
    return lines[index]


@dataclass(frozen=True)
class RegistryEntry:
    household: str
    member: str
    item: str
    holder: str
    issuer: str
    doc_type: str


def link_for_review(result, household, entries):
    """Local exact-match suggestion only. No fuzzy cross-household or new-item write."""
    if type(household) is not str or not household: raise ReviewRequired('invalid_scope')
    values = {f.name: f.value for f in result.fields if f.status == 'supported'}
    matches = [e for e in entries if e.household == household and e.holder == values.get('holder')
               and e.issuer == values.get('issuer') and e.doc_type == result.doc_type]
    if len(matches) != 1: return {'status': 'unresolved' if not matches else 'ambiguous', 'member': None, 'item': None}
    return {'status': 'suggested-needs-review', 'member': matches[0].member, 'item': matches[0].item}


def review_snapshot(raw, result, household, entries):
    """Source-backed display model; re-extract before trusting a serialized result.
    Household auth/DB lease/persistence are deliberately absent, not simulated.
    """
    current = extract(raw)
    if current != result: raise ReviewRequired('stale_or_forged_result')
    return {'decision': 'requires-human-review', 'link': link_for_review(current, household, entries),
            'fields': tuple({'name': field.name, 'value': field.value, 'status': field.status,
                             'sources': tuple(resolve_source(raw, c) for c in field.citations)} for field in current.fields),
            'payment_candidate': current.payment_candidate}
