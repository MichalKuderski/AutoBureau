"""Offline design reference, NOT a runtime admission path. Requires jsonschema==4.26.0.
Run: python3 -m unittest discover -s docs/engineering/proposals/adr018-projection -v
No provider, credential, application import, or document transmission.
"""
import copy
import datetime
import json
from pathlib import Path
import unittest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).parent
POLICY = json.loads((ROOT / 'field-policy.draft.json').read_text())
SCHEMAS = [json.loads((ROOT / name).read_text()) for name in
           ['provider-request.draft.schema.json', 'provider-response.draft.schema.json']]
for schema in SCHEMAS:
    Draft202012Validator.check_schema(schema)
REQUEST, RESPONSE = map(Draft202012Validator, SCHEMAS)
VERSION = 'typed-candidates-draft-1'


def load_bounded(raw):
    if type(raw) is not bytes or len(raw) > 32768:
        raise ValueError('review')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('review')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('review')),
                      parse_float=lambda _: (_ for _ in ()).throw(ValueError('review')))


def validate_request(request):
    REQUEST.validate(request)
    roles = POLICY['docTypes'][request['docType']]
    candidates = request['candidates']
    if any(type(c['slot']) is not int for c in candidates) or [c['slot'] for c in candidates] != list(range(len(candidates))):
        raise ValueError('review')
    for c in candidates:
        role, value = c['role'], c['value']
        if role not in roles + ['document_state']:
            raise ValueError('review')
        expected = 'document-state' if role == 'document_state' else 'money' if role.endswith('_amount') or role == 'amount_due' else 'date'
        if value['kind'] != expected:
            raise ValueError('review')
        if expected == 'date':
            datetime.date.fromisoformat(value['value'])
        if expected == 'money' and type(value['minorUnits']) is not int:
            raise ValueError('review')
    # Canonical source ordering, semantic role evidence and immutable-map authenticity
    # cannot be proved by this JSON reference. Trusted parser/broker must supply them.


def validate_response(request, response):
    validate_request(request)
    RESPONSE.validate(response)
    if response['docType'] != request['docType']:
        raise ValueError('review')
    fields = response['fields']
    expected = POLICY['docTypes'][request['docType']]
    if sorted(f['role'] for f in fields) != sorted(expected):
        raise ValueError('review')
    candidates = request['candidates']
    supported = {}
    for field in fields:
        refs, status = field['sourceSlots'], field['status']
        if any(type(i) is not int or i >= len(candidates) or candidates[i]['role'] != field['role'] for i in refs):
            raise ValueError('review')
        available = [c['slot'] for c in candidates if c['role'] == field['role']]
        if status == 'missing' and (refs or available) or status == 'supported' and (len(refs) != 1 or refs != available):
            raise ValueError('review')
        if status == 'conflicting' and (sorted(refs) != available or len(refs) < 2 or len({json.dumps(candidates[i]['value'], sort_keys=True) for i in refs}) < 2):
            raise ValueError('review')
        # This draft has no trusted local ambiguity receipt: always fail closed.
        if status == 'ambiguous':
            raise ValueError('review')
        if status == 'supported':
            supported[field['role']] = candidates[refs[0]]['value']
    for start, end in [('effective_date', 'expiry_date'), ('start_date', 'end_date'), ('period_start', 'period_end')]:
        if start in supported and end in supported and supported[start]['value'] > supported[end]['value']:
            raise ValueError('review')


def sample(doc_type='medical_bill'):
    role = POLICY['docTypes'][doc_type][0]
    request = {'version': VERSION, 'docType': doc_type, 'candidates': [
        {'slot': 0, 'role': role, 'value': {'kind': 'date', 'value': '2028-02-29'}}]}
    response = {'version': VERSION, 'docType': doc_type, 'decision': 'requires-human-review',
                'fields': [{'role': r, 'status': 'supported' if r == role else 'missing',
                            'sourceSlots': [0] if r == role else []} for r in POLICY['docTypes'][doc_type]]}
    return request, response


