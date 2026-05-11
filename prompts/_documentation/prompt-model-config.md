# Prompt Model Config

Önerilen LLM sampling parametreleri her agent × mode/action için.

**Provider notu:** `frequency_penalty` ve `presence_penalty` OpenAI-specific parametreler. Claude/Anthropic API bunları desteklemez; çağrı katmanında provider'a göre filtrelenmeli. Aşağıdaki değerler OpenAI format'ında verilmiştir.

---

## Tam Config Tablosu

| Agent | Mode / Action | temperature | max_tokens | top_p | frequency_penalty | presence_penalty | Gerekçe |
|---|---|---|---|---|---|---|---|
| **intent-router** | classify | 0.0 | 512 | 1.0 | 0.0 | 0.0 | Saf sınıflandırma — maksimum determinizm |
| **agent-analyze** | analyze_document | 0.2 | 4096 | 1.0 | 0.1 | 0.0 | Ekstrakt + sentez; captured_topics'te tekrar fraz eğilimi düşürülsün |
| **agent-analyze** | analyze_input | 0.2 | 2048 | 1.0 | 0.1 | 0.0 | Aynı profil, output daha küçük |
| **agent-analyze** | add_input | 0.2 | 2048 | 1.0 | 0.1 | 0.0 | State echo + küçük update |
| **agent-analyze** | modify_input | 0.2 | 2048 | 1.0 | 0.1 | 0.0 | Aynı |
| **agent-analyze** | remove_input | 0.2 | 2048 | 1.0 | 0.1 | 0.0 | Aynı |
| **agent-analyze** | extract_open_points | 0.1 | 2048 | 1.0 | 0.1 | 0.0 | Saf sınıflandırma — hallüsinasyon istenmez |
| **agent-analyze** | fallback (null hint) | 0.2 | 4096 | 1.0 | 0.1 | 0.0 | En geniş hareket alanı |
| **agent-answer** | answer | 0.5 | 2048 | 1.0 | 0.2 | 0.0 | Konuşma tonu + doğal dil çeşitliliği |
| **agent-answer** | onboarding_welcome | 0.1 | 300 | 1.0 | 0.0 | 0.0 | Neredeyse sabit metin |
| **agent-clarify** | standard | 0.1 | 300 | 1.0 | 0.0 | 0.0 | Tek cümlelik belirli soru |
| **agent-clarify** | generate_without_type | 0.1 | 200 | 1.0 | 0.0 | 0.0 | Sabit kısa metin |
| **agent-clarify** | project_conflict | 0.1 | 300 | 1.0 | 0.0 | 0.0 | Tek cümlelik belirli soru |
| **agent-builder** | generate_modules | 0.3 | 4096 | 1.0 | 0.1 | 0.1 | Yaratıcı yapı; name tekrarı kaçınmak için presence penalty |
| **agent-builder** | generate_modules_features | 0.3 | 8192 | 1.0 | 0.1 | 0.1 | En büyük output; tree rendering |
| **agent-builder** | generate_pages | 0.2 | 3000 | 1.0 | 0.1 | 0.0 | Seçme + ekstrakt; yaratıcılık az |
| **agent-builder** | resolve | 0.2 | 4096 | 1.0 | 0.0 | 0.0 | Cevap inmeleri, deterministik |
| **agent-builder** | diff | 0.2 | 4096 | 1.0 | 0.0 | 0.0 | Karşılaştırma + targeted update |
| **agent-interviewer** | solve_open_points | 0.3 | 2048 | 1.0 | 0.2 | 0.0 | Soru çeşitliliği istenir |
| **agent-interviewer** | enrich_context | 0.4 | 3000 | 1.0 | 0.2 | 0.0 | Discovery sorularında daha fazla çeşitlilik |
| **agent-query** | all tool flows | 0.1 | 2048 | 1.0 | 0.0 | 0.0 | Tool calling — maksimum determinizm |
| **agent-mutation** | all tool flows | 0.1 | 1024 | 1.0 | 0.0 | 0.0 | Tool calling; output kısa (onay mesajı) |

---

## Prensipler

### Temperature
- `0.0–0.1` — saf sınıflandırma, tool calling, deterministik kısa cevap
- `0.2` — ekstraksiyon + minimal sentez (analyze, extract, diff, resolve)
- `0.3` — yaratıcı yapı (builder generate, interviewer solve)
- `0.4–0.5` — sohbet tonu / discovery

### max_tokens
Beklenen output boyutuna göre üst sınır. Güvenli olması için 1.5× tahmini büyüklük:
- Tek-cümle (clarify, welcome) → 200–500
- Orta (analyze, answer, mutation) → 2048
- Doküman analizi (analyze_document) → 4096
- Yapı üretimi (builder) → 4096–8192

### top_p
Varsayılan `1.0` — temperature yeterli kontrol sağlıyor. `top_p < 1` ile birlikte kullanmayın.

