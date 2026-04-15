// ─── LANGUAGE SELECTOR ───────────────────────────────────────────────────────

const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'de', label: 'German' },
    { code: 'tr', label: 'Turkish' },
    { code: 'fr', label: 'French' },
    { code: 'es', label: 'Spanish' },
    { code: 'it', label: 'Italian' },
/*    { code: 'pt', label: 'Portuguese' },
    { code: 'nl', label: 'Dutch' },
    { code: 'pl', label: 'Polish' },
    { code: 'ru', label: 'Russian' },
    { code: 'uk', label: 'Ukrainian' },
    { code: 'ar', label: 'Arabic' },
    { code: 'zh', label: 'Chinese' },
    { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' },
    { code: 'hi', label: 'Hindi' },
    { code: 'sv', label: 'Swedish' },
    { code: 'da', label: 'Danish' },
    { code: 'no', label: 'Norwegian' },
    { code: 'fi', label: 'Finnish' },
    { code: 'cs', label: 'Czech' },
    { code: 'ro', label: 'Romanian' },
    { code: 'hu', label: 'Hungarian' },
    { code: 'el', label: 'Greek' },
    { code: 'he', label: 'Hebrew' },
    { code: 'th', label: 'Thai' },
    { code: 'vi', label: 'Vietnamese' },
    { code: 'id', label: 'Indonesian' },*/
];

function getLanguageLabel(code) {
    if (!code) return 'Auto-detect';
    const lang = LANGUAGES.find(l => l.code === code);
    return lang ? lang.label : code.toUpperCase();
}

function openLanguageModal() {
    const modal = document.getElementById('lang-modal');
    const list = document.getElementById('lang-modal-list');
    const current = state.project_language || 'en';

    list.innerHTML = LANGUAGES.map(l => {
        const selected = l.code === current;
        return `<button class="lang-modal-item${selected ? ' selected' : ''}" onclick="selectLanguage('${l.code}')">
      <span class="lang-modal-item-label">${l.label}</span>
      <span class="lang-modal-item-code">${l.code.toUpperCase()}</span>
      ${selected ? '<span class="lang-modal-item-check">✓</span>' : ''}
    </button>`;
    }).join('');

    modal.style.display = 'flex';
}

function closeLanguageModal() {
    document.getElementById('lang-modal').style.display = 'none';
}

function selectLanguage(code) {
    state.project_language = code;
    state._languageConfirmed = true;
    closeLanguageModal();
    updateStatePanel();
}

// Startup single-select QA — shown once when a non-English language is detected
// on the user's first input. After pick, language is locked for the session.
function showLanguagePickerQA(detectedCode) {
    const detectedLabel = getLanguageLabel(detectedCode) || 'another language';
    const options = [
        { id: 'en', label: 'English (Default)' },
        { id: 'de', label: 'German' },
        ...LANGUAGES.filter(l => l.code !== 'en' && l.code !== 'de').map(l => ({ id: l.code, label: l.label })),
    ];
    const question = {
        id:      'pick_language',
        type:    'single_select',
        text:    `We detected ${detectedLabel} — which language do you prefer?`,
        options: options,
    };
    _cbLanguageMode = true;
    showCBWidget([question]);
    // Apply language-picker-only styling (max height + scroll, hide free-text row)
    const widget = document.getElementById('cb-widget');
    if (widget) widget.classList.add('cb-widget-language');
    // Preselect English as default
    const enRow = widget?.querySelector('.cb-opt-row[data-value="en"]');
    if (enRow) enRow.classList.add('cb-opt-selected');
}

// Called from response-handler when chat agent detects language
function applyDetectedLanguage(langCode) {
    if (!langCode) return;
    const code = langCode.toLowerCase();
    if (LANGUAGES.find(l => l.code === code)) {
        state.project_language = code;
    }
}

// Detect language from text using simple word frequency heuristics
function detectLanguageFromText(text) {
    if (!text || text.length < 50) return null;
    const sample = text.slice(0, 2000).toLowerCase();
    const counts = {};
    const patterns = {
        de: /\b(und|die|der|das|ist|von|für|mit|den|ein|eine|auf|dem|des|wird|nicht|auch|als|nach|bei|über|zur|zum|aus|wie|oder|wenn|dass|noch|nur|werden|kann|sich|sind|hat|vom|bis|aber|alle|diese|einem|haben|mehr|wurde|einer)\b/g,
        tr: /\b(ve|bir|bu|için|ile|olan|den|da|de|olarak|gibi|daha|ancak|veya|hem|ise|kadar|sonra|üzerinde|olan|değil|çok|nasıl|oldu|yapı|şekilde)\b/g,
        fr: /\b(les|des|une|est|dans|pour|que|qui|par|sur|avec|sont|ont|pas|mais|cette|aux|ses|tous|leur|fait|peut|nous|vous|comme|après|entre|aussi|même|très)\b/g,
        es: /\b(los|las|del|una|por|con|para|que|como|más|son|pero|sus|hay|está|tiene|este|esta|todo|entre|desde|cuando|también|puede|sobre|otro|todos|donde|después)\b/g,
        it: /\b(che|per|con|una|del|dei|della|sono|alla|nel|anche|come|più|questo|tutti|sua|delle|ogni|dopo|essere|quando|hanno|stato|dove|sulla|loro|senza|quale|molto)\b/g,
    };
    for (const [lang, regex] of Object.entries(patterns)) {
        const matches = sample.match(regex);
        counts[lang] = matches ? matches.length : 0;
    }
    // English as fallback — check for common English words
    const enMatches = sample.match(/\b(the|and|for|that|with|this|from|have|are|was|not|but|they|which|been|will|would|about|into|more|some|when|could|than|other|also|after|these|your|between)\b/g);
    counts.en = enMatches ? enMatches.length : 0;

    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 5) return best[0];
    return null;
}

// Auto-detect language from uploaded files if project_language is not set
function autoDetectLanguageFromFiles(files) {
    if (state.project_language) return; // already set by user
    for (const entry of files) {
        if (entry.text) {
            const detected = detectLanguageFromText(entry.text);
            if (detected) {
                state.project_language = detected;
                return;
            }
        }
    }
}