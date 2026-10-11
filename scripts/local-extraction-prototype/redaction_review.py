"""Offline review experiment only. NO provider capability, transport or activation.
A complete synthetic grammar lets us test loss/leakage and request-local mapping;
it cannot establish identifier recognition in arbitrary real documents.
"""
from dataclasses import dataclass
from hashlib import sha256
import json
import re
from weakref import WeakKeyDictionary
from extract import PREFIX, SUFFIX, ReviewRequired, _lines, _date_observation

EXCLUDED = frozenset({'SSN','Passport','License','Plate','VIN','Policy','Member','Account','Routing','Card',
                      'Credential','Birth date','Street address','Postal code','Phone','Email','Employer',
                      'Diagnosis','Treatment','Rare condition','Last four'})

@dataclass(frozen=True)
class Scope:
    household: str
    document: str
    attempt: str

@dataclass(frozen=True, eq=False)
class Prepared:
    """Opaque handle, meaningless when copied/serialized; no live gateway accepts it."""

_records = WeakKeyDictionary()


def _norm(value): return re.sub('[^a-z0-9]', '', value.lower())


def _semantic(text):
    """Recognize entire printed statement. No partial regex masking of free text."""
    money = r'([0-9]{1,5}\.[0-9]{2})'
    patterns = [
        ('balance_due_statement', r'Balance due: USD '+money+r'\. Payment due: (.+)\.'),
        ('not_bill', r'THIS IS NOT A BILL\. Service charge: USD '+money+r'\. Your responsibility: USD 0\.00\.'),
        ('paid', r'Payment received: USD '+money+r'\. Paid in full\. No payment due\.'),
        ('conditional_deposit', r'Security deposit: USD '+money+r'\. Refund subject to inspection and deductions; return date not specified\.'),
        ('printed_refund_date', r'Refund amount: USD '+money+r'\. Refund due: (.+)\.'),
        ('warranty_duration', r'Coverage lasts ([1-9][0-9]?) months from purchase; excludes accidental damage\.'),
        ('printed_expiry', r'Coverage expires: (.+)\. No automatic renewal\.'),
        ('cancel_notice', r'Cancellation effective: (.+)\. No replacement coverage stated\.'),
    ]
    for kind, pattern in patterns:
        match = re.fullmatch(pattern, text)
        if not match: continue
        if kind in {'balance_due_statement','printed_refund_date'}:
            value,status,_ = _date_observation(match[2])
            if status != 'supported': raise ReviewRequired('uncertain_context_date')
            return kind, (match[1], value)
        if kind in {'printed_expiry','cancel_notice'}:
            value,status,_ = _date_observation(match[1])
            if status != 'supported': raise ReviewRequired('uncertain_context_date')
            return kind, (value,)
        return kind, (match[1],)
    raise ReviewRequired('uncovered_context_requires_review')


def prepare_mock_context(raw, scope):
    if not isinstance(scope,Scope) or any(type(v) is not str or not 1 <= len(v) <= 80 for v in (scope.household,scope.document,scope.attempt)):
        raise ReviewRequired('invalid_local_scope')
    lines,matches = _lines(raw)
    if lines[0] != PREFIX or lines[1] != 'SYNTHETIC CONTEXT REVIEW' or lines[-1] != SUFFIX:
        raise ReviewRequired('unsupported_context_format')
    if not lines[2].startswith('Person: ') or not lines[3].startswith('Organization: ') or not lines[-2].startswith('Content: '):
        raise ReviewRequired('unsupported_context_format')
    person,organization = lines[2][8:],lines[3][14:]
    # Raw placeholder syntax/control/unicode is refused, never interpreted as an
    # already-redacted entity. Restricted ASCII slots are not synthetic-provenance proof.
    if any(not re.fullmatch(r'[A-Za-z][A-Za-z .-]{2,59}',v) for v in (person,organization)):
        raise ReviewRequired('unsupported_identity_slot')
    exclusions = []; seen = set()
    for line in lines[4:-2]:
        label,sep,value=line.partition(': ')
        if sep != ': ' or label not in EXCLUDED or label in seen or not value or len(value)>100 or '[' in value or ']' in value:
            raise ReviewRequired('uncovered_sensitive_region')
        seen.add(label);exclusions.append(value)
    text=lines[-2][9:]
    kind,values=_semantic(text)
    # Known cross-field collisions refuse. This is NOT detection of an identifier
    # disguised as a valid amount/date when no known sensitive source field exists.
    visible=_norm(text)
    for private in [person,organization,*exclusions]:
        normalized=_norm(private)
        if not normalized or normalized in visible or (len(normalized)>=8 and normalized[-4:] in visible):
            raise ReviewRequired('sensitive_value_collision')
    payload={'version':'offline-semantic-review-v1','blocks':[
        {'slot':0,'text':'Statement for [PERSON_1], issued by [ORG_1].'},
        {'slot':1,'text':text}]}
    source_hash=sha256(raw).hexdigest()
    coverage=[]
    for i,m in enumerate(matches):
        disposition='substituted' if i in (2,3) else 'retained' if i==len(lines)-2 else 'excluded'
        coverage.append((i+1,m.start(1),m.end(1),disposition))
    handle=Prepared()
    _records[handle]={'scope':scope,'source_hash':source_hash,'payload':json.dumps(payload,separators=(',',':')),
                      'entities':{'[PERSON_1]':person,'[ORG_1]':organization},'coverage':tuple(coverage),
                      'kind':kind,'values':values}
    return handle


def _bound(handle,scope,raw):
    if type(raw) is not bytes: raise ReviewRequired('stale_context')
    record=_records.get(handle) if isinstance(handle,Prepared) else None
    if record is None or record['scope']!=scope or record['source_hash']!=sha256(raw).hexdigest():
        raise ReviewRequired('stale_context')
    return record


def mock_payload(handle,scope,raw):
    """Serialization for LOCAL leakage tests only. Not accepted by any gateway."""
    return _bound(handle,scope,raw)['payload']


def local_entity(handle,scope,raw,placeholder):
    record=_bound(handle,scope,raw)
    if placeholder not in record['entities']: raise ReviewRequired('unknown_placeholder')
    return record['entities'][placeholder]


def coverage_evidence(handle,scope,raw):
    return _bound(handle,scope,raw)['coverage']


def deterministic_mock_read(payload):
    """Reference comparator only; no model, quality claim or obligation creation."""
    if type(payload) is not str or len(payload)>2048: raise ReviewRequired('invalid_mock_payload')
    try:
        def unique(pairs):
            result={}
            for k,v in pairs:
                if k in result: raise ValueError()
                result[k]=v
            return result
        data=json.loads(payload,object_pairs_hook=unique)
        if type(data) is not dict or set(data)!={'version','blocks'} or data['version']!='offline-semantic-review-v1':raise ValueError()
        blocks=data['blocks']
        if type(blocks) is not list or len(blocks)!=2:raise ValueError()
        if any(type(b) is not dict or set(b)!={'slot','text'} or type(b['slot']) is not int or b['slot']!=i or type(b['text']) is not str for i,b in enumerate(blocks)):raise ValueError()
        if blocks[0]['text']!='Statement for [PERSON_1], issued by [ORG_1].':raise ValueError()
        kind,values=_semantic(blocks[1]['text'])
        return {'observation':kind,'printed_values':values,'decision':'requires-human-review','provider_called':False}
    except (ValueError,TypeError,KeyError):raise ReviewRequired('invalid_mock_payload') from None
