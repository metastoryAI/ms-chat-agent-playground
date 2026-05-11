# Metastory AI — Chat Agent Mimari Analizi

> Bu doküman; mevcut agent dosyalarının incelemesini, hedeflenen mimariyle karşılaştırmasını, geçiş planını ve karar kayıtlarını tutar. Maddeler tek tek netleştikçe güncellenir.

---

## 1. Mevcut Agent Envanteri

| Agent | Dosya | Rol | Durum |
|---|---|---|---|
| Intent Router | `agents/intent-router.md` | Giriş noktası — 4 kategori: `query` / `onboarding` / `mutation` / `general` | Hafif, sade. Yeni. |
| Chat (eski) | ~~`agents/agent-chat.md`~~ | Eski merkezi router + 8 action. | **Silindi (2026-04-21).** Yerine `agent-analyze` + `agent-answer` + `agent-clarify`. |
| Builder | `agents/agent-builder.md` (+ `modes/builder/...`) | Sections / Modules / Features üretir. Modlar: `generate_modules`, `generate_modules_features`, `generate_pages`, `resolve`, `diff`. | Kapsamlı. |
| Interviewer | `agents/agent-interviewer.md` (+ `modes/interviewer/...`) | Çoktan seçmeli soru–cevap. Modlar: `solve_open_points`, `enrich_context`. | Kapsamlı. |
| Query | `agents/agent-query` | Okuma: `getProjectList`, `getModuleList`, `getFeatureList`, `getSubFeatureList`, `getProjectStats`, `searchFeatures`. | Stub. |
| Mutation | `agents/agent-mutation` | Yazma. Şu anda sadece `createTask`. | **Çok eksik.** |

---

## 2. Hedeflenen 5 Kullanıcı Akışı — Karşılama Durumu

| # | Akış | Gerekli agent zinciri | Boşluk |
|---|---|---|---|
| 1 | PRD PDF yükle | `intent-router` → `Analyze` → (onayla) → `Builder` | Intent-router doküman girdisi bilmiyor; Analyze ayrı agent değil |
| 2 | Meeting transcript yükle | Aynı | Aynı |
| 3 | Sıfırdan konuşarak anlatma | `Analyze` (düşük confidence) → kullanıcı isterse `Interviewer` | Başlangıç mesajı yok; Interviewer manuel |
| 4 | Jira vb. import edilmiş projede soru sorma | `Query` (veri çek) + `Answer` (AI yorumla) | Answer agent yok; agent-chat'teki `answer` sadece `inputs[]`'e bakıyor |
| 5 | Var olan projede feature manipülasyonu | `Mutation` (+ içerik üretimi için Builder alt-modları) | Mutation sadece `createTask`; user_story / acceptance_criteria / sub_feature üretimi yok |

---

## 3. Mimari Boşluklar

1. **agent-chat.md ↔ intent-router rol çakışması.** agent-chat hâlâ kendi "input detection" mantığını taşıyor.
2. **PDF'teki Analyze / Answer / Clarify kutuları koda henüz yansımamış** — hepsi agent-chat içinde.
3. **User Story / Acceptance Criteria / Sub-Feature üretim promptları yok.** Builder module+feature seviyesinde duruyor.
4. **Agent-arası handoff protokolü tanımsız** — route sonrası sonraki agent'ın çıktısı frontend'e nasıl ulaşır, belirsiz.
5. **Chat state taşınmıyor.** Her mesaj sıfırdan intent-router'dan geçiyor. (Karar: şimdilik hafıza yok — bkz. Karar #6.)

---

## 4. Önerilen Geçiş Planı (Faz Faz)

### Faz A — agent-chat.md'yi parçala
- `agent-analyze.md` — `analyze_document`, `analyze_input`, `add_input`, `modify_input`, `remove_input`, `extract_open_points`.
- `agent-answer.md` — `answer` action'u; proje bağlamı + import edilmiş yapı + inputs[] üzerinden AI cevabı.
- `agent-clarify.md` — `clarify` action'u ve `[NA:CONFLICT]`, `[NA:BUILDER_TYPE]` vb. durumlar.
- agent-chat.md retire et.

