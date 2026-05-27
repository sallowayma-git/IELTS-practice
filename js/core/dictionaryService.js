(function initDictionaryService(global) {
    'use strict';

    const ECDICT_SOURCE_ID = 'ecdict';
    const IELTS_SOURCE_ID = 'ielts_core';
    const WORD_PATTERN = /^[a-z][a-z0-9 .'-]{1,80}$/;
    const FILLER_WORDS = new Set([
        'the', 'and', 'for', 'that', 'with', 'from', 'this', 'have', 'has', 'had',
        'are', 'was', 'were', 'been', 'being', 'will', 'would', 'could', 'should',
        'not', 'but', 'you', 'your', 'their', 'they', 'them', 'then', 'than',
        'into', 'onto', 'over', 'under', 'about', 'which', 'when', 'where', 'what',
        'who', 'whose', 'how', 'can', 'may', 'might', 'must', 'also', 'such'
    ]);

    let ready = false;
    let exactIndex = new Map();
    let variantIndex = new Map();

    function cleanText(value) {
        return String(value || '')
            .replace(/[’‘]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[‐‑‒–—]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeTerm(value) {
        return cleanText(value)
            .toLowerCase()
            .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
            .replace(/'s$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isValidLookupTerm(value) {
        return WORD_PATTERN.test(value);
    }

    function splitTerms(value) {
        const normalized = normalizeTerm(value);
        if (!normalized) {
            return [];
        }
        return normalized
            .split(/[^a-z0-9'-]+/)
            .map((word) => normalizeTerm(word))
            .filter((word) => word.length > 1 && !FILLER_WORDS.has(word));
    }

    function addCandidate(list, seen, value) {
        const normalized = normalizeTerm(value);
        if (!normalized || seen.has(normalized) || !isValidLookupTerm(normalized)) {
            return;
        }
        seen.add(normalized);
        list.push(normalized);
    }

    function buildLemmaCandidates(term) {
        const candidates = [];
        const seen = new Set();
        const normalized = normalizeTerm(term);
        addCandidate(candidates, seen, normalized);
        if (!normalized) {
            return candidates;
        }
        if (normalized.includes('-')) {
            addCandidate(candidates, seen, normalized.replace(/-/g, ' '));
        }
        if (normalized.includes(' ')) {
            addCandidate(candidates, seen, normalized.replace(/\s+/g, '-'));
        }
        if (/ies$/.test(normalized) && normalized.length > 4) {
            addCandidate(candidates, seen, normalized.replace(/ies$/, 'y'));
        }
        if (/ves$/.test(normalized) && normalized.length > 4) {
            addCandidate(candidates, seen, normalized.replace(/ves$/, 'f'));
            addCandidate(candidates, seen, normalized.replace(/ves$/, 'fe'));
        }
        if (/ied$/.test(normalized) && normalized.length > 4) {
            addCandidate(candidates, seen, normalized.replace(/ied$/, 'y'));
        }
        if (/ing$/.test(normalized) && normalized.length > 5) {
            const stem = normalized.replace(/ing$/, '');
            addCandidate(candidates, seen, stem);
            addCandidate(candidates, seen, `${stem}e`);
            if (/([a-z])\1$/.test(stem)) {
                addCandidate(candidates, seen, stem.slice(0, -1));
            }
        }
        if (/ed$/.test(normalized) && normalized.length > 4) {
            const stem = normalized.replace(/ed$/, '');
            addCandidate(candidates, seen, stem);
            addCandidate(candidates, seen, `${stem}e`);
            if (/([a-z])\1$/.test(stem)) {
                addCandidate(candidates, seen, stem.slice(0, -1));
            }
        }
        if (/es$/.test(normalized) && normalized.length > 4) {
            addCandidate(candidates, seen, normalized.replace(/es$/, ''));
            addCandidate(candidates, seen, normalized.replace(/s$/, ''));
        }
        if (/s$/.test(normalized) && normalized.length > 3 && !/ss$/.test(normalized)) {
            addCandidate(candidates, seen, normalized.replace(/s$/, ''));
        }
        return candidates;
    }

    function normalizeECDICTEntry(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const word = normalizeTerm(entry.w || entry.word);
        const translation = cleanText(entry.t || entry.translation || entry.meaning);
        const definition = cleanText(entry.d || entry.definition);
        if (!word || (!translation && !definition)) {
            return null;
        }
        return {
            word,
            lemma: word,
            source: ECDICT_SOURCE_ID,
            sourceLabel: 'ECDICT',
            license: 'MIT',
            zh: translation,
            en: definition,
            phonetic: cleanText(entry.p || entry.phonetic),
            pos: cleanText(entry.pos),
            tags: Array.isArray(entry.tags) ? entry.tags.map(String).filter(Boolean) : [],
            rank: {
                collins: Number.isFinite(Number(entry.c)) ? Number(entry.c) : null,
                bnc: Number.isFinite(Number(entry.b)) ? Number(entry.b) : null,
                frq: Number.isFinite(Number(entry.f)) ? Number(entry.f) : null
            },
            exchange: cleanText(entry.x || entry.exchange)
        };
    }

    function normalizeIeltsEntry(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const word = normalizeTerm(entry.word);
        const meaning = cleanText(entry.meaning);
        if (!word || !meaning) {
            return null;
        }
        return {
            word,
            lemma: word,
            source: IELTS_SOURCE_ID,
            sourceLabel: 'IELTS 核心词表',
            license: '',
            zh: meaning,
            en: '',
            phonetic: '',
            pos: '',
            example: cleanText(entry.example),
            tags: ['ielts-core'],
            rank: {
                collins: null,
                bnc: null,
                frq: Number.isFinite(Number(entry.freq)) ? Number(entry.freq) : null
            },
            exchange: ''
        };
    }

    function parseExchangeVariants(exchange) {
        if (!exchange) {
            return [];
        }
        const variants = [];
        exchange.split('/').forEach((segment) => {
            const body = segment.includes(':') ? segment.slice(segment.indexOf(':') + 1) : segment;
            body.split(/[,\s]+/).forEach((item) => {
                const term = normalizeTerm(item);
                if (term && isValidLookupTerm(term)) {
                    variants.push(term);
                }
            });
        });
        return variants;
    }

    function putEntry(entry, overwrite = false) {
        if (!entry || !entry.word) {
            return;
        }
        if (overwrite || !exactIndex.has(entry.word)) {
            exactIndex.set(entry.word, entry);
        }
        parseExchangeVariants(entry.exchange).forEach((variant) => {
            if (!variantIndex.has(variant)) {
                variantIndex.set(variant, entry.word);
            }
        });
    }

    function init() {
        if (ready) {
            return true;
        }
        exactIndex = new Map();
        variantIndex = new Map();
        const dictionaries = global.__LOCAL_DICTIONARIES__ || {};
        const ecdictEntries = dictionaries.ecdict && Array.isArray(dictionaries.ecdict.entries)
            ? dictionaries.ecdict.entries
            : [];
        ecdictEntries
            .map(normalizeECDICTEntry)
            .filter(Boolean)
            .forEach((entry) => putEntry(entry, true));

        const embeddedWordlists = global.__EMBEDDED_WORDLISTS__ || {};
        const ieltsEntries = Array.isArray(embeddedWordlists.ielts_core)
            ? embeddedWordlists.ielts_core
            : [];
        ieltsEntries
            .map(normalizeIeltsEntry)
            .filter(Boolean)
            .forEach((entry) => putEntry(entry, false));

        ready = true;
        return true;
    }

    function findEntry(term) {
        init();
        const candidates = buildLemmaCandidates(term);
        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            if (exactIndex.has(candidate)) {
                const entry = exactIndex.get(candidate);
                return { entry, matched: candidate };
            }
            const lemma = variantIndex.get(candidate);
            if (lemma && exactIndex.has(lemma)) {
                const entry = exactIndex.get(lemma);
                return { entry, matched: candidate };
            }
        }
        return null;
    }

    function cloneLookupResult(entry, requested, matched) {
        return {
            found: true,
            requested: cleanText(requested),
            term: entry.word,
            lemma: entry.lemma || entry.word,
            matched,
            source: entry.source,
            sourceLabel: entry.sourceLabel,
            license: entry.license,
            zh: entry.zh,
            en: entry.en,
            phonetic: entry.phonetic,
            pos: entry.pos,
            example: entry.example || '',
            tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
            rank: entry.rank ? { ...entry.rank } : {}
        };
    }

    function lookup(term) {
        const requested = cleanText(term);
        const normalized = normalizeTerm(requested);
        if (!normalized) {
            return {
                found: false,
                requested,
                term: '',
                source: 'local',
                reason: 'empty'
            };
        }

        const direct = findEntry(normalized);
        if (direct) {
            return cloneLookupResult(direct.entry, requested, direct.matched);
        }

        const parts = splitTerms(normalized)
            .map((part) => {
                const hit = findEntry(part);
                return hit ? cloneLookupResult(hit.entry, part, hit.matched) : null;
            })
            .filter(Boolean);

        if (parts.length) {
            return {
                found: true,
                requested,
                term: normalized,
                source: 'compound',
                sourceLabel: '本地词典',
                zh: '',
                en: '',
                phonetic: '',
                pos: '',
                parts
            };
        }

        return {
            found: false,
            requested,
            term: normalized,
            source: 'local',
            reason: 'not_found'
        };
    }

    function stats() {
        init();
        return {
            entries: exactIndex.size,
            variants: variantIndex.size
        };
    }

    const api = {
        init,
        lookup,
        normalizeTerm,
        buildLemmaCandidates,
        stats
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.DictionaryService = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
