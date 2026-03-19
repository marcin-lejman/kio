# Wyszukiwarka KIO

Inteligentna wyszukiwarka orzeczeń Krajowej Izby Odwoławczej (KIO) z wykorzystaniem AI. Przeszukuje korpus ~29 800 orzeczeń łącząc wyszukiwanie semantyczne, pełnotekstowe oraz generowanie odpowiedzi przez modele językowe.

## Główne funkcje

### Wyszukiwanie hybrydowe

Zapytania przetwarzane są w wieloetapowym pipeline:

1. **Analiza zapytania** — model AI wyodrębnia słowa kluczowe, przeformułowuje zapytanie i sugeruje filtry
2. **Wyszukiwanie równoległe** — wektorowe (embedding similarity) + pełnotekstowe (PostgreSQL FTS)
3. **Łączenie wyników** — reciprocal rank fusion, grupowanie fragmentów po orzeczeniach
4. **Przegląd AI** — strumieniowa synteza odpowiedzi na podstawie 10 najlepszych trafień z linkami do orzeczeń

Obsługuje też bezpośrednie wyszukiwanie po sygnaturze (np. "KIO 1234/24").

### Filtry

- Typ dokumentu (wyrok / postanowienie)
- Typ rozstrzygnięcia (oddalone / uwzględnione / umorzone / odrzucone)
- Zakres dat

### Szczegóły orzeczenia

Cztery widoki dla każdego orzeczenia:

- **HTML** — oryginalny sformatowany dokument
- **Tekst** — wersja tekstowa
- **Fragmenty** — podział na sekcje z etykietami, liczbą tokenów i podświetlaniem słów kluczowych
- **Podsumowanie** — generowane przez AI streszczenie prawne (przedmiot, rozstrzygnięcie, zarzuty, fakty, rozważania, podstawa prawna, znaczenie praktyczne)

### Podobne orzeczenia

Wyszukiwanie semantycznie zbliżonych orzeczeń z wagami zależnymi od sekcji dokumentu (uzasadnienie > stan faktyczny > treść).

### Przeglądanie i historia

- **Przeglądanie** — stronicowana tabela wszystkich orzeczeń z filtrami i sortowaniem
- **Historia wyszukiwań** — lista zapytań z liczbą wyników, kosztami i statusem AI

### Wybór modelu

Użytkownik może wybrać model odpowiedzi:

- Claude Sonnet 4.6 (domyślny)
- Gemini Flash Lite (szybki)
- Gemini Pro (zaawansowany)
- GPT-5.4 (eksperymentalny)

### Panel administracyjny

- **Użytkownicy** — zarządzanie rolami, zawieszanie, ustawianie haseł, usuwanie
- **Zaproszenia** — wysyłanie zaproszeń z przypisaniem roli
- **Koszty API** — dzienne/tygodniowe/miesięczne zestawienie kosztów i tokenów wg modelu
- **Zdrowie bazy** — statystyki korpusu, kontrola integralności (brakujące chunki, embeddingi, duplikaty)

## Stack technologiczny

- **Frontend**: Next.js 16, React 19, Tailwind CSS v4, TypeScript
- **Backend**: Next.js App Router, Supabase (PostgreSQL + pgvector + RLS)
- **LLM**: OpenRouter (Claude, Gemini, GPT) + text-embedding-3-large (3072 dim)
- **Autentykacja**: Supabase Auth z RBAC (regular / admin)

## Uruchomienie

```bash
npm install
npm run dev
```

Wymagane zmienne środowiskowe:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENROUTER_API_KEY=
```

## Architektura danych

Orzeczenia dzielone są na fragmenty (chunki) z uwzględnieniem struktury dokumentów prawnych:

- **Tier A** — pełna struktura (nagłówek, sentencja, zarzuty, uzasadnienie)
- **Tier A_NOUZAS** — bez markera uzasadnienia
- **Tier B** — tylko uzasadnienie
- **Tier C** — podział generyczny
- **SHORT** — dokumenty poniżej 500 słów

Parametry chunkingu: target 800 tokenów, max 1200, min 100. Aproksymacja tokenów dla polskiego: `len(words) * 1.5`.
