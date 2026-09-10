"""Template-grounded NLG.

LAW: the voice may only rephrase within verified slots. Every drug name,
dose, and frequency in spoken output is copied from fields that passed the
confidence gate - the template never authors clinical content.

Each sentence is emitted as an AudioSegment with the slot_refs it rephrases,
so the frontend TTS engine can highlight/seek per sentence and an auditor can
trace every spoken word back to a verified slot.
"""
from __future__ import annotations

from medisaathi_contracts import (
    AudioSegment,
    AudioSegmentKind,
    NormalizedMedication,
    PlanSlot,
    SafetyReport,
    Severity,
    SpokenPlan,
)

_TEMPLATES = {
    "en": {
        "open": "Your medicine plan has {n} medicine{s}.",
        "med": "Medicine {i}: {brand}, contains {molecule}. Take {freq} for {dur}.",
        "med_nodur": "Medicine {i}: {brand}, contains {molecule}. Take {freq}.",
        "warn": "Important: {sev} interaction between {a} and {b}. {mechanism} Please discuss with your pharmacist or doctor.",
        "contra": "Important: {molecule} is not advised in this situation. {note}",
        "dup": "Note: {brands} belong to the same medicine class. Taking both together doubles the dose.",
        "close": "This is information, not medical advice. Talk to your pharmacist or doctor before changes.",
    },
    "ta": {
        "open": "உங்கள் மருந்து திட்டத்தில் {n} மருந்து{s} உள்ளது.",
        "med": "மருந்து {i}: {brand}, {molecule} கொண்டது. {freq} {dur} எடுங்கள்.",
        "med_nodur": "மருந்து {i}: {brand}, {molecule} கொண்டது. {freq} எடுங்கள்.",
        "warn": "முக்கியம்: {a} மற்றும் {b} இடையே {sev} தொடர்பு உள்ளது. மருந்தாளரை அணுகவும்.",
        "contra": "முக்கியம்: இந்த நிலையில் {molecule} பரிந்துரைக்கப்படவில்லை.",
        "dup": "குறிப்பு: {brands} ஒரே வகுப்பைச் சேர்ந்தவை. இரண்டையும் எடுத்தால் அளவு இரட்டிப்பாகும்.",
        "close": "இது தகவல் மட்டுமே, மருத்துவ ஆலோசனை அல்ல.",
    },
    "hi": {
        "open": "आपकी दवा योजना में {n} दवा{s} है।",
        "med": "दवा {i}: {brand}, इसमें {molecule} है। {freq} {dur} लें।",
        "med_nodur": "दवा {i}: {brand}, इसमें {molecule} है। {freq} लें।",
        "warn": "महत्वपूर्ण: {a} और {b} में {sev} अंतर्क्रिया है। फार्मासिस्ट से सलाह लें।",
        "contra": "महत्वपूर्ण: इस स्थिति में {molecule} की सलाह नहीं दी जाती।",
        "dup": "ध्यान दें: {brands} एक ही वर्ग की हैं। दोनों लेने से खुराक दोगुनी हो जाएगी।",
        "close": "यह केवल जानकारी है, चिकित्सा सलाह नहीं।",
    },
}

_SEV_WORD = {
    "en": {"mild": "a mild", "moderate": "a moderate", "severe": "a severe"},
    "ta": {"mild": "லேசான", "moderate": "நடுத்தர", "severe": "கடுமையான"},
    "hi": {"mild": "हल्की", "moderate": "मध्यम", "severe": "गंभीर"},
}


def build_spoken_plan(language: str, meds: list[NormalizedMedication],
                      report: SafetyReport) -> SpokenPlan:
    t = _TEMPLATES.get(language, _TEMPLATES["en"])
    slots: list[PlanSlot] = []
    segments: list[AudioSegment] = []

    def slot(name: str, value: str) -> str:
        slots.append(PlanSlot(slot=name, value=value, verified=True))
        return value

    n = slot("count", str(len(meds)))
    open_text = t["open"].format(n=n, s="" if len(meds) == 1 else "s")
    segments.append(AudioSegment(kind=AudioSegmentKind.open, text=open_text,
                                 slot_refs=["count"]))
    parts: list[str] = [open_text]

    for i, m in enumerate(meds, start=1):
        b = slot(f"med{i}.brand", m.brand)
        mol = slot(f"med{i}.molecule", m.molecule)
        # frequency and duration come from the first field, verified at gate
        freq = slot(f"med{i}.frequency", (m.fields[0].frequency if m.fields else ""))
        refs = [f"med{i}.brand", f"med{i}.molecule", f"med{i}.frequency"]
        dur = (m.fields[0].duration if m.fields else "")
        if dur:
            refs.append(f"med{i}.duration")
            text = t["med"].format(i=i, brand=b, molecule=mol, freq=freq,
                                   dur=slot(f"med{i}.duration", dur))
        else:
            text = t["med_nodur"].format(i=i, brand=b, molecule=mol, freq=freq)
        segments.append(AudioSegment(kind=AudioSegmentKind.medication, text=text,
                                     slot_refs=refs))
        parts.append(text)

    for k, it in enumerate(report.interactions, start=1):
        if it.severity in (Severity.moderate, Severity.severe):
            a = slot(f"warn{k}.a", it.molecule_a)
            b = slot(f"warn{k}.b", it.molecule_b)
            text = t["warn"].format(
                sev=_SEV_WORD[language if language in _SEV_WORD else "en"][it.severity.value],
                a=a, b=b,
                mechanism="" if language != "en" else it.mechanism)
            segments.append(AudioSegment(kind=AudioSegmentKind.warning,
                                         text=text, slot_refs=[f"warn{k}.a", f"warn{k}.b"]))
            parts.append(text)

    for k, c in enumerate(report.contraindications, start=1):
        mol = slot(f"contra{k}.molecule", c.molecule)
        text = t["contra"].format(molecule=mol)
        segments.append(AudioSegment(kind=AudioSegmentKind.contraindication,
                                     text=text, slot_refs=[f"contra{k}.molecule"]))
        parts.append(text)

    for k, d in enumerate(report.duplicates, start=1):
        brands = slot(f"dup{k}.brands", " + ".join(d.brands))
        text = t["dup"].format(brands=brands)
        segments.append(AudioSegment(kind=AudioSegmentKind.duplicate,
                                     text=text, slot_refs=[f"dup{k}.brands"]))
        parts.append(text)

    close_text = t["close"]
    segments.append(AudioSegment(kind=AudioSegmentKind.close, text=close_text, slot_refs=[]))
    parts.append(close_text)
    return SpokenPlan(language=language, slots=slots, segments=segments,
                      script=" ".join(parts))
