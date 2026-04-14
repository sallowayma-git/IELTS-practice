const READING_ANALYSIS_CONTRACT_VERSION = 'v1';

function clampNumber(value, min = 0, max = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return min;
    }
    if (numeric < min) return min;
    if (numeric > max) return max;
    return numeric;
}

function sanitizeEvidenceList(list) {
    if (typeof list === 'string') {
        const text = list.trim();
        return text ? [text] : [];
    }
    if (list && typeof list === 'object' && !Array.isArray(list)) {
        const flattened = Object.entries(list)
            .map(([key, value]) => `${String(key)}: ${String(value)}`)
            .filter((text) => String(text || '').trim());
        return sanitizeEvidenceList(flattened);
    }
    if (!Array.isArray(list)) {
        return [];
    }
    return list
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 3);
}

function pickField(obj, keys = []) {
    for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        const value = obj?.[key];
        if (value === undefined || value === null) {
            continue;
        }
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value);
        }
    }
    return '';
}

function pickArrayField(obj, keys = []) {
    for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        const value = obj?.[key];
        if (Array.isArray(value)) {
            return value;
        }
    }
    return [];
}

function sanitizeDiagnosisList(list) {
    if (!Array.isArray(list)) {
        return [];
    }
    return list
        .map((item, index) => {
            if (!item || typeof item !== 'object') {
                return null;
            }
            const reason = pickField(item, ['reason', 'message', 'analysis', 'comment', 'diagnosis', 'finding', 'insight', '结论', '诊断']);
            if (!reason) {
                return null;
            }
            return {
                code: String(item.code || `diagnosis_${index + 1}`).trim() || `diagnosis_${index + 1}`,
                reason,
                evidence: sanitizeEvidenceList(item.evidence || item.evidence_points || item.facts || item.support)
            };
        })
        .filter(Boolean)
        .slice(0, 4);
}

function sanitizeNextActions(list) {
    if (!Array.isArray(list)) {
        return [];
    }
    return list
        .map((item, index) => {
            if (!item || typeof item !== 'object') {
                return null;
            }
            const instruction = pickField(item, ['instruction', 'action', 'recommendation', 'suggestion', 'feedback', 'next_step', 'nextStep', '建议']);
            if (!instruction) {
                return null;
            }
            return {
                type: String(item.type || `action_${index + 1}`).trim() || `action_${index + 1}`,
                target: String(item.target || 'overall').trim() || 'overall',
                instruction,
                evidence: sanitizeEvidenceList(item.evidence || item.evidence_points || item.facts || item.support)
            };
        })
        .filter(Boolean)
        .slice(0, 3);
}

function buildReadingSingleAttemptResponseFormat() {
    return {
        type: 'json_schema',
        json_schema: {
            name: 'reading_single_attempt_evidence_analysis',
            strict: true,
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    diagnosis: {
                        type: 'array',
                        minItems: 2,
                        maxItems: 4,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                code: { type: 'string' },
                                reason: { type: 'string' },
                                evidence: {
                                    type: 'array',
                                    minItems: 1,
                                    maxItems: 3,
                                    items: { type: 'string' }
                                }
                            },
                            required: ['code', 'reason', 'evidence']
                        }
                    },
                    nextActions: {
                        type: 'array',
                        minItems: 2,
                        maxItems: 3,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                type: { type: 'string' },
                                target: { type: 'string' },
                                instruction: { type: 'string' },
                                evidence: {
                                    type: 'array',
                                    minItems: 1,
                                    maxItems: 3,
                                    items: { type: 'string' }
                                }
                            },
                            required: ['type', 'target', 'instruction', 'evidence']
                        }
                    },
                    confidence: {
                        type: 'number',
                        minimum: 0.1,
                        maximum: 1
                    }
                },
                required: ['diagnosis', 'nextActions', 'confidence']
            }
        }
    };
}

function normalizeReadingSingleAttemptLlm(raw) {
    const normalized = raw && typeof raw === 'object' ? raw : {};
    const root = (normalized.result && typeof normalized.result === 'object')
        ? normalized.result
        : ((normalized.output && typeof normalized.output === 'object') ? normalized.output : normalized);
    const diagnosis = sanitizeDiagnosisList(
        pickArrayField(root, ['diagnosis', 'diagnoses', 'findings', 'insights', 'diagnostic_items', '诊断', '结论'])
    );
    const nextActions = sanitizeNextActions(
        pickArrayField(root, ['nextActions', 'next_actions', 'actions', 'recommendations', 'suggestions', '下一步', '建议'])
    );
    const confidenceRaw = pickField(root, ['confidence', 'score_confidence', 'reliability']);
    return {
        contract_version: READING_ANALYSIS_CONTRACT_VERSION,
        diagnosis,
        nextActions,
        confidence: clampNumber(confidenceRaw || root.confidence, 0.1, 1)
    };
}

module.exports = {
    READING_ANALYSIS_CONTRACT_VERSION,
    buildReadingSingleAttemptResponseFormat,
    normalizeReadingSingleAttemptLlm
};