class ProjectionDesignTests(unittest.TestCase):
    def test_eight_types_have_complete_response_role_set(self):
        self.assertEqual(len(POLICY['docTypes']), 8)
        for doc_type in POLICY['docTypes']:
            with self.subTest(doc_type=doc_type):
                validate_response(*sample(doc_type))

    def test_every_object_schema_is_closed_and_required(self):
        def walk(value):
            if isinstance(value, dict):
                if value.get('type') == 'object':
                    self.assertIs(value['additionalProperties'], False)
                    self.assertEqual(set(value['properties']), set(value['required']))
                for child in value.values(): walk(child)
            elif isinstance(value, list):
                for child in value: walk(child)
        for schema in SCHEMAS: walk(schema)

    def test_forbidden_channels_at_every_request_level(self):
        for name in POLICY['providerExcluded'] + POLICY['localOnly']:
            for level in range(3):
                request, _ = sample()
                target = [request, request['candidates'][0], request['candidates'][0]['value']][level]
                target[name] = 'synthetic-sensitive-canary'
                with self.subTest(name=name, level=level), self.assertRaises(Exception): validate_request(request)

    def test_duplicate_keys_and_nonfinite_json(self):
        for raw in [b'{"slot":0,"slot":1}', b'{"value":NaN}', b'{"value":Infinity}', b'{"value":1e400}', b'{"slot":0.0}',
                    b'{"nested":{"x":1,"x":2}}', b' ' * 32769, b'\xff']:
            with self.subTest(raw=raw[:40]), self.assertRaises(Exception): load_bounded(raw)
        self.assertEqual(load_bounded(b'{"x":1}'), {'x': 1})

    def test_date_is_calendar_checked_not_pattern_only(self):
        for date in ['2026-02-29','2026-13-01','2026-01-00','2026-1-01','1900-01-01',
                     '2026-10-01\naccount=123456789','２０２６-１０-０１']:
            request, _ = sample(); request['candidates'][0]['value']['value'] = date
            with self.subTest(date=date), self.assertRaises(Exception): validate_request(request)

    def test_money_not_identifier_or_float_coercion(self):
        for amount in ['123456789', True, 1.0, -1, 100000001, float('nan')]:
            request, _ = sample(); request['candidates'][0].update(role='amount_due', value={'kind':'money','minorUnits':amount,'currency':'USD'})
            with self.subTest(amount=amount), self.assertRaises(Exception): validate_request(request)
        request['candidates'][0]['value']['minorUnits'] = 0
        validate_request(request)  # no obligation construction exists here
        request['candidates'][0]['value']['currency'] = 'EUR'
        with self.assertRaises(Exception): validate_request(request)

    def test_cross_type_role_kind_and_slot_corruption(self):
        mutations = [lambda c: c.update(slot=1), lambda c: c.update(slot=0.0), lambda c: c.update(slot=True),
                     lambda c: c.update(role='expiry_date'), lambda c: c.update(role='amount_due'),
                     lambda c: c.update(role='account_number')]
        for mutate in mutations:
            request, _ = sample(); mutate(request['candidates'][0])
            with self.assertRaises(Exception): validate_request(request)
        request, _ = sample(); request['candidates'] *= 2
        with self.assertRaises(Exception): validate_request(request)

    def test_response_cannot_invent_value_or_citation(self):
        for key in ['value','confidence','sourceUrl','page','quote','sourceSha256']:
            request, response = sample(); response['fields'][0][key] = 'synthetic-canary'
            with self.subTest(key=key), self.assertRaises(Exception): validate_response(request,response)

    def test_reference_and_status_failures(self):
        for refs, status in [([63],'supported'),([0,0],'supported'),([],'supported'),([0],'missing'),
                             ([0],'conflicting'),([], 'ambiguous'),([True],'supported'),([-1],'supported')]:
            request,response=sample(); response['fields'][0].update(sourceSlots=refs,status=status)
            with self.subTest(refs=refs,status=status), self.assertRaises(Exception): validate_response(request,response)

    def test_wrong_role_reference_and_missing_duplicate_roles(self):
        for mutate in [lambda r:r['fields'][1].update(status='supported',sourceSlots=[0]),
                       lambda r:r['fields'].pop(), lambda r:r['fields'].append(copy.deepcopy(r['fields'][0])),
                       lambda r:r.update(docType='lease'),lambda r:r.update(decision='auto-apply')]:
            request,response=sample(); mutate(response)
            with self.assertRaises(Exception): validate_response(request,response)

    def test_conflict_needs_different_locally_bound_values(self):
        request,response=sample(); request['candidates'].append(copy.deepcopy(request['candidates'][0])); request['candidates'][1]['slot']=1
        response['fields'][0].update(status='conflicting',sourceSlots=[0,1])
        with self.assertRaises(Exception): validate_response(request,response)
        request['candidates'][1]['value']['value']='2028-03-01'
        validate_response(request,response)

    def test_model_cannot_hide_existing_evidence_or_choose_away_conflict(self):
        request,response=sample(); response['fields'][0].update(status='missing',sourceSlots=[])
        with self.assertRaises(Exception): validate_response(request,response)
        request,response=sample(); request['candidates'].append(copy.deepcopy(request['candidates'][0]))
        request['candidates'][1].update(slot=1,value={'kind':'date','value':'2029-01-01'})
        with self.assertRaises(Exception): validate_response(request,response)

    def test_reversed_period_is_refused(self):
        request,response=sample('lease')
        request['candidates'].append({'slot':1,'role':'end_date','value':{'kind':'date','value':'2027-01-01'}})
        response['fields'][1].update(status='supported',sourceSlots=[1])
        with self.assertRaises(Exception): validate_response(request,response)

    def test_identifier_disguised_as_valid_money_is_not_a_redaction_proof(self):
        request,_=sample(); request['candidates'][0].update(role='amount_due',value={'kind':'money','minorUnits':12345678,'currency':'USD'})
        validate_request(request)
        # Deliberate limitation witness: syntax cannot decide whether these digits
        # came from an amount or an account. No capability/provider caller exists.
        self.assertEqual(POLICY['status'], 'proposal-only-not-approved-for-egress')

if __name__ == '__main__': unittest.main()