### Faz B — intent-router'ı zenginleştir
- `onboarding` alt-ayrımı: `analyze_document` (doküman var) / `analyze_input` (sadece metin) / `generate` (explicit komut) / `refine` (var olan yapı üstünde).
- `answer` intent'i ekle: "X hakkında ne düşünüyorsun", "eksik mi", "nasıl iyileştirilir" gibi AI yorum gerektiren sorular.
- `query` net liste/görüntüleme istekleri için kalmaya devam.
- `clarify` intent'i ekle (belirsiz komutlar için).
- **Çoklu intent desteği:** tek mesajda birden fazla intent varsa router diziyi döner, orkestra sırayla çalıştırır.

### Faz C — Mutation Agent'ı genişlet
- Tools: `createModule`, `createFeature`, `createSubFeature`, `updateFeature`, `updateModule`, `generateUserStory`, `generateAcceptanceCriteria`.
- **Silme operasyonları kapsam dışı** (bkz. Karar #10).
- İçerik üreten mutationlar (user story vb.) Builder'ın yeni alt-modlarını çağırır (bkz. Karar #5).

### Faz D — Yeni üretim promptları (Builder altında)
- `modes/builder/generate/sub-features.md`
- `modes/builder/generate/user-story.md`
- `modes/builder/generate/acceptance-criteria.md`

### Faz E — Orkestra sözleşmesi
- Her agent `suggested_next` döndürür; frontend / chat runtime bu bilgiyle sıradaki adıma karar verir.
- Otomatik zincirleme **yok**. Analyze sonrası Builder otomatik çalışmaz, kullanıcı onayı beklenir (bkz. Karar #1).

---

## 5. Karar Kayıtları (Soru – Cevap)

| # | Konu | Karar | Not |
|---|---|---|---|
| 1 | Otomatik zincirleme eşiği | **Yok.** PRD yüklendikten sonra Analyze çalışır; Builder kullanıcı onayıyla tetiklenir. | Confidence eşiği uygulanmaz. Her zaman "Generate" butonu beklenir. |
| 2 | Interviewer tetiklenmesi | **Manuel.** Kullanıcı istediğinde açılır. | Yeni proje başlangıç mesajı önerilir: *"Hello! Please describe what you want to build, or upload any documents you have. I'll help organize your project and guide you through the next steps."* Bu metin `agent-answer.md`'nin onboarding variant'ında veya frontend welcome state'inde yer alır. |
| 3 | Intent değişimi mid-flow | **Onboarding sırasında flow sıfırlansın.** | Kullanıcı onboarding ortasında başka intent'e geçerse mevcut onboarding context'i bırakılır. Diğer flow'lar için tekrar değerlendirilecek. |
| 4 | Query vs Answer ayrımı | **İki ayrı agent.** Tool'lar paylaşılan; istenen agent'a register edilir. | Query agent deterministik liste/görüntüleme için. Answer agent AI yorum için — gerekirse aynı read-tool'ları kendi içinden çağırır. |
| 5 | AI'lı mutation (user story vb.) | **Builder altında topla.** | `generateUserStory`, `generateAcceptanceCriteria`, `generateSubFeatures` → Builder alt-modu. Mutation Agent sonucu Builder'dan alıp persist eder. |
| 6 | State hafızası | **Yok.** | Her turn intent-router'dan stateless geçer. |
| 7 | Çoklu intent | **Böl ve sırayla çalıştır.** | Intent-router tek mesajdan intent dizisi dönebilmeli. Orkestra her intent'i sırayla yürütür ve sonuçları birleştirir. |
| 8 | next_actions butonları | **Kalır.** | Mevcut `[NA:GENERATE\|CONFIDENCE:XX]`, `[NA:BUILDER_TYPE]` vb. tag sistemi korunur; frontend bunları buton olarak render eder. |
| 9 | Jira import bağlam yüklemesi | **Lazy load.** Chat boş başlar, kullanıcı soru sordukça ilgili veri çekilir. | Query Agent on-demand çalışır, başlangıçta global sync yok. |
| 10 | Feature silme | **Yok.** Mutation silme operasyonu desteklemez. | Tool'lar sadece create/update içerir. |
| 11 | Prompt composition stratejisi | **Seçenek A — Koşullu yükleme.** Runtime, `action_hint`'e göre sadece ilgili action dosyasını concat eder. | Base + rules + single action + templates. Mapping ve fallback [prompt-composition.md](./prompt-composition.md)'te. Token ~%60 düşer, dosya yapısı korunur. |
| 12 | Conflict detection sahipliği | **agent-analyze.** Detect + clarify-shape output tek çağrıda. agent-clarify sadece intent-router'ın doğrudan clarify intent'i ürettiği vakalarda çalışır. | Detect ≠ Respond. Doküman içeriğini okuyabilen tek agent agent-analyze — conflict rule'ları orada yüklenir. İkinci LLM çağrısı yok. |
| 13 | Rule dosyası refactoring'i | `input-detection.md` + `command-routing.md` silindi. Yerine: `conflict-detection.md`, `post-insert-routing.md`, `fallback-detection.md`. | Intent-router'ın yaptığı iş agent'a tekrar öğretilmiyor. Her rule kendi koşuluyla yüklenir. |
| 14 | Template dosyası konsolidasyonu | `chat-responses.md` silindi, içeriği `agent-analyze.md` base'ine taşındı. Template C ölü kod olduğu için (agent-clarify zaten inline tutuyordu) atıldı. | `modes/chat/templates/` klasörü tamamen kaldırıldı. agent-analyze için dosya sayısı her case'de 1 azaldı. |
| 15 | Review pass temizliği (2026-04-21) | 7 çelişki/optimizasyon fix'i: (a) intent-router'a `generation_type` sub-hint, (b) agent-analyze'dan `route_to_agent` kaldırıldı, (c) `analyze-document.md` label "max 2" olarak düzeltildi, (d) stale "Chat Agent" → "agent-analyze", (e) `project_context.language` → `project_language`, (f) `DOC_SELECT` tag'i kaldırıldı, (g) `post-insert-routing.md` "may also" netleştirildi. | agent-builder'a INPUT kaynak tablosu + mode selection tablosu eklendi. Tüm iç çelişkiler kapatıldı. |

---

## 6. Madde #4 — Query ve Answer Ayrımı (Kapatıldı)

**Karar:** İki ayrı agent. Tool'lar shared; gerekli agent'a register edilir.

- **Query Agent** — net liste/görüntüleme istekleri için. Deterministik, şema ile doğrulanabilir çıktı.
- **Answer Agent** — AI yorum gerektiren sorular için. Aynı read-tool'ları (getModuleList, searchFeatures vb.) kendi içinden de çağırabilir; böylece karma soruları ("Auth'ta neler var, eksik mi?") tek hopta halleder.
- Intent-router: "göster / listele" → Query. "ne düşünüyorsun / eksik mi / nasıl iyileştirilir" → Answer.

---

## 7. Sıradaki Adımlar

- [x] Madde #4 için uzlaşı önerisi onayla veya revize et.
- [x] Madde #4 için uzlaşı onayı (shared tools).
- [x] Faz A taslakları: `agent-analyze.md`, `agent-answer.md`, `agent-clarify.md` iskeletleri. (2026-04-21)
- [x] Faz B: intent-router'da alt-intent + çoklu-intent + `action_hint` / `clarify_variant` / `mutation_type` üretimi. (2026-04-21)
- [ ] Faz A/B runtime bağlantıları: orkestra, `intents[]` dizisini sırayla çalıştırır; her intent'in çıktısını birleştirip frontend'e döner.
- [ ] Prompt composition loader'ı [prompt-composition.md](./prompt-composition.md)'deki tabloyla implement et; A/B snapshot testi kur.
- [ ] Prompt backend: [prompt-backend-design.md](./prompt-backend-design.md)'deki şemayı Flyway ile oluştur; composer + cache Java tarafında; filesystem → DB seed job.
- [x] Scenario dispatch matrix: [prompt-scenarios.md](./prompt-scenarios.md) — tüm kullanıcı senaryoları ve yüklenen dosyalar. (2026-04-21)
- [x] Model config matrix: [prompt-model-config.md](./prompt-model-config.md) — her agent × mode için temperature/max_tokens/top_p + Java registry örneği. (2026-04-21)
- [x] `agent-chat.md` ve tekilleşen `actions/answer.md` / `actions/clarify.md` / `actions/route.md` silindi. (2026-04-21)
- [ ] Java tarafındaki çağrı yerlerini yeni üçlüye (`agent-analyze` / `agent-answer` / `agent-clarify`) + intent-router'a taşı.
- [ ] Faz C: Mutation tool listesini kesinleştir (create/update kapsamı; silme yok).
- [ ] Faz D: Builder alt-modları için prompt iskeletleri (`sub-features.md`, `user-story.md`, `acceptance-criteria.md`).
- [ ] Faz E: `suggested_next` / handoff JSON şeması.