### frequency_penalty (OpenAI-only)
- `0.0` — yapılandırılmış / enumerated output
- `0.1` — modüler sentez (topic/question üretimi)
- `0.2` — sohbet, soru çeşitliliği

### presence_penalty (OpenAI-only)
- `0.0` — default
- `0.1` — builder'da farklı modül/feature kapsamlarını teşvik etmek için

---

## Claude API Equivalent

Claude için yukarıdaki config'i kullanırken:
- `temperature` aynen aktarılır (0.0–1.0 aralığı)
- `max_tokens` aynen aktarılır
- `top_p` aynen aktarılır
- `frequency_penalty` / `presence_penalty` **yok sayılır**
- Opsiyonel olarak `top_k` eklenebilir:
  - Sınıflandırma (intent-router, query, mutation): `top_k: 1`
  - Yapı üretimi (builder): `top_k: 40` (varsayılan)
  - Diğer: varsayılan

---

## Örnek Uygulama (Java)

```java
public record PromptConfig(
    double temperature,
    int maxTokens,
    double topP,
    double frequencyPenalty,
    double presencePenalty
) {}

@Service
public class PromptConfigRegistry {
    private static final Map<String, PromptConfig> CONFIGS = Map.ofEntries(
        Map.entry("intent-router:classify",              new PromptConfig(0.0, 512,  1.0, 0.0, 0.0)),
        Map.entry("agent-analyze:analyze_document",      new PromptConfig(0.2, 4096, 1.0, 0.1, 0.0)),
        Map.entry("agent-analyze:analyze_input",         new PromptConfig(0.2, 2048, 1.0, 0.1, 0.0)),
        Map.entry("agent-analyze:add_input",             new PromptConfig(0.2, 2048, 1.0, 0.1, 0.0)),
        Map.entry("agent-analyze:modify_input",          new PromptConfig(0.2, 2048, 1.0, 0.1, 0.0)),
        Map.entry("agent-analyze:remove_input",          new PromptConfig(0.2, 2048, 1.0, 0.1, 0.0)),
        Map.entry("agent-analyze:extract_open_points",   new PromptConfig(0.1, 2048, 1.0, 0.1, 0.0)),
        Map.entry("agent-analyze:fallback",              new PromptConfig(0.2, 4096, 1.0, 0.1, 0.0)),
        Map.entry("agent-answer:answer",                 new PromptConfig(0.5, 2048, 1.0, 0.2, 0.0)),
        Map.entry("agent-answer:onboarding_welcome",     new PromptConfig(0.1, 300,  1.0, 0.0, 0.0)),
        Map.entry("agent-clarify:standard",              new PromptConfig(0.1, 300,  1.0, 0.0, 0.0)),
        Map.entry("agent-clarify:generate_without_type", new PromptConfig(0.1, 200,  1.0, 0.0, 0.0)),
        Map.entry("agent-clarify:project_conflict",      new PromptConfig(0.1, 300,  1.0, 0.0, 0.0)),
        Map.entry("agent-builder:generate_modules",          new PromptConfig(0.3, 4096, 1.0, 0.1, 0.1)),
        Map.entry("agent-builder:generate_modules_features", new PromptConfig(0.3, 8192, 1.0, 0.1, 0.1)),
        Map.entry("agent-builder:generate_pages",            new PromptConfig(0.2, 3000, 1.0, 0.1, 0.0)),
        Map.entry("agent-builder:resolve",                   new PromptConfig(0.2, 4096, 1.0, 0.0, 0.0)),
        Map.entry("agent-builder:diff",                      new PromptConfig(0.2, 4096, 1.0, 0.0, 0.0)),
        Map.entry("agent-interviewer:solve_open_points", new PromptConfig(0.3, 2048, 1.0, 0.2, 0.0)),
        Map.entry("agent-interviewer:enrich_context",    new PromptConfig(0.4, 3000, 1.0, 0.2, 0.0)),
        Map.entry("agent-query:default",                 new PromptConfig(0.1, 2048, 1.0, 0.0, 0.0)),
        Map.entry("agent-mutation:default",              new PromptConfig(0.1, 1024, 1.0, 0.0, 0.0))
    );

    public PromptConfig get(String agent, String mode) {
        return CONFIGS.getOrDefault(agent + ":" + mode, defaultConfig());
    }
}
```

DB'ye taşındığında (`prompt-backend-design.md`'ye bkz.) bu config'ler `prompts` tablosuna opsiyonel kolonlar olarak eklenebilir veya ayrı bir `prompt_configs` tablosunda tutulabilir.

---

## Tuning Notları

- Production'da bu değerler **başlangıç noktasıdır.** Telemetry ile izle:
  - Output'ta unexpected refusal / incomplete JSON → `max_tokens` arttır
  - Aynı modül isimleri tekrar ediyor → `presence_penalty` 0.1 → 0.2
  - Soru çeşitliliği az → `temperature` 0.3 → 0.4
  - Tool calling'de yanlış tool seçimi → `temperature` 0.1 → 0.0
- A/B test için config iki versiyonlu tutulabilir; user segment'e göre servis et.
